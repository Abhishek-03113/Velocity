import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(async () => ({ success: true, data: [] })),
    post: vi.fn(async (_path: string, body: { name: string }) => ({ success: true, data: { id: 7, name: body.name } })),
    put: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({ success: true })),
  },
}))

import { matchCommand } from '../lib/commands'
import { useGroupStore } from '../store/groupStore'
import { usePluginStore } from '../store/pluginStore'
import { createContext, pluginCommands, startPlugins, urlHandlerFor } from './host'

function key(init: KeyboardEventInit & { code: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

let stop: () => void

beforeEach(() => {
  localStorage.clear()
  usePluginStore.setState({ enabled: {}, settings: {} })
  useGroupStore.setState({ groups: [], activeGroupId: null, editingGroupId: null })
  stop = startPlugins()
})

afterEach(() => stop())

describe('plugin host', () => {
  it('namespaces plugin commands under the Plugins section', () => {
    const open = pluginCommands().find((c) => c.id === 'plugin.blog-reader.open')
    expect(open).toBeDefined()
    expect(open!.section).toBe('Plugins')
    expect(open!.title).toBe('Blog Reader: Open Blog Post…')
  })

  it('gates commands, key matching and URL handlers on the enabled flag', () => {
    const combo = { code: 'KeyB', ctrlKey: true, altKey: true }
    expect(matchCommand(key(combo))?.id).toBe('plugin.blog-reader.open')
    expect(urlHandlerFor('https://example.com/post')?.pluginName).toBe('Blog Reader')
    expect(urlHandlerFor('ftp://example.com/post')).toBeNull()

    usePluginStore.getState().setEnabled('blog-reader', false)
    expect(pluginCommands()).toHaveLength(0)
    expect(matchCommand(key(combo))).toBeNull()
    expect(urlHandlerFor('https://example.com/post')).toBeNull()

    usePluginStore.getState().setEnabled('blog-reader', true)
    expect(matchCommand(key(combo))?.id).toBe('plugin.blog-reader.open')
  })

  it('keeps built-in key bindings ahead of plugin keys', () => {
    expect(matchCommand(key({ code: 'KeyN', ctrlKey: true, altKey: true }))?.id).toBe('note.new')
  })

  it('folders.ensure reuses an existing folder case-insensitively', () => {
    useGroupStore.setState({ groups: [{ id: 3, name: 'Blogs' }] })
    const ctx = createContext('blog-reader')
    expect(ctx.folders.ensure('blogs')).toBe(3)
    expect(ctx.folders.ensure('  BLOGS ')).toBe(3)
    expect(useGroupStore.getState().groups).toHaveLength(1)
  })

  it('folders.ensure creates a missing folder once', () => {
    const ctx = createContext('blog-reader')
    const id = ctx.folders.ensure('Reading')
    expect(useGroupStore.getState().groups.find((g) => g.id === id)?.name).toBe('Reading')
    expect(ctx.folders.ensure('reading')).toBe(id)
    expect(useGroupStore.getState().groups).toHaveLength(1)
    // Creating a folder this way must not start inline rename.
    expect(useGroupStore.getState().editingGroupId).toBeNull()
  })

  it('plugin storage is namespaced per plugin', () => {
    const ctx = createContext('blog-reader')
    ctx.storage.set('k', { a: 1 })
    expect(ctx.storage.get('k')).toEqual({ a: 1 })
    expect(localStorage.getItem('velocity.plugin.blog-reader.v1')).toContain('"k"')
  })
})
