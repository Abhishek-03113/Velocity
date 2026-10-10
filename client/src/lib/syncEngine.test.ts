import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncEngine, type SyncPayload, type SyncStatus } from './syncEngine'

type Note = { title: string; content: string; group_id: number | null }

function setup(opts: { fail?: () => boolean; latency?: number } = {}) {
  const notes = new Map<number, Note>([[1, { title: 'A', content: '', group_id: null }]])
  const sent: Array<{ id: number; payload: SyncPayload; keepalive: boolean }> = []
  const saved: number[] = []
  const statuses: Array<[number, SyncStatus | null]> = []
  const engine = createSyncEngine({
    snapshot: (id) => notes.get(id) ?? null,
    send: (id, payload, { keepalive }) => {
      sent.push({ id, payload: { ...payload }, keepalive })
      return new Promise((resolve, reject) =>
        setTimeout(() => (opts.fail?.() ? reject(new Error('offline')) : resolve()), opts.latency ?? 50),
      )
    },
    onSaved: (id) => saved.push(id),
    onStatus: (id, s) => statuses.push([id, s]),
  })
  const edit = (content: string) => {
    notes.get(1)!.content = content
    engine.markDirty(1, ['content'])
  }
  return { notes, sent, saved, statuses, engine, edit }
}

describe('auto-save worker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces a burst of keystrokes into one write', async () => {
    const { sent, saved, edit } = setup()
    for (let i = 0; i < 20; i++) {
      edit('x'.repeat(i + 1))
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(900)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload).toEqual({ content: 'x'.repeat(20) })
    expect(saved).toEqual([1])
  })

  it('checkpoints long typing sessions via max-wait', async () => {
    const { sent, edit } = setup()
    // Type every 300ms for 7s — a plain debounce would never fire.
    for (let i = 0; i < 24; i++) {
      edit(`v${i}`)
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(sent.length).toBeGreaterThanOrEqual(1)
  })

  it('keeps one request in flight and coalesces edits made meanwhile', async () => {
    const { sent, saved, edit, engine } = setup({ latency: 1000 })
    edit('one')
    void engine.flush(1)
    await vi.advanceTimersByTimeAsync(10)
    // Two more edits + explicit flushes while "one" is in flight: no concurrent PUTs.
    edit('two')
    void engine.flush(1)
    edit('three')
    void engine.flush(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(sent.map((s) => s.payload.content)).toEqual(['one'])
    // When "one" lands, the queued edits go out as exactly one follow-up write.
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent.map((s) => s.payload.content)).toEqual(['one', 'three'])
    await vi.advanceTimersByTimeAsync(1100)
    expect(sent).toHaveLength(2)
    expect(saved).toEqual([1])
  })

  it('does not mark newer edits as saved when an older save completes', async () => {
    const { saved, edit, engine } = setup({ latency: 500 })
    edit('old')
    void engine.flush(1)
    await vi.advanceTimersByTimeAsync(100)
    edit('new') // arrives while "old" is in flight
    await vi.advanceTimersByTimeAsync(450)
    // "old" finished, but "new" is still pending — must not report saved yet.
    expect(saved).toHaveLength(0)
    expect(engine.isPending(1)).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(saved).toEqual([1])
    expect(engine.isPending(1)).toBe(false)
  })

  it('sends only the fields that changed', async () => {
    const { notes, sent, engine } = setup()
    notes.get(1)!.title = 'Renamed'
    engine.markDirty(1, ['title'])
    await vi.advanceTimersByTimeAsync(900)
    expect(sent[0]!.payload).toEqual({ title: 'Renamed' })
  })

  it('never sends temp group ids', async () => {
    const { notes, sent, engine } = setup()
    notes.get(1)!.group_id = -3
    engine.markDirty(1, ['group_id', 'content'])
    await vi.advanceTimersByTimeAsync(900)
    expect(sent[0]!.payload).toEqual({ content: '' })
  })

  it('retries with back-off, then parks as error until retryFailed()', async () => {
    let failing = true
    const { sent, statuses, saved, edit, engine } = setup({ fail: () => failing, latency: 10 })
    edit('hello')
    await vi.advanceTimersByTimeAsync(800 + 10) // attempt 1
    await vi.advanceTimersByTimeAsync(1000 + 10) // attempt 2
    await vi.advanceTimersByTimeAsync(2000 + 10) // attempt 3
    expect(sent).toHaveLength(3)
    expect(statuses[statuses.length - 1]).toEqual([1, 'error'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toHaveLength(3) // parked — no busy retrying
    failing = false
    engine.retryFailed()
    await vi.advanceTimersByTimeAsync(20)
    expect(sent).toHaveLength(4)
    expect(saved).toEqual([1])
    expect(statuses[statuses.length - 1]).toEqual([1, null])
  })

  it('flushOnExit sends keepalive writes for pending notes', () => {
    const { sent, edit, engine } = setup()
    edit('unsaved')
    engine.flushOnExit()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.keepalive).toBe(true)
    expect(sent[0]!.payload.content).toBe('unsaved')
  })

  it('waits for temp ids and re-sends everything after remap', async () => {
    const notes = new Map<number, Note>([[-1, { title: 'Draft', content: 'body', group_id: null }]])
    const sent: Array<{ id: number; payload: SyncPayload }> = []
    const engine = createSyncEngine({
      snapshot: (id) => notes.get(id) ?? null,
      send: async (id, payload) => {
        sent.push({ id, payload })
      },
      onSaved: () => undefined,
      onStatus: () => undefined,
    })
    engine.markDirty(-1, ['content'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent).toHaveLength(0)
    notes.set(7, notes.get(-1)!)
    engine.remap(-1, 7)
    await vi.advanceTimersByTimeAsync(10)
    expect(sent).toEqual([{ id: 7, payload: { title: 'Draft', content: 'body' } }])
  })

  it('forget() cancels pending work for deleted notes', async () => {
    const { sent, edit, engine } = setup()
    edit('doomed')
    engine.forget(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toHaveLength(0)
  })
})
