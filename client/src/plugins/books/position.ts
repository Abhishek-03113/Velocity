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

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const writeLocal = (value: StoredPosition) => {
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
      console.error('[books] could not save reading position (kept locally)', err)
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
    void send(true)
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)

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
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    },
  }
}

/** The position to open at: the newest of the server row and this browser's local entry. */
export function pickStartPosition(book: Pick<Book, 'position' | 'updated_at'>, local: StoredPosition | undefined): string | null {
  const serverPosition = book.position || null
  if (!local || typeof local.position !== 'string' || !local.position) return serverPosition
  if (!serverPosition) return local.position
  if (local.unsynced) return local.position
  return local.at > parseServerTime(book.updated_at) ? local.position : serverPosition
}
