import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addAnnotation,
  bindAnnotationSync,
  clearBookAnnotations,
  hasPendingAnnotations,
  isAnnotationSyncParked,
  loadAnnotations,
  NO_ANNOTATIONS,
  removeAnnotation,
  resetAnnotations,
  updateAnnotation,
  useAnnotationsStore,
  type AnnotationsApi,
} from './annotations'
import { BooksApiError } from './api'
import type { BookAnnotation, NewAnnotation } from './types'

const hl = (over: Partial<NewAnnotation> = {}): NewAnnotation => ({
  kind: 'highlight',
  locator: 'loc-a',
  text: 'A passage',
  note: null,
  color: 'yellow',
  style: 'highlight',
  chapter: 'One',
  progress: 0.2,
  page: null,
  ...over,
})
const bm = (over: Partial<NewAnnotation> = {}): NewAnnotation => hl({ kind: 'bookmark', text: null, color: null, style: null, ...over })

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  return {
    data,
    get: <T,>(key: string) => data[key] as T | undefined,
    set: (key: string, value: unknown) => {
      data[key] = JSON.parse(JSON.stringify(value))
    },
  }
}

/** A deferred server: each call waits until the test resolves or rejects it. */
function fakeApi() {
  let serverId = 100
  const calls: string[] = []
  const gates: { resolve: () => void; reject: (e: unknown) => void }[] = []
  const gate = () =>
    new Promise<void>((resolve, reject) => {
      gates.push({ resolve, reject })
    })
  const api: AnnotationsApi = {
    list: vi.fn(async () => []),
    create: vi.fn(async (bookId, input) => {
      calls.push(`create ${input.locator}`)
      await gate()
      return { ...input, id: ++serverId, book_id: bookId, created_at: '2026-11-19 10:00:00', updated_at: '2026-11-19 10:00:00' } as BookAnnotation
    }),
    patch: vi.fn(async (bookId, id, patch) => {
      calls.push(`patch ${id} ${JSON.stringify(patch)}`)
      await gate()
      return { id, book_id: bookId } as BookAnnotation
    }),
    remove: vi.fn(async (_b, id) => {
      calls.push(`remove ${id}`)
      await gate()
    }),
    clear: vi.fn(async (_b, kind) => {
      calls.push(`clear ${kind}`)
      await gate()
    }),
  }
  return { api, calls, gates, next: () => gates.shift()! }
}

const rows = (bookId = 1) => useAnnotationsStore.getState().byBook[bookId] ?? []
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('annotations store', () => {
  let unbind: (() => void) | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    resetAnnotations()
  })
  afterEach(() => {
    unbind?.()
    unbind = undefined
    resetAnnotations()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('adds optimistically with a negative temp id, in reading order', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    const a = addAnnotation(1, hl({ locator: 'late', progress: 0.8 }))
    const b = addAnnotation(1, hl({ locator: 'early', progress: 0.1 }))
    const c = addAnnotation(1, hl({ locator: 'mid', progress: 0.5 }))
    expect([a.id, b.id, c.id].every((id) => id < 0)).toBe(true)
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    expect(rows().map((r) => r.locator)).toEqual(['early', 'mid', 'late'])
  })

  it('swaps the temp id for the server row in place when confirmed', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    addAnnotation(1, hl({ locator: 'a', progress: 0.1 }))
    addAnnotation(1, hl({ locator: 'b', progress: 0.2 }))
    await flush()
    fake.next().resolve()
    await flush()
    expect(rows().map((r) => r.id)[0]).toBe(101)
    expect(rows()[1]!.id).toBeLessThan(0)
    fake.next().resolve()
    await flush()
    expect(rows().map((r) => r.id)).toEqual([101, 102])
    expect(hasPendingAnnotations()).toBe(false)
  })

  it('applies a patch and a delete issued against a temp id to the real id after confirm', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    const a = addAnnotation(1, hl())
    await flush() // create is now in flight
    updateAnnotation(1, a.id, { note: 'hello' })
    expect(rows()[0]!.note).toBe('hello')
    fake.next().resolve()
    await flush()
    expect(fake.calls).toEqual(['create loc-a', 'patch 101 {"note":"hello"}'])
    fake.next().resolve()
    await flush()
    removeAnnotation(1, 101)
    await flush()
    expect(fake.calls.at(-1)).toBe('remove 101')
    fake.next().resolve()
    await flush()
    expect(rows()).toEqual([])
  })

  it('a delete queued while the create is in flight targets the real id', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    const a = addAnnotation(1, hl())
    await flush()
    removeAnnotation(1, a.id)
    expect(rows()).toEqual([])
    fake.next().resolve()
    await flush()
    expect(rows()).toEqual([]) // the confirmed row does not come back
    expect(fake.calls.at(-1)).toBe('remove 101')
  })

  it('folds edits and deletes of a not-yet-sent row into nothing', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    addAnnotation(1, hl({ locator: 'first' })) // goes in flight
    await flush()
    const queued = addAnnotation(1, hl({ locator: 'second', progress: 0.9 }))
    updateAnnotation(1, queued.id, { color: 'pink' })
    removeAnnotation(1, queued.id)
    fake.next().resolve()
    await flush()
    expect(fake.calls).toEqual(['create first'])
    expect(hasPendingAnnotations()).toBe(false)
  })

  it('merges edits into a waiting create', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    addAnnotation(1, hl({ locator: 'first' }))
    await flush()
    const queued = addAnnotation(1, hl({ locator: 'second', progress: 0.9 }))
    updateAnnotation(1, queued.id, { note: 'n', color: 'blue' })
    fake.next().resolve()
    await flush()
    expect(fake.api.create).toHaveBeenLastCalledWith(1, expect.objectContaining({ locator: 'second', note: 'n', color: 'blue' }))
  })

  it('dedupes bookmarks by locator', () => {
    unbind = bindAnnotationSync(memoryStorage(), fakeApi().api)
    const first = addAnnotation(1, bm({ locator: 'page:3' }))
    const again = addAnnotation(1, bm({ locator: 'page:3' }))
    expect(again).toBe(first)
    expect(rows()).toHaveLength(1)
  })

  it('keeps the local row on failure, retries with back-off, then parks and resumes on focus', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    addAnnotation(1, hl())
    for (let i = 0; i < 3; i++) {
      await flush()
      fake.next().reject(new BooksApiError('down', 0))
      await flush()
      await vi.advanceTimersByTimeAsync(i === 0 ? 1000 : 2000)
    }
    expect(fake.api.create).toHaveBeenCalledTimes(3)
    expect(isAnnotationSyncParked()).toBe(true)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.id).toBeLessThan(0)
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(fake.api.create).toHaveBeenCalledTimes(4)
    fake.next().resolve()
    await flush()
    expect(rows()[0]!.id).toBe(101)
    expect(hasPendingAnnotations()).toBe(false)
  })

  it('drops an op the server will never accept (4xx) and moves on', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    addAnnotation(1, hl({ locator: 'x', progress: 0.1 }))
    addAnnotation(1, hl({ locator: 'y', progress: 0.2 }))
    await flush()
    fake.next().reject(new BooksApiError('gone', 404))
    await flush()
    expect(fake.api.create).toHaveBeenCalledTimes(2)
    expect(rows().map((r) => r.locator)).toEqual(['y'])
  })

  it('persists pending ops and restores unsynced highlights after a reload', async () => {
    const storage = memoryStorage()
    const fake = fakeApi()
    unbind = bindAnnotationSync(storage, fake.api)
    const a = addAnnotation(1, hl({ locator: 'kept', note: 'mine' }))
    await flush()
    expect(storage.data.pendingAnnotations).toHaveLength(1)
    unbind()
    resetAnnotations() // the page goes away; storage stays

    const again = fakeApi()
    unbind = bindAnnotationSync(storage, again.api)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ id: a.id, locator: 'kept', note: 'mine' })
    // New temp ids never collide with restored ones.
    const b = addAnnotation(1, hl({ locator: 'new', progress: 0.9 }))
    expect(b.id).toBeLessThan(a.id)
    await flush()
    expect(again.api.create).toHaveBeenCalledWith(1, expect.objectContaining({ locator: 'kept' }))
    again.next().resolve()
    await flush()
    expect(storage.data.pendingAnnotations).toHaveLength(1) // only "new" remains
  })

  it('lays unsynced changes over the server list when a book loads', async () => {
    const fake = fakeApi()
    const server = (id: number, locator: string, progress: number): BookAnnotation => ({
      ...hl({ locator, progress }),
      id,
      book_id: 1,
      created_at: '2026-11-01 00:00:00',
      updated_at: '2026-11-01 00:00:00',
    })
    fake.api.list = vi.fn(async () => [server(7, 's1', 0.1), server(8, 's2', 0.3)])
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    addAnnotation(1, hl({ locator: 'local', progress: 0.2 }))
    await loadAnnotations(1)
    expect(rows().map((r) => r.locator)).toEqual(['s1', 'local', 's2'])
    await loadAnnotations(1)
    expect(fake.api.list).toHaveBeenCalledTimes(1)
  })

  it('clears a kind locally at once and on the server', async () => {
    const fake = fakeApi()
    unbind = bindAnnotationSync(memoryStorage(), fake.api)
    useAnnotationsStore.setState({
      byBook: {
        1: [
          { ...hl(), id: 5, book_id: 1, created_at: '', updated_at: '' },
          { ...bm({ locator: 'p' }), id: 6, book_id: 1, created_at: '', updated_at: '' },
        ],
      },
    })
    clearBookAnnotations(1, 'highlight')
    expect(rows().map((r) => r.kind)).toEqual(['bookmark'])
    await flush()
    expect(fake.calls).toEqual(['clear highlight'])
  })

  it('exposes one stable empty list', () => {
    expect(useAnnotationsStore.getState().byBook[42] ?? NO_ANNOTATIONS).toBe(NO_ANNOTATIONS)
  })
})
