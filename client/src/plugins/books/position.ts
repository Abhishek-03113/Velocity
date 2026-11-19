/**
 * Local-first reading position (spec §2.5). Every location updates the shelf store and `ctx.storage` at once;
 * the server PATCH is debounced and flushed (keepalive) on unmount and `pagehide`. Failures keep the local copy.
 */
import { parseServerTime, type Book, type ProgressPatch, type ReaderHost } from './types'

export interface PositionStorage {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

export interface StoredPosition {
  position: string
  progress: number
  /** Epoch ms of the reading event. */
  at: number
  /** Set while the server has not confirmed this position (offline, failed PATCH). */
  unsynced?: true
}

export const FINISHED_AT = 0.98
export const posKey = (bookId: number) => `pos.${bookId}`

/**
 * In-memory positions of this session, by book. Checked first when a reader opens, so closing and reopening the
 * tile lands on the exact same spot without waiting for storage or the server (spec §6).
 */
const sessionPositions = new Map<number, StoredPosition>()
export const getSessionPosition = (bookId: number) => sessionPositions.get(bookId)
export const rememberSessionPosition = (bookId: number, value: StoredPosition) => void sessionPositions.set(bookId, value)
export const clearSessionPositions = () => sessionPositions.clear()

export interface LocationUpdate {
  position: string
  progress: number
}

export interface PositionSync {
  update(loc: LocationUpdate): void
  flush(opts?: { keepalive?: boolean }): Promise<void>
  dispose(): void
}

interface Options {
  bookId: number
  host: Pick<ReaderHost, 'setLocalProgress' | 'saveProgress'>
  storage: PositionStorage
  debounceMs?: number
  /** The book was already finished when opened: it never goes back to 'reading' automatically. */
  finished?: boolean
  /** Position the reader opened at; a 0% report from there is "not started", not reading. */
  startPosition?: string | null
  now?: () => number
}

export function createPositionSync(options: Options): PositionSync {
  const { bookId, host, storage, debounceMs = 1500, now = Date.now } = options
  let finished = options.finished === true
  let last: LocationUpdate | null = null
  let pending: { patch: ProgressPatch; at: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight = false
  let disposed = false
  let unloading = false

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const writeLocal = (value: StoredPosition) => {
    rememberSessionPosition(bookId, value)
    try {
      storage.set(posKey(bookId), value)
    } catch (err) {
      console.error('[books] could not store reading position', err)
    }
  }

  async function send(keepalive: boolean): Promise<void> {
    if (!pending) return
    if (inflight && !keepalive) return // a finished send reschedules itself
    const sending = pending
    pending = null
    inflight = true
    let failed = false
    try {
      await host.saveProgress(bookId, sending.patch, keepalive ? { keepalive: true } : undefined)
      const stored = storage.get<StoredPosition>(posKey(bookId))
      if (stored && stored.at === sending.at && stored.unsynced) {
        writeLocal({ position: stored.position, progress: stored.progress, at: stored.at })
      }
    } catch (err) {
      failed = true
      // A request cut off by the page unloading is expected; the local copy is kept either way.
      if (!unloading) console.error('[books] could not save reading position (kept locally)', err)
      if (!pending) pending = sending
    } finally {
      inflight = false
      if (!failed && pending && !disposed) schedule()
    }
  }

  function schedule() {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void send(false)
    }, debounceMs)
  }

  const onPageHide = () => {
    unloading = true
    void send(true)
  }
  const onPageShow = () => {
    unloading = false
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
  }

  return {
    update(loc) {
      if (disposed) return
      const progress = Math.min(1, Math.max(0, Number.isFinite(loc.progress) ? loc.progress : 0))
      if (last && last.position === loc.position && last.progress === progress) return
      last = { position: loc.position, progress }
      // Opening a book at its start (or at the saved spot, reported as 0% before locations are known) is not reading.
      if (progress === 0 && !finished && (options.startPosition ?? null) === loc.position) return
      if (progress >= FINISHED_AT) finished = true
      const patch: ProgressPatch = { position: loc.position, progress, status: finished ? 'finished' : 'reading' }
      const at = now()
      host.setLocalProgress(bookId, patch)
      writeLocal({ position: loc.position, progress, at, unsynced: true })
      pending = { patch, at }
      schedule()
    },
    flush(opts) {
      clearTimer()
      return send(opts?.keepalive === true)
    },
    dispose() {
      if (disposed) return
      clearTimer()
      void send(true)
      disposed = true
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide)
        window.removeEventListener('pageshow', onPageShow)
      }
    },
  }
}

export interface StartPosition {
  position: string
  /** 0..1 of the source it came from (0 when unknown), for the restore guard. */
  progress: number
}

/**
 * Where to open: session cache and this browser's entry first (newest of the two), then the server row. A local
 * entry the server never confirmed wins; otherwise the newest timestamp wins.
 */
export function pickStart(
  book: Pick<Book, 'position' | 'progress' | 'updated_at'>,
  local: StoredPosition | undefined,
  session?: StoredPosition,
): StartPosition | null {
  const valid = (p: StoredPosition | undefined): p is StoredPosition => !!p && typeof p.position === 'string' && p.position !== ''
  const best = [session, local].filter(valid).sort((a, b) => b.at - a.at)[0]
  const server = book.position ? { position: book.position, progress: book.progress ?? 0 } : null
  if (!best) return server
  const mine = { position: best.position, progress: best.progress ?? 0 }
  if (!server) return mine
  if (best.unsynced) return mine
  return best.at > parseServerTime(book.updated_at) ? mine : server
}

/** The position to open at (see `pickStart`). */
export function pickStartPosition(
  book: Pick<Book, 'position' | 'updated_at'> & { progress?: number },
  local: StoredPosition | undefined,
  session?: StoredPosition,
): string | null {
  return pickStart({ progress: 0, ...book }, local, session)?.position ?? null
}

/**
 * Keeps a freshly opened reader from saving a position before it has finished restoring: until the engine is
 * ready and has reported a location at or after the target, nothing is written (a stray early location would
 * otherwise overwrite the saved place, the "drift on reopen" bug). It releases on any user navigation, or
 * `timeoutMs` after ready, so an unreachable target can never block saving for good.
 */
export interface RestoreGuard {
  ready(): void
  /** The user navigated: stop guarding. */
  release(): void
  /** True when this location may be saved. */
  accept(loc: { position: string; progress: number }): boolean
}

export function createRestoreGuard(target: StartPosition | null, timeoutMs = 4000, now: () => number = Date.now): RestoreGuard {
  let open = target === null
  let readyAt: number | null = null
  return {
    ready() {
      if (readyAt === null) readyAt = now()
    },
    release() {
      open = true
    },
    accept(loc) {
      if (open) return true
      if (readyAt === null) return false
      if (loc.position === target!.position || loc.progress >= target!.progress - 0.0005 || now() - readyAt > timeoutMs) {
        open = true
        return true
      }
      return false
    },
  }
}
