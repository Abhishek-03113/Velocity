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
import { useUiStore } from '../store/uiStore'
import { createContext, editorModeFor, pluginCommands, pluginTileView, startPlugins, urlHandlerFor, usePluginsVersion } from './host'
import { PLUGINS } from './registry'

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

  describe.each(PLUGINS.map((p) => p.manifest.id))('switching %s off and on', (id) => {
    const commandsOf = () => pluginCommands().filter((c) => c.id.startsWith(`plugin.${id}.`))
    const keysOf = () => commandsOf().flatMap((c) => c.keys ?? [])

    it('removes everything it added, then brings it all back', () => {
      const commands = commandsOf().map((c) => c.id)
      expect(commands.length).toBeGreaterThan(0)
      const firstKey = keysOf()[0]
      const tileViews = id === 'latex' ? ['preview'] : []
      const version = usePluginsVersion.getState().version
      usePluginStore.getState().setEnabled(id, false)
      expect(usePluginStore.getState().isEnabled(id)).toBe(false)
      expect(commandsOf()).toHaveLength(0)
      expect(usePluginsVersion.getState().version).toBeGreaterThan(version)
      for (const view of tileViews) expect(pluginTileView(id, view)).toBeNull()
      if (firstKey) {
        const [code, ...mods] = firstKey.split('+').reverse()
        const init = { code: code!, ctrlKey: mods.includes('Ctrl'), altKey: mods.includes('Alt'), shiftKey: mods.includes('Shift') }
        expect(matchCommand(key(init))?.id ?? '').not.toMatch(new RegExp(`^plugin\\.${id}\\.`))
      }
      if (id === 'latex') expect(editorModeFor('\\documentclass{article}')).toBeNull()
      // Stored per browser, so the choice survives a reload.
      expect(JSON.parse(localStorage.getItem('velocity.plugins.v1')!).enabled[id]).toBe(false)

      usePluginStore.getState().setEnabled(id, true)
      expect(commandsOf().map((c) => c.id)).toEqual(commands)
      for (const view of tileViews) expect(pluginTileView(id, view)).not.toBeNull()
      if (id === 'latex') expect(editorModeFor('\\documentclass{article}')).not.toBeNull()
    })

    it('closes its panel when switched off', () => {
      createContext(id).panel.open({ title: 'Panel', render: () => null })
      expect(useUiStore.getState().pluginPanel?.pluginId).toBe(id)
      usePluginStore.getState().setEnabled(id, false)
      expect(useUiStore.getState().pluginPanel).toBeNull()
    })
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
