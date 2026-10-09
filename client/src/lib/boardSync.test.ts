import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoardSync, type SyncedScene } from './boardSync'

const scene = (n: number): SyncedScene => ({ elements: [{ id: `e${n}` }], appState: {} })

function setup(opts: { fail?: () => boolean; fatal?: boolean; latency?: number } = {}) {
  const sent: Array<{ id: number; n: number; keepalive: boolean }> = []
  const saved: number[] = []
  const sync = createBoardSync({
    send: (id, s, { keepalive }) => {
      sent.push({ id, n: (s.elements[0] as { id: string }).id === 'e0' ? 0 : Number((s.elements[0] as { id: string }).id.slice(1)), keepalive })
      return new Promise((resolve, reject) =>
        setTimeout(() => (opts.fail?.() ? reject(new Error('offline')) : resolve()), opts.latency ?? 50),
      )
    },
    isFatal: () => Boolean(opts.fatal),
    onSaved: (id) => saved.push(id),
  })
  return { sent, saved, sync }
}

describe('board save queue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces a burst of edits into one request with the latest scene', async () => {
    const { sent, saved, sync } = setup()
    sync.queue(1, scene(1))
    await vi.advanceTimersByTimeAsync(200)
    sync.queue(1, scene(2))
    sync.queue(1, scene(3))
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent).toEqual([{ id: 1, n: 3, keepalive: false }])
    expect(saved).toEqual([1])
    expect(sync.isPending(1)).toBe(false)
  })

  it('keeps one request in flight and sends newer strokes right after', async () => {
    const { sent, sync } = setup({ latency: 300 })
    sync.queue(1, scene(1))
    await vi.advanceTimersByTimeAsync(500) // request 1 starts
    sync.queue(1, scene(2))
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).toHaveLength(1) // still in flight; follow-up waits
    expect(sync.peek(1)).toBeDefined()
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent.map((s) => s.n)).toEqual([1, 2])
    expect(sync.isPending(1)).toBe(false)
  })

  it('flush sends immediately without waiting for the debounce', async () => {
    const { sent, sync } = setup()
    sync.queue(1, scene(1))
    void sync.flush(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toHaveLength(1)
  })

  it('retries with back-off and never loses the scene', async () => {
    let failing = true
    const { sent, saved, sync } = setup({ fail: () => failing })
    sync.queue(1, scene(1))
    await vi.advanceTimersByTimeAsync(600) // attempt 1 fails
    expect(sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1100) // retry after 1 s fails
    expect(sent).toHaveLength(2)
    expect(sync.peek(1)).toBeDefined()
    failing = false
    await vi.advanceTimersByTimeAsync(2100) // retry after 2 s succeeds
    expect(sent).toHaveLength(3)
    expect(saved).toEqual([1])
  })

  it('a newer scene during back-off replaces the failed one', async () => {
    let failing = true
    const { sent, sync } = setup({ fail: () => failing })
    sync.queue(1, scene(1))
    await vi.advanceTimersByTimeAsync(600)
    failing = false
    sync.queue(1, scene(2))
    await vi.advanceTimersByTimeAsync(1500)
    expect(sent[sent.length - 1]?.n).toBe(2)
    expect(sync.isPending(1)).toBe(false)
  })

  it('parks after max retries; retryFailed revives it', async () => {
    let failing = true
    const { sent, saved, sync } = setup({ fail: () => failing })
    sync.queue(1, scene(1))
    await vi.advanceTimersByTimeAsync(60_000)
    const attempts = sent.length
    expect(attempts).toBe(5)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent.length).toBe(attempts) // parked
    expect(sync.isPending(1)).toBe(true)
    failing = false
    sync.retryFailed()
    await vi.advanceTimersByTimeAsync(100)
    expect(saved).toEqual([1])
  })

  it('drops scenes the server rejects for good (no retry loop)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { sent, sync } = setup({ fail: () => true, fatal: true })
    sync.queue(1, scene(1))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toHaveLength(1)
    expect(sync.isPending(1)).toBe(false)
    err.mockRestore()
  })

  it('holds temp-id boards in memory and uploads them after remap', async () => {
    const { sent, saved, sync } = setup()
    sync.queue(-5, scene(1))
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent).toHaveLength(0)
    expect(sync.peek(-5)).toBeDefined()
    sync.remap(-5, 42)
    expect(sync.peek(-5)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(200)
    expect(sent).toEqual([{ id: 42, n: 1, keepalive: false }])
    expect(saved).toEqual([42])
  })

  it('flushOnExit sends pending scenes with keepalive', async () => {
    const { sent, sync } = setup()
    sync.queue(1, scene(1))
    sync.flushOnExit()
    expect(sent).toEqual([{ id: 1, n: 1, keepalive: true }])
  })

  it('forget discards pending work', async () => {
    const { sent, sync } = setup()
    sync.queue(1, scene(1))
    sync.forget(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toHaveLength(0)
  })
})
