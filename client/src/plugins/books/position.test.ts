import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSessionPositions,
  createPositionSync,
  createRestoreGuard,
  getSessionPosition,
  pickStart,
  pickStartPosition,
  posKey,
  type StoredPosition,
} from './position'
import type { ProgressPatch } from './types'

function setup(opts: { finished?: boolean; startPosition?: string | null; fail?: boolean } = {}) {
  const store = new Map<string, unknown>()
  const storage = {
    get: <T,>(k: string) => store.get(k) as T | undefined,
    set: (k: string, v: unknown) => void store.set(k, v),
  }
  const local: ProgressPatch[] = []
  const saved: { patch: ProgressPatch; keepalive?: boolean }[] = []
  const state = { fail: opts.fail === true }
  const host = {
    setLocalProgress: (_id: number, patch: ProgressPatch) => void local.push(patch),
    saveProgress: vi.fn(async (_id: number, patch: ProgressPatch, o?: { keepalive?: boolean }) => {
      if (state.fail) throw new Error('offline')
      saved.push({ patch, keepalive: o?.keepalive })
    }),
  }
  const sync = createPositionSync({ bookId: 7, host, storage, finished: opts.finished, startPosition: opts.startPosition })
  return { sync, store, local, saved, host, state }
}

describe('createPositionSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('updates the store and local storage at once, PATCHes after 1.5 s of quiet', async () => {
    const { sync, store, local, saved } = setup()
    sync.update({ position: 'cfi-1', progress: 0.1 })
    expect(local).toEqual([{ position: 'cfi-1', progress: 0.1, status: 'reading' }])
    expect(store.get(posKey(7))).toMatchObject({ position: 'cfi-1', progress: 0.1, at: Date.now() })
    await vi.advanceTimersByTimeAsync(1400)
    expect(saved).toHaveLength(0)
    sync.update({ position: 'cfi-2', progress: 0.2 })
    await vi.advanceTimersByTimeAsync(1400)
    expect(saved).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(saved).toEqual([{ patch: { position: 'cfi-2', progress: 0.2, status: 'reading' }, keepalive: undefined }])
    sync.dispose()
  })

  it('ignores a repeated position + progress', async () => {
    const { sync, local } = setup()
    sync.update({ position: 'a', progress: 0.3 })
    sync.update({ position: 'a', progress: 0.3 })
    expect(local).toHaveLength(1)
    sync.update({ position: 'a', progress: 0.31 })
    expect(local).toHaveLength(2)
    sync.dispose()
  })

  it('does not count opening at 0% as reading', () => {
    const { sync, local } = setup({ startPosition: 'cfi-start' })
    sync.update({ position: 'cfi-start', progress: 0 })
    expect(local).toHaveLength(0)
    sync.update({ position: 'cfi-start', progress: 0.05 })
    expect(local).toHaveLength(1)
    sync.dispose()
  })

  it('marks finished at 98% and never downgrades', async () => {
    const { sync, local } = setup()
    sync.update({ position: 'x', progress: 0.97 })
    sync.update({ position: 'y', progress: 0.98 })
    sync.update({ position: 'z', progress: 0.4 })
    expect(local.map((p) => p.status)).toEqual(['reading', 'finished', 'finished'])
    sync.dispose()
  })

  it('keeps a book that was finished on open finished', () => {
    const { sync, local } = setup({ finished: true })
    sync.update({ position: 'p', progress: 0.2 })
    expect(local[0].status).toBe('finished')
    sync.dispose()
  })

  it('flushes with keepalive on dispose and on pagehide', async () => {
    const a = setup()
    a.sync.update({ position: 'p', progress: 0.5 })
    a.sync.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(a.saved).toEqual([{ patch: { position: 'p', progress: 0.5, status: 'reading' }, keepalive: true }])

    const b = setup()
    b.sync.update({ position: 'q', progress: 0.6 })
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(b.saved).toEqual([{ patch: { position: 'q', progress: 0.6, status: 'reading' }, keepalive: true }])
    b.sync.dispose()
  })

  it('keeps the local copy on failure and retries on the next flush', async () => {
    const { sync, store, saved, state } = setup({ fail: true })
    sync.update({ position: 'p', progress: 0.5 })
    await vi.advanceTimersByTimeAsync(1600)
    expect(saved).toHaveLength(0)
    expect(console.error).toHaveBeenCalled()
    expect(store.get(posKey(7))).toMatchObject({ position: 'p', unsynced: true })
    state.fail = false
    await sync.flush()
    expect(saved).toHaveLength(1)
    // synced: the unsynced marker is cleared
    expect((store.get(posKey(7)) as StoredPosition).unsynced).toBeUndefined()
    sync.dispose()
  })

  it('does not log a failure while the page is unloading, but still keeps the copy', async () => {
    const { sync, store } = setup({ fail: true })
    sync.update({ position: 'p', progress: 0.5 })
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(console.error).not.toHaveBeenCalled()
    expect(store.get(posKey(7))).toMatchObject({ position: 'p', unsynced: true })
    sync.dispose()
  })

  it('stops after dispose', async () => {
    const { sync, local } = setup()
    sync.dispose()
    sync.update({ position: 'p', progress: 0.5 })
    expect(local).toHaveLength(0)
  })
})

describe('pickStartPosition', () => {
  const book = { position: 'server-cfi', updated_at: '2026-11-18 10:00:00' }
  const serverMs = Date.parse('2026-11-18T10:00:00Z')

  it('uses the server position without a local entry', () => {
    expect(pickStartPosition(book, undefined)).toBe('server-cfi')
    expect(pickStartPosition({ position: null, updated_at: book.updated_at }, undefined)).toBeNull()
  })

  it('prefers the newer of server and local', () => {
    expect(pickStartPosition(book, { position: 'local', progress: 0.5, at: serverMs + 1000 })).toBe('local')
    expect(pickStartPosition(book, { position: 'local', progress: 0.5, at: serverMs - 1000 })).toBe('server-cfi')
  })

  it('prefers a local entry the server never confirmed', () => {
    expect(pickStartPosition(book, { position: 'local', progress: 0.5, at: serverMs - 5000, unsynced: true })).toBe('local')
  })

  it('uses the local entry when the server has none', () => {
    expect(pickStartPosition({ position: null, updated_at: book.updated_at }, { position: 'local', progress: 0.1, at: 1 })).toBe('local')
  })
})

describe('session cache and newest wins', () => {
  const book = { position: 'server-cfi', progress: 0.1, updated_at: '2026-11-18 10:00:00' }
  const serverMs = Date.parse('2026-11-18T10:00:00Z')

  beforeEach(() => clearSessionPositions())

  it('records every position of the session, including the synced marker', async () => {
    vi.useFakeTimers()
    const { sync } = setup()
    sync.update({ position: 'cfi-9', progress: 0.9 })
    expect(getSessionPosition(7)).toMatchObject({ position: 'cfi-9', progress: 0.9, unsynced: true })
    await sync.flush()
    expect(getSessionPosition(7)).toMatchObject({ position: 'cfi-9' })
    expect(getSessionPosition(7)!.unsynced).toBeUndefined()
    sync.dispose()
    vi.useRealTimers()
  })

  it('opens at the session position without the server or storage', () => {
    const session: StoredPosition = { position: 'session', progress: 0.5, at: serverMs + 10 }
    expect(pickStartPosition(book, undefined, session)).toBe('session')
  })

  it('the newer of session and local wins; an unconfirmed one beats the server', () => {
    const local: StoredPosition = { position: 'local', progress: 0.4, at: serverMs + 5 }
    expect(pickStartPosition(book, local, { position: 'session', progress: 0.5, at: serverMs + 9 })).toBe('session')
    expect(pickStartPosition(book, { ...local, at: serverMs + 20 }, { position: 'session', progress: 0.5, at: serverMs + 9 })).toBe('local')
    expect(pickStartPosition(book, undefined, { position: 'session', progress: 0.5, at: serverMs - 99, unsynced: true })).toBe('session')
  })

  it('a newer server row (another device) beats a stale synced session entry', () => {
    expect(pickStartPosition(book, undefined, { position: 'session', progress: 0.5, at: serverMs - 1000 })).toBe('server-cfi')
  })

  it('pickStart returns the progress of the winning source', () => {
    expect(pickStart(book, undefined, { position: 's', progress: 0.77, at: serverMs + 1 })).toEqual({ position: 's', progress: 0.77 })
    expect(pickStart(book, undefined)).toEqual({ position: 'server-cfi', progress: 0.1 })
    expect(pickStart({ position: null, progress: 0, updated_at: book.updated_at }, undefined)).toBeNull()
  })
})

describe('createRestoreGuard (no drift on reopen)', () => {
  it('saves nothing before the engine is ready, nor a location earlier than the target', () => {
    const g = createRestoreGuard({ position: 'cfi-target', progress: 0.5 })
    expect(g.accept({ position: 'cfi-early', progress: 0.01 })).toBe(false)
    g.ready()
    expect(g.accept({ position: 'cfi-early', progress: 0.01 })).toBe(false)
    expect(g.accept({ position: 'cfi-target', progress: 0.5 })).toBe(true)
    // latched: the reader may now go back
    expect(g.accept({ position: 'cfi-early', progress: 0.01 })).toBe(true)
  })

  it('accepts a location at or after the target progress', () => {
    const g = createRestoreGuard({ position: 'cfi-target', progress: 0.5 })
    g.ready()
    expect(g.accept({ position: 'cfi-other', progress: 0.5 })).toBe(true)
  })

  it('has nothing to guard without a target', () => {
    expect(createRestoreGuard(null).accept({ position: 'x', progress: 0 })).toBe(true)
  })

  it('releases on user navigation and after the timeout', () => {
    const a = createRestoreGuard({ position: 't', progress: 0.9 })
    a.ready()
    expect(a.accept({ position: 'p', progress: 0.1 })).toBe(false)
    a.release()
    expect(a.accept({ position: 'p', progress: 0.1 })).toBe(true)

    let t = 1000
    const b = createRestoreGuard({ position: 't', progress: 0.9 }, 4000, () => t)
    b.ready()
    t += 3000
    expect(b.accept({ position: 'p', progress: 0.1 })).toBe(false)
    t += 1500
    expect(b.accept({ position: 'p', progress: 0.1 })).toBe(true)
  })
})
