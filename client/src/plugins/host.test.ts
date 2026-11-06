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
import { leaf, leaves } from '../lib/tiling'
import { useGroupStore } from '../store/groupStore'
import { useLayoutStore } from '../store/layoutStore'
import { usePluginStore } from '../store/pluginStore'
import { createContext, editorModeFor, pluginCommands, pluginTileView, startPlugins, urlHandlerFor } from './host'

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
    expect(pluginCommands().filter((c) => c.id.startsWith('plugin.blog-reader.'))).toHaveLength(0)
    expect(matchCommand(key(combo))).toBeNull()
    expect(urlHandlerFor('https://example.com/post')).toBeNull()

    usePluginStore.getState().setEnabled('blog-reader', true)
    expect(matchCommand(key(combo))?.id).toBe('plugin.blog-reader.open')
  })

  it('herdr shortcuts are not shadowed by built-in keys', () => {
    expect(matchCommand(key({ code: 'KeyG', ctrlKey: true, altKey: true }))?.id).toBe('plugin.herdr.share')
    expect(matchCommand(key({ code: 'KeyG', ctrlKey: true, altKey: true, shiftKey: true }))?.id).toBe('plugin.herdr.share-other')
    expect(matchCommand(key({ code: 'KeyA', ctrlKey: true, altKey: true }))?.id).toBe('plugin.herdr.board')
  })

  it('latex shortcuts are not shadowed by built-in keys', () => {
    expect(matchCommand(key({ code: 'KeyX', ctrlKey: true, altKey: true }))?.id).toBe('plugin.latex.preview')
    expect(matchCommand(key({ code: 'KeyX', ctrlKey: true, altKey: true, shiftKey: true }))?.id).toBe('plugin.latex.compile')
  })

  it('tiles.open / toggle / close put a plugin view beside its note, once', () => {
    useLayoutStore.setState({ root: leaf({ kind: 'note', noteId: 5, mode: 'edit' }, 'n'), focusedId: 'n', columns: [], mode: 'dwindle' })
    const ctx = createContext('latex')
    const id = ctx.tiles.open('preview', 5, { focus: false })
    expect(ctx.tiles.isOpen('preview', 5)).toBe(true)
    expect(ctx.tiles.open('preview', 5)).toBe(id)
    expect(leaves(useLayoutStore.getState().root).map((l) => l.content.kind)).toEqual(['note', 'plugin'])
    expect(useLayoutStore.getState().focusedId).toBe(id)

    expect(ctx.tiles.toggle('preview', 5)).toBe(false)
    expect(leaves(useLayoutStore.getState().root).map((l) => l.content.kind)).toEqual(['note'])
    expect(ctx.tiles.toggle('preview', 5)).toBe(true)
    expect(useLayoutStore.getState().focusedId).toBe('n')

    // Another plugin's view of the same note is a different tile.
    expect(createContext('herdr').tiles.isOpen('preview', 5)).toBe(false)
  })

  it('closing a plugin tile that is the only tile shows its note again', () => {
    useLayoutStore.setState({
      root: leaf({ kind: 'plugin', pluginId: 'latex', view: 'preview', noteId: 5 }, 'p'),
      focusedId: 'p',
      columns: [],
      mode: 'dwindle',
    })
    createContext('latex').tiles.close('preview', 5)
    expect(useLayoutStore.getState().root).toMatchObject({ type: 'leaf', content: { kind: 'note', noteId: 5 } })
  })

  it('resolves tile views only for running plugins', () => {
    expect(pluginTileView('latex', 'preview')?.title).toBe('LaTeX Preview')
    expect(pluginTileView('latex', 'nope')).toBeNull()
    usePluginStore.getState().setEnabled('latex', false)
    expect(pluginTileView('latex', 'preview')).toBeNull()
  })

  it('editorModeFor gives LaTeX documents the LaTeX editor mode while the plugin runs', () => {
    const mode = editorModeFor('\\documentclass{article}\n\\begin{document}')
    expect(mode?.key).toBe('plugin:latex')
    expect(editorModeFor('\\documentclass{report}')?.extension).toBe(mode!.extension)
    expect(editorModeFor('# Notes with $x$')).toBeNull()
    usePluginStore.getState().setEnabled('latex', false)
    expect(editorModeFor('\\documentclass{article}')).toBeNull()
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
