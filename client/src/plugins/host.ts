/**
 * Plugin host — builds each plugin's context, activates enabled plugins and exposes their
 * commands / URL handlers to the rest of the app. Deliberately free of lib/commands imports
 * (commands.ts reads from here), so only `import type` crosses that boundary.
 */
import type { Extension } from '@codemirror/state'
import { create } from 'zustand'
import { api } from '../lib/api'
import { getEditor } from '../lib/editorRegistry'
import { displayTitle } from '../lib/noteMeta'
import type { Command } from '../lib/commands'
import { currentNoteId, focusTile, openNote } from '../lib/workspace'
import { leaves, noteLeafFor, pluginLeafFor } from '../lib/tiling'
import { useEditorStore } from '../store/editorStore'
import { useGroupStore } from '../store/groupStore'
import { useLayoutStore } from '../store/layoutStore'
import { usePluginStore } from '../store/pluginStore'
import { useUiStore } from '../store/uiStore'
import { hasBoard, loadScene } from '../store/whiteboardStore'
import { pluginRequest, pluginStream } from './transport'
import { PLUGINS } from './registry'
import type { NoteBadge, PluginContext, PluginInstance, RequestOptions, TileView, VelocityPlugin } from './types'

interface Active {
  plugin: VelocityPlugin
  instance: PluginInstance
}

const active = new Map<string, Active>()
let commandCache: Command[] = []

/** Bumped whenever note badges may have changed; components subscribe to re-render. */
export const useBadgeVersion = create<{ version: number }>(() => ({ version: 0 }))

function bumpBadges() {
  useBadgeVersion.setState((s) => ({ version: s.version + 1 }))
}

/** Bumped whenever the set of running plugins changes (plugin tiles re-resolve their view). */
export const usePluginsVersion = create<{ version: number }>(() => ({ version: 0 }))

function bumpPlugins() {
  usePluginsVersion.setState((s) => ({ version: s.version + 1 }))
}

/** Save a file through a temporary object URL (there is no other way to hand the user a file). */
function downloadFile(filename: string, data: Blob | string, mime = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke later: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function storageKey(id: string) {
  return `velocity.plugin.${id}.v1`
}

function readBag(id: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(storageKey(id))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Show a note's tile in the requested mode (addPaste/setActiveId always open in edit). */
function applyMode(noteId: number, mode: 'read' | 'edit') {
  const layout = useLayoutStore.getState()
  const leaf = noteLeafFor(layout.root, noteId)
  if (!leaf) return
  layout.setMode(leaf.id, mode)
  layout.focus(leaf.id)
  if (mode === 'read') focusTile(leaf.id, { dom: true })
}

/** Put the cursor at the start of `line` (1-based) in the note's editor, opening it in edit mode if needed. */
function goToLine(noteId: number, line: number, attempt = 0) {
  const layout = useLayoutStore.getState()
  const leaf = noteLeafFor(layout.root, noteId)
  if (!leaf) openNote(noteId, { focus: true })
  else if (leaf.content.kind === 'note' && leaf.content.mode !== 'edit') layout.setMode(leaf.id, 'edit')
  const view = getEditor(noteId)
  if (!view) {
    // The editor mounts on the next frame after the tile appears.
    if (attempt < 10) requestAnimationFrame(() => goToLine(noteId, line, attempt + 1))
    return
  }
  const target = view.state.doc.line(Math.min(Math.max(1, Math.floor(line)), view.state.doc.lines))
  view.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true })
  const tile = noteLeafFor(useLayoutStore.getState().root, noteId)
  if (tile) focusTile(tile.id, { dom: true })
  view.focus()
}

/** Render a note's whiteboard to a PNG data URL with Excalidraw (loaded on demand). */
async function exportBoardPng(noteId: number): Promise<string | null> {
  try {
    const scene = await loadScene(noteId)
    const elements = (scene?.elements ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted)
    if (!elements.length) return null
    const { exportToBlob } = await import('@excalidraw/excalidraw')
    const blob = await exportToBlob({
      elements: elements as never,
      appState: { ...(scene?.appState ?? {}), exportBackground: true, viewBackgroundColor: '#ffffff' } as never,
      files: (scene?.files ?? {}) as never,
      mimeType: 'image/png',
    })
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch (err) {
    console.error('[plugins] whiteboard export failed:', err)
    return null
  }
}

function tilesFor(id: string): PluginContext['tiles'] {
  const isOpen = (view: string, noteId: number) => pluginLeafFor(useLayoutStore.getState().root, id, view, noteId) != null
  const open = (view: string, noteId: number, opts: { focus?: boolean } = {}) => {
    const layout = useLayoutStore.getState()
    const focus = opts.focus ?? true
    const existing = pluginLeafFor(layout.root, id, view, noteId)
    if (existing) {
      if (focus) focusTile(existing.id)
      return existing.id
    }
    const noteLeaf = noteLeafFor(layout.root, noteId)
    return layout.split('row', { kind: 'plugin', pluginId: id, view, noteId }, { targetId: noteLeaf?.id, focus })
  }
  const close = (view: string, noteId: number) => {
    const layout = useLayoutStore.getState()
    const existing = pluginLeafFor(layout.root, id, view, noteId)
    if (!existing) return
    // The only tile: show the note again rather than an empty workspace.
    if (leaves(layout.root).length === 1) layout.setContent(existing.id, { kind: 'note', noteId, mode: 'edit' })
    else layout.close(existing.id)
  }
  const toggle = (view: string, noteId: number) => {
    if (isOpen(view, noteId)) {
      close(view, noteId)
      return false
    }
    open(view, noteId, { focus: false })
    return true
  }
  return { open, close, toggle, isOpen }
}

export function createContext(id: string): PluginContext {
  const folders = { ensure: (name: string) => useGroupStore.getState().ensureGroup(name) }
  const tiles = tilesFor(id)
  return {
    id,
    setting: <T extends string | boolean>(key: string) => usePluginStore.getState().getSetting<T>(id, key),
    storage: {
      get: <T>(key: string) => readBag(id)[key] as T | undefined,
      set: (key, value) => {
        try {
          localStorage.setItem(storageKey(id), JSON.stringify({ ...readBag(id), [key]: value }))
        } catch {
          // Storage unavailable — plugin state is best-effort.
        }
      },
    },
    flash: (message) => useUiStore.getState().showFlash(message),
    activity: (message) => useUiStore.getState().setActivity(message),
    prompt: (spec) => useUiStore.getState().openPrompt(spec),
    api: {
      get: async <T>(path: string, opts?: RequestOptions) => {
        if (opts?.headers) return pluginRequest<T>(id, path, { method: 'GET' }, opts)
        const res = await api.get<T>(`/api/plugins/${id}${path}`)
        if (res.success === false) throw new Error(res.error ?? 'Request failed')
        return res.data as T
      },
      post: <T>(path: string, body?: unknown, opts?: RequestOptions) => pluginRequest<T>(id, path, { method: 'POST', body: body ?? {} }, opts),
      stream: (path, handlers, opts) => pluginStream(id, path, handlers, opts),
    },
    pick: (spec) => useUiStore.getState().openPick(spec),
    panel: {
      open: (spec) => useUiStore.getState().openPluginPanel({ pluginId: id, ...spec }),
      close: () => {
        if (useUiStore.getState().pluginPanel?.pluginId === id) useUiStore.getState().closePluginPanel()
      },
      isOpen: () => useUiStore.getState().pluginPanel?.pluginId === id,
    },
    notes: {
      create: ({ title, content, folder, split = false, mode = 'edit' }) => {
        const groupId = folder?.trim() ? folders.ensure(folder) : null
        const store = useEditorStore.getState()
        const noteId = store.addPaste(groupId, { split: split ? 'auto' : false, focus: mode === 'edit' })
        store.setTitle(noteId, title)
        store.setContent(content, noteId)
        applyMode(noteId, mode)
        return noteId
      },
      open: (noteId, opts = {}) => {
        const mode = opts.mode ?? 'edit'
        openNote(noteId, { split: opts.split ? 'auto' : false, focus: mode === 'edit' })
        applyMode(noteId, mode)
      },
      exists: (noteId) => useEditorStore.getState().pastes.some((p) => p.id === noteId),
      current: () => currentNoteId(),
      title: (noteId) => {
        const p = useEditorStore.getState().pastes.find((x) => x.id === noteId)
        return p ? displayTitle(p) : ''
      },
      content: async (noteId) => {
        await useEditorStore.getState().ensureContent(noteId)
        return useEditorStore.getState().pastes.find((x) => x.id === noteId)?.content ?? ''
      },
      append: async (noteId, markdown) => {
        await useEditorStore.getState().ensureContent(noteId)
        const current = useEditorStore.getState().pastes.find((x) => x.id === noteId)?.content ?? ''
        const sep = current === '' ? '' : current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'
        useEditorStore.getState().setContent(current + sep + markdown, noteId)
      },
      selection: (noteId) => {
        const view = getEditor(noteId)
        if (!view) return ''
        const { from, to } = view.state.selection.main
        return from === to ? '' : view.state.sliceDoc(from, to)
      },
      // A hook: only call it from a plugin component's render.
      useContent: (noteId) => useEditorStore((s) => s.pastes.find((p) => p.id === noteId)?.content),
      goToLine: (noteId, line) => goToLine(noteId, line),
    },
    boards: {
      has: (noteId) => hasBoard(noteId),
      exportPng: (noteId) => exportBoardPng(noteId),
    },
    tiles,
    folders,
    files: { download: downloadFile },
    refreshBadges: bumpBadges,
  }
}

function rebuildCommands() {
  commandCache = [...active.values()].flatMap(({ plugin, instance }) =>
    (instance.commands ?? []).map(
      (c): Command => ({
        id: `plugin.${plugin.manifest.id}.${c.id}`,
        title: `${plugin.manifest.name}: ${c.title}`,
        section: 'Plugins',
        keys: c.keys,
        keywords: c.keywords,
        run: c.run,
        enabled: c.enabled,
      }),
    ),
  )
}

/** Activate / dispose plugins so the running set matches the enabled flags. */
export function syncPlugins(): void {
  const store = usePluginStore.getState()
  let changed = false
  for (const plugin of PLUGINS) {
    const id = plugin.manifest.id
    const on = store.isEnabled(id)
    const running = active.get(id)
    if (on && !running) {
      try {
        active.set(id, { plugin, instance: plugin.activate(createContext(id)) })
        changed = true
      } catch (err) {
        console.error(`[plugins] ${id} failed to activate:`, err)
      }
    } else if (!on && running) {
      try {
        running.instance.dispose?.()
      } catch (err) {
        console.error(`[plugins] ${id} failed to dispose:`, err)
      }
      // A switched-off plugin's panel would only have dead buttons.
      if (useUiStore.getState().pluginPanel?.pluginId === id) useUiStore.getState().closePluginPanel()
      active.delete(id)
      modeExtensions.delete(id)
      changed = true
    }
  }
  if (changed) {
    rebuildCommands()
    bumpBadges()
    bumpPlugins()
  }
}

/** Activate enabled plugins and follow later toggles. Returns a stop function. */
export function startPlugins(): () => void {
  syncPlugins()
  const unsubscribe = usePluginStore.subscribe((state, prev) => {
    if (state.enabled !== prev.enabled) syncPlugins()
    else if (state.settings !== prev.settings) bumpBadges()
  })
  return () => {
    unsubscribe()
    for (const [id, { instance }] of active) {
      try {
        instance.dispose?.()
      } catch (err) {
        console.error(`[plugins] ${id} failed to dispose:`, err)
      }
    }
    active.clear()
    rebuildCommands()
    bumpBadges()
    bumpPlugins()
  }
}

/** A running plugin's tile view, or null when the plugin is off or has no such view. */
export function pluginTileView(pluginId: string, view: string): (TileView & { pluginName: string }) | null {
  const running = active.get(pluginId)
  const spec = running?.instance.tiles?.[view]
  return spec ? { ...spec, pluginName: running.plugin.manifest.name } : null
}

const modeExtensions = new Map<string, Extension>()

/** The editor mode of the first running plugin whose matcher accepts this content, or null for Markdown. */
export function editorModeFor(content: string): { key: string; extension: Extension } | null {
  for (const [id, { instance }] of active) {
    const mode = instance.editorMode
    if (!mode) continue
    try {
      if (!mode.matches(content)) continue
      let extension = modeExtensions.get(id)
      if (!extension) {
        extension = mode.extensions()
        modeExtensions.set(id, extension)
      }
      return { key: `plugin:${id}`, extension }
    } catch (err) {
      console.error(`[plugins] ${id} editorMode failed:`, err)
    }
  }
  return null
}

/** A registered plugin's display name (also for plugins that are switched off). */
export function pluginName(pluginId: string): string {
  return PLUGINS.find((p) => p.manifest.id === pluginId)?.manifest.name ?? pluginId
}

/** The first enabled plugin's badge for a note, or null. */
export function noteBadgeFor(noteId: number): NoteBadge | null {
  for (const [id, { instance }] of active) {
    if (!instance.noteBadge) continue
    try {
      const badge = instance.noteBadge(noteId)
      if (badge) return badge
    } catch (err) {
      console.error(`[plugins] ${id} noteBadge failed:`, err)
    }
  }
  return null
}

/** Commands of enabled plugins. The array identity changes only when the set changes. */
export function pluginCommands(): Command[] {
  return commandCache
}

export function urlHandlerFor(url: string): { pluginName: string; pluginIcon: VelocityPlugin['manifest']['icon']; label: string; open: (opts: { split: boolean }) => void } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  for (const { plugin, instance } of active.values()) {
    const handler = instance.urlHandler
    if (handler?.match(parsed)) {
      return {
        pluginName: plugin.manifest.name,
        pluginIcon: plugin.manifest.icon,
        label: handler.label,
        open: (opts) => handler.open(url, opts),
      }
    }
  }
  return null
}
