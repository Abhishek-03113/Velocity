/**
 * Whiteboard save queue.
 *
 * One entry per board. Edits replace the pending scene (latest wins), so a burst of
 * strokes costs one request. Exactly one request is in flight per board; a scene
 * queued meanwhile goes out right after. Failures keep the scene and retry with
 * exponential back-off, then park until the next edit / reconnect / refocus.
 * Boards whose note has no server id yet (temp ids) just wait in memory.
 */

export interface SyncedScene {
  elements: unknown[]
  appState: Record<string, unknown>
  files?: Record<string, unknown>
}

export interface BoardSyncOptions<S = SyncedScene> {
  send: (id: number, scene: S, opts: { keepalive: boolean }) => Promise<void>
  /** Errors that retrying cannot fix (note deleted, payload rejected): the scene is dropped. */
  isFatal?: (err: unknown) => boolean
  canSend?: (id: number) => boolean
  onSaved?: (id: number) => void
  debounceMs?: number
  maxRetries?: number
}

interface Entry<S> {
  /** Newest scene not yet handed to `send`. */
  scene: S | null
  /** Scene of the request currently in flight. */
  sending: S | null
  timer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  queuedFlush: boolean
  attempt: number
}

export interface BoardSync<S = SyncedScene> {
  queue: (id: number, scene: S) => void
  /** Send now (if dirty); resolves once the attempt finishes. */
  flush: (id: number) => Promise<void>
  flushAll: () => Promise<void>
  /** Keepalive writes for everything unsaved — the page is going away. */
  flushOnExit: () => void
  /** Retry parked / backing-off boards immediately. */
  retryFailed: () => void
  /** Newest scene we hold that the server may not have yet. */
  peek: (id: number) => S | undefined
  remap: (from: number, to: number) => void
  forget: (id: number) => void
  isPending: (id: number) => boolean
}

export function createBoardSync<S = SyncedScene>(opts: BoardSyncOptions<S>): BoardSync<S> {
  const debounceMs = opts.debounceMs ?? 500
  const maxRetries = opts.maxRetries ?? 5
  const canSend = opts.canSend ?? ((id: number) => id > 0)
  const entries = new Map<number, Entry<S>>()

  const blank = (): Entry<S> => ({
    scene: null,
    sending: null,
    timer: null,
    retryTimer: null,
    inFlight: false,
    queuedFlush: false,
    attempt: 0,
  })

  const clearTimers = (e: Entry<S>) => {
    if (e.timer) clearTimeout(e.timer)
    if (e.retryTimer) clearTimeout(e.retryTimer)
    e.timer = null
    e.retryTimer = null
  }

  const idle = (e: Entry<S>) => e.scene === null && !e.inFlight

  async function flush(id: number): Promise<void> {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    if (entry.inFlight) {
      entry.queuedFlush = true
      return
    }
    if (entry.scene === null || !canSend(id)) return

    const scene = entry.scene
    entry.scene = null
    entry.sending = scene
    entry.inFlight = true
    let failure: unknown = null
    try {
      await opts.send(id, scene, { keepalive: false })
    } catch (err) {
      failure = err ?? new Error('send failed')
    }
    entry.inFlight = false
    entry.sending = null
    if (entries.get(id) !== entry) return // forgotten / remapped meanwhile

    if (failure === null) {
      entry.attempt = 0
      if (entry.scene !== null) {
        // Newer strokes arrived while saving.
        if (entry.queuedFlush) {
          entry.queuedFlush = false
          void flush(id)
        } else schedule(id, entry)
      } else {
        entry.queuedFlush = false
        opts.onSaved?.(id)
        entries.delete(id)
      }
      return
    }

    if (opts.isFatal?.(failure)) {
      console.error('[whiteboard] save rejected, dropping scene:', failure)
      entry.scene = null
      entry.queuedFlush = false
      entries.delete(id)
      return
    }

    // Keep the unsent scene unless a newer one already replaced it.
    if (entry.scene === null) entry.scene = scene
    entry.queuedFlush = false
    entry.attempt += 1
    if (entry.attempt < maxRetries) {
      entry.retryTimer = setTimeout(
        () => {
          entry.retryTimer = null
          void flush(id)
        },
        1000 * 2 ** (entry.attempt - 1),
      )
    }
    // else: parked — retryFailed() or the next edit revives it.
  }

  function schedule(id: number, entry: Entry<S>) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void flush(id)
    }, debounceMs)
  }

  return {
    queue(id, scene) {
      let entry = entries.get(id)
      if (!entry) {
        entry = blank()
        entries.set(id, entry)
      }
      entry.scene = scene
      if (entry.retryTimer) return // back-off pending; it will send the newest scene
      if (entry.attempt >= maxRetries) entry.attempt = 0 // parked: fresh set of retries
      schedule(id, entry)
    },

    flush,

    async flushAll() {
      await Promise.all([...entries.keys()].map((id) => flush(id)))
    },

    flushOnExit() {
      for (const [id, entry] of entries) {
        const scene = entry.scene ?? entry.sending
        if (scene === null || !canSend(id)) continue
        void opts.send(id, scene, { keepalive: true }).catch(() => undefined)
      }
    },

    retryFailed() {
      for (const [id, entry] of entries) {
        if (entry.scene === null || entry.inFlight) continue
        if (entry.retryTimer) clearTimeout(entry.retryTimer)
        entry.retryTimer = null
        entry.attempt = 0
        void flush(id)
      }
    },

    peek(id) {
      const entry = entries.get(id)
      return entry ? (entry.scene ?? entry.sending ?? undefined) : undefined
    },

    remap(from, to) {
      const entry = entries.get(from)
      if (!entry) return
      clearTimers(entry)
      entries.delete(from)
      const scene = entry.scene ?? entry.sending
      if (scene === null) return
      const target = blank()
      target.scene = scene
      entries.set(to, target)
      void flush(to)
    },

    forget(id) {
      const entry = entries.get(id)
      if (!entry) return
      clearTimers(entry)
      entries.delete(id)
    },

    isPending(id) {
      const entry = entries.get(id)
      return entry ? !idle(entry) : false
    },
  }
}
