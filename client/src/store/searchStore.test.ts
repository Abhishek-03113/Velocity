import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('searchStore persistence (memory leak regression)', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterEach(() => {
    setItemSpy.mockRestore()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('does not write to localStorage synchronously on every keystroke', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { indexPaste } = useSearchStore.getState()

    // Simulate a burst of keystrokes — each one calls indexPaste synchronously,
    // as editorStore.setContent does today.
    for (let i = 0; i < 50; i++) {
      indexPaste({ id: 1, title: 'note', content: 'a'.repeat(i) })
    }

    // The full export/stringify/write must not have happened yet — it should
    // be batched, not run once per call.
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('batches rapid indexPaste calls into a single debounced persist', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { indexPaste } = useSearchStore.getState()

    for (let i = 0; i < 50; i++) {
      indexPaste({ id: 1, title: 'note', content: 'a'.repeat(i) })
    }

    await vi.advanceTimersByTimeAsync(2000)

    // One flush writes both keys (index + docs) — not one write per keystroke.
    const indexWrites = setItemSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'velocity:search-index'
    )
    expect(indexWrites).toHaveLength(1)
  })

  it('resets the debounce window on each new call (trailing-edge only)', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { indexPaste } = useSearchStore.getState()

    indexPaste({ id: 1, title: 'note', content: 'a' })
    await vi.advanceTimersByTimeAsync(1500)
    expect(setItemSpy).not.toHaveBeenCalled()

    // A new keystroke before the window elapses pushes the deadline out again.
    indexPaste({ id: 1, title: 'note', content: 'ab' })
    await vi.advanceTimersByTimeAsync(1500)
    expect(setItemSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(setItemSpy).toHaveBeenCalled()
  })

  it('flushes immediately on removePaste (infrequent path)', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { indexPaste, removePaste } = useSearchStore.getState()

    indexPaste({ id: 1, title: 'note', content: 'a' })
    setItemSpy.mockClear()

    removePaste(1)

    expect(setItemSpy).toHaveBeenCalled()
  })

  it('flushes immediately on hydrateIndex (startup batch)', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { hydrateIndex } = useSearchStore.getState()

    hydrateIndex([
      { id: 1, title: 'a', content: 'a' },
      { id: 2, title: 'b', content: 'b' },
      { id: 3, title: 'c', content: 'c' },
    ])

    // A single flush for the whole batch, not one per note.
    const indexWrites = setItemSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'velocity:search-index'
    )
    expect(indexWrites).toHaveLength(1)
  })

  it('flushIndex forces a pending debounced write out immediately', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { indexPaste, flushIndex } = useSearchStore.getState()

    indexPaste({ id: 1, title: 'note', content: 'a' })
    expect(setItemSpy).not.toHaveBeenCalled()

    flushIndex()

    expect(setItemSpy).toHaveBeenCalled()
  })

  it('a pending debounced write is not duplicated once it fires', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { indexPaste } = useSearchStore.getState()

    indexPaste({ id: 1, title: 'note', content: 'a' })
    await vi.advanceTimersByTimeAsync(2000)
    const callsAfterFirstFlush = setItemSpy.mock.calls.length

    await vi.advanceTimersByTimeAsync(5000)
    expect(setItemSpy.mock.calls.length).toBe(callsAfterFirstFlush)
  })
})
