/**
 * Auto-save worker.
 *
 * Responsibilities (per note):
 *  - debounce edits (800 ms) but never wait longer than MAX_WAIT (5 s) while typing
 *  - keep exactly one request in flight; edits made meanwhile coalesce into one follow-up
 *  - track revisions so a slow response can't mark newer edits as saved
 *  - send only the fields that changed
 *  - retry with exponential back-off, then park as "error" until the network
 *    returns, the window regains focus, or the user forces a save (⌘S)
 *  - flush (never cancel) on tab close; best-effort keepalive flush on page hide
 */

export type SyncField = 'title' | 'content' | 'group_id'
export type SyncStatus = 'pending' | 'saving' | 'error'
export type SyncPayload = Partial<{ title: string; content: string; group_id: number | null }>

export interface SyncEngineOptions {
  /** Current values for a note, or null if the note no longer exists. */
  snapshot: (id: number) => { title: string; content: string | undefined; group_id: number | null } | null
  /** Perform the write. Reject to trigger a retry. */
  send: (id: number, payload: SyncPayload, opts: { keepalive: boolean }) => Promise<void>
  /** Called when every edit up to the latest revision has been persisted. */
  onSaved: (id: number) => void
  onStatus: (id: number, status: SyncStatus | null) => void
  /** Whether a note can be written yet (temp ids wait for their POST). */
  canSend?: (id: number) => boolean
  debounceMs?: number
  maxWaitMs?: number
  maxRetries?: number
  now?: () => number
}

interface Entry {
  rev: number
  savedRev: number
  fields: Set<SyncField>
  firstDirtyAt: number
  timer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  queued: boolean
  attempt: number
  parked: boolean
}

export interface SyncEngine {
  markDirty: (id: number, fields: SyncField[]) => void
  flush: (id: number) => Promise<void>
  flushAll: () => Promise<void>
  /** Retry parked (failed) notes — on `online`, window focus or ⌘S. */
  retryFailed: () => void
  /** Fire-and-forget keepalive writes for everything pending (page is going away). */
  flushOnExit: () => void
  forget: (id: number) => void
  remap: (from: number, to: number) => void
  isPending: (id: number) => boolean
  pendingIds: () => number[]
}

export function createSyncEngine(opts: SyncEngineOptions): SyncEngine {
  const debounceMs = opts.debounceMs ?? 800
  const maxWaitMs = opts.maxWaitMs ?? 5000
  const maxRetries = opts.maxRetries ?? 3
  const now = opts.now ?? (() => Date.now())
  const canSend = opts.canSend ?? ((id: number) => id > 0)
  const entries = new Map<number, Entry>()

  const entryFor = (id: number): Entry => {
    let entry = entries.get(id)
    if (!entry) {
      entry = {
        rev: 0,
        savedRev: 0,
        fields: new Set(),
        firstDirtyAt: 0,
        timer: null,
        retryTimer: null,
        inFlight: false,
        queued: false,
        attempt: 0,
        parked: false,
      }
      entries.set(id, entry)
    }
    return entry
  }

  const clearTimers = (entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer)
    if (entry.retryTimer) clearTimeout(entry.retryTimer)
    entry.timer = null
    entry.retryTimer = null
  }

  const isDirty = (entry: Entry) => entry.fields.size > 0 || entry.rev !== entry.savedRev

  const buildPayload = (id: number, fields: Set<SyncField>): SyncPayload | null => {
    const snap = opts.snapshot(id)
    if (!snap) return null
    const payload: SyncPayload = {}
    if (fields.has('title')) payload.title = snap.title
    if (fields.has('content') && snap.content !== undefined) payload.content = snap.content
    // Temp (client-only) group ids are rejected by the API; replaceGroupId re-marks later.
    if (fields.has('group_id') && !(snap.group_id != null && snap.group_id < 0)) {
      payload.group_id = snap.group_id ?? null
    }
    return payload
  }

  const schedule = (id: number, entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer)
    const waited = now() - entry.firstDirtyAt
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - waited))
    entry.timer = setTimeout(() => {
      entry.timer = null
      void flush(id)
    }, delay)
  }

  async function flush(id: number): Promise<void> {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.inFlight) {
      entry.queued = true
      return
    }
    if (!isDirty(entry) || !canSend(id)) return

    const sentRev = entry.rev
    const sentFields = entry.fields
    const payload = buildPayload(id, sentFields)
    if (!payload) {
      forget(id)
      return
    }
    entry.fields = new Set()
    if (Object.keys(payload).length === 0) {
      entry.savedRev = sentRev
      settle(id, entry)
      return
    }

    entry.inFlight = true
    opts.onStatus(id, 'saving')
    let ok = false
    try {
      await opts.send(id, payload, { keepalive: false })
      ok = true
    } catch {
      ok = false
    }
    entry.inFlight = false
    if (!entries.has(id) || entries.get(id) !== entry) return // forgotten / remapped meanwhile

    if (ok) {
      entry.savedRev = Math.max(entry.savedRev, sentRev)
      entry.attempt = 0
      entry.parked = false
      settle(id, entry)
      return
    }

    // Failed: restore the unsent fields and back off.
    for (const f of sentFields) entry.fields.add(f)
    entry.attempt += 1
    entry.queued = false
    if (entry.attempt < maxRetries) {
      opts.onStatus(id, 'pending')
      entry.retryTimer = setTimeout(() => {
        entry.retryTimer = null
        void flush(id)
      }, 1000 * 2 ** (entry.attempt - 1))
    } else {
      entry.parked = true
      opts.onStatus(id, 'error')
    }
  }

  function settle(id: number, entry: Entry) {
    if (isDirty(entry)) {
      // Newer edits arrived while saving — send them right away if asked, else on the debounce.
      if (entry.queued) {
        entry.queued = false
        void flush(id)
      } else {
        opts.onStatus(id, 'pending')
        schedule(id, entry)
      }
      return
    }
    entry.queued = false
    entry.firstDirtyAt = 0
    opts.onStatus(id, null)
    opts.onSaved(id)
  }

  function forget(id: number) {
    const entry = entries.get(id)
    if (!entry) return
    clearTimers(entry)
    entries.delete(id)
    opts.onStatus(id, null)
  }

  return {
    markDirty(id, fields) {
      const entry = entryFor(id)
      entry.rev += 1
      for (const f of fields) entry.fields.add(f)
      if (!entry.firstDirtyAt) entry.firstDirtyAt = now()
      if (entry.parked) {
        // New edits give a parked note a fresh set of retries.
        entry.parked = false
        entry.attempt = 0
      }
      if (entry.retryTimer) return // back-off already pending; it will pick up the new fields
      if (!entry.inFlight) opts.onStatus(id, 'pending')
      schedule(id, entry)
    },

    flush,

    async flushAll() {
      await Promise.all([...entries.keys()].map((id) => flush(id)))
    },

    retryFailed() {
      for (const [id, entry] of entries) {
        if (!isDirty(entry) || entry.inFlight) continue
        if (entry.retryTimer) clearTimeout(entry.retryTimer)
        entry.retryTimer = null
        entry.parked = false
        entry.attempt = 0
        void flush(id)
      }
    },

    flushOnExit() {
      for (const [id, entry] of entries) {
        if (!isDirty(entry) || !canSend(id)) continue
        const fields = new Set([...entry.fields, ...(entry.inFlight ? (['title', 'content', 'group_id'] as const) : [])])
        const payload = buildPayload(id, fields.size ? fields : new Set<SyncField>(['title', 'content', 'group_id']))
        if (!payload || Object.keys(payload).length === 0) continue
        void opts.send(id, payload, { keepalive: true }).catch(() => undefined)
      }
    },

    forget,

    remap(from, to) {
      const entry = entries.get(from)
      if (!entry) return
      clearTimers(entry)
      entries.delete(from)
      opts.onStatus(from, null)
      // A freshly created server row only has what the POST carried — resend everything dirty.
      if (isDirty(entry)) {
        const target = entryFor(to)
        target.rev += 1
        for (const f of entry.fields) target.fields.add(f)
        target.fields.add('title')
        target.fields.add('content')
        target.firstDirtyAt = now()
        opts.onStatus(to, 'pending')
        void flush(to)
      }
    },

    isPending(id) {
      const entry = entries.get(id)
      return entry ? isDirty(entry) || entry.inFlight : false
    },

    pendingIds() {
      return [...entries.entries()].filter(([, e]) => isDirty(e) || e.inFlight).map(([id]) => id)
    },
  }
}
