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

describe('searchStore persistence (dirty flag, idle, pagehide)', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterEach(() => {
    setItemSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('../lib/runtime')
  })

  it('does not rewrite the index when nothing changed since the last persist', async () => {
    const { useSearchStore } = await import('./searchStore')
    const { indexPaste, flushIndex } = useSearchStore.getState()
    indexPaste({ id: 1, title: 'note', content: 'a' })
    flushIndex()
    const calls = setItemSpy.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    flushIndex()
    flushIndex()
    expect(setItemSpy.mock.calls.length).toBe(calls)
  })

  it('flushes a pending write on pagehide, synchronously', async () => {
    const { useSearchStore } = await import('./searchStore')
    useSearchStore.getState().indexPaste({ id: 1, title: 'note', content: 'a' })
    expect(setItemSpy).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pagehide'))
    expect(setItemSpy).toHaveBeenCalled()
  })

  it('runs the debounced persist inside an idle callback when available', async () => {
    let idle: (() => void) | null = null
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      idle = cb
      return 7
    })
    vi.stubGlobal('cancelIdleCallback', () => {})
    const { useSearchStore } = await import('./searchStore')
    useSearchStore.getState().indexPaste({ id: 1, title: 'note', content: 'a' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(idle).not.toBeNull()
    idle!()
    expect(setItemSpy).toHaveBeenCalled()
  })

  it('browser-only: never persists the index or docs and removes stale keys', async () => {
    vi.doMock('../lib/runtime', () => ({ BROWSER_ONLY: true }))
    localStorage.setItem('velocity:search-index', '{}')
    localStorage.setItem('velocity:search-docs', '[]')
    setItemSpy.mockClear()
    const { useSearchStore, cachedContent } = await import('./searchStore')
    await useSearchStore.getState().ensureReady()
    expect(localStorage.getItem('velocity:search-index')).toBeNull()
    expect(localStorage.getItem('velocity:search-docs')).toBeNull()

    const { indexPaste, hydrateIndex, removePaste, flushIndex } = useSearchStore.getState()
    hydrateIndex([{ id: 1, title: 'alpha', content: undefined }])
    indexPaste({ id: 1, title: 'alpha', content: 'hello world' })
    await vi.advanceTimersByTimeAsync(5000)
    flushIndex()
    window.dispatchEvent(new Event('pagehide'))
    removePaste(2)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(cachedContent(1)).toBe('hello world')
  })
})
