import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

afterEach(() => {
  vi.doUnmock('../lib/runtime')
  vi.resetModules()
})

describe('server-only plugins in the browser-only build', () => {
  it('never activate: no commands, no URL handlers, reported unavailable', async () => {
    vi.doMock('../lib/runtime', () => ({ BROWSER_ONLY: true }))
    const { usePluginStore, pluginUnavailable } = await import('../store/pluginStore')
    const { startPlugins, pluginCommands, urlHandlerFor } = await import('./host')
    usePluginStore.setState({ enabled: {}, settings: {} })
    const stop = startPlugins()
    expect(pluginUnavailable('blog-reader')).toBe(true)
    expect(usePluginStore.getState().isEnabled('blog-reader')).toBe(false)
    expect(pluginCommands()).toHaveLength(0)
    expect(urlHandlerFor('https://example.com/post')).toBeNull()
    stop()
  })

  it('stay available when there is a server', async () => {
    vi.doMock('../lib/runtime', () => ({ BROWSER_ONLY: false }))
    const { pluginUnavailable, usePluginStore } = await import('../store/pluginStore')
    expect(pluginUnavailable('blog-reader')).toBe(false)
    expect(usePluginStore.getState().isEnabled('blog-reader')).toBe(true)
  })
})
