import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.doUnmock('./runtime')
  vi.doUnmock('./local/backend')
})

describe('apiFetch', () => {
  it('server mode: plain fetch to base + path, init passed through (keepalive included)', async () => {
    vi.doMock('./runtime', () => ({ BROWSER_ONLY: false }))
    const handle = vi.fn()
    vi.doMock('./local/backend', () => ({ localBackend: () => ({ handle }) }))
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await import('./transport')
    const init = { method: 'PUT', body: '{}', keepalive: true }
    await apiFetch('/api/pastes/1', init)
    expect(fetchMock).toHaveBeenCalledWith('/api/pastes/1', init)
    expect(handle).not.toHaveBeenCalled()
  })

  it('browser-only: routes to the local backend and never touches fetch', async () => {
    vi.doMock('./runtime', () => ({ BROWSER_ONLY: true }))
    const handle = vi.fn().mockResolvedValue(new Response('{"success":true}'))
    vi.doMock('./local/backend', () => ({ localBackend: () => ({ handle }) }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await import('./transport')
    await apiFetch('/api/pastes/1', { method: 'PUT', body: '{"a":1}' })
    expect(handle).toHaveBeenCalledWith('PUT', '/api/pastes/1', '{"a":1}')
    await apiFetch('/api/groups')
    expect(handle).toHaveBeenLastCalledWith('GET', '/api/groups', '')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('browser-only: once loaded, handle() is invoked synchronously (pagehide flush)', async () => {
    vi.doMock('./runtime', () => ({ BROWSER_ONLY: true }))
    const handle = vi.fn().mockResolvedValue(new Response('{}'))
    vi.doMock('./local/backend', () => ({ localBackend: () => ({ handle }) }))
    const { apiFetch } = await import('./transport')
    await apiFetch('/api/groups') // warm: backend now resident
    handle.mockClear()
    void apiFetch('/api/pastes/1', { method: 'PUT', body: '{}', keepalive: true })
    expect(handle).toHaveBeenCalledTimes(1) // no await in between
  })
})
