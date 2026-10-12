import { beforeEach, describe, expect, it } from 'vitest'
import { usePluginStore } from './pluginStore'

beforeEach(() => {
  localStorage.clear()
  usePluginStore.setState({ enabled: {}, settings: {} })
})

describe('pluginStore', () => {
  it('enables every plugin by default', () => {
    expect(usePluginStore.getState().isEnabled('blog-reader')).toBe(true)
    expect(usePluginStore.getState().isEnabled('anything-else')).toBe(true)
  })

  it('persists the enabled flag', () => {
    usePluginStore.getState().setEnabled('blog-reader', false)
    expect(usePluginStore.getState().isEnabled('blog-reader')).toBe(false)
    expect(JSON.parse(localStorage.getItem('velocity.plugins.v1')!).enabled).toEqual({ 'blog-reader': false })
  })

  it('falls back to the manifest default for settings', () => {
    const { getSetting, setSetting } = usePluginStore.getState()
    expect(getSetting<string>('blog-reader', 'folder')).toBe('Blogs')
    expect(getSetting<boolean>('blog-reader', 'readMode')).toBe(true)
    setSetting('blog-reader', 'folder', 'Reading')
    expect(usePluginStore.getState().getSetting<string>('blog-reader', 'folder')).toBe('Reading')
    expect(JSON.parse(localStorage.getItem('velocity.plugins.v1')!).settings['blog-reader'].folder).toBe('Reading')
  })

  it('ignores a stored value of the wrong type', () => {
    usePluginStore.getState().setSetting('blog-reader', 'readMode', 'yes')
    expect(usePluginStore.getState().getSetting<boolean>('blog-reader', 'readMode')).toBe(true)
  })
})
