/**
 * Plugin host — builds each plugin's context, activates enabled plugins and exposes their
 * commands / URL handlers to the rest of the app. Deliberately free of lib/commands imports
 * (commands.ts reads from here), so only `import type` crosses that boundary.
 */
import { create } from 'zustand'
import { api } from '../lib/api'
import type { Command } from '../lib/commands'
import { currentNoteId, focusTile, openNote } from '../lib/workspace'
import { noteLeafFor } from '../lib/tiling'
import { useEditorStore } from '../store/editorStore'
import { useGroupStore } from '../store/groupStore'
import { useLayoutStore } from '../store/layoutStore'
import { usePluginStore } from '../store/pluginStore'
import { useUiStore } from '../store/uiStore'
import { PLUGINS } from './registry'
import type { NoteBadge, PluginContext, PluginInstance, VelocityPlugin } from './types'

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

export function createContext(id: string): PluginContext {
  const folders = { ensure: (name: string) => useGroupStore.getState().ensureGroup(name) }
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
      get: async <T>(path: string) => {
        const res = await api.get<T>(`/api/plugins/${id}${path}`)
        if (res.success === false) throw new Error(res.error ?? 'Request failed')
        return res.data as T
      },
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
    },
    folders,
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
      active.delete(id)
      changed = true
    }
  }
  if (changed) {
    rebuildCommands()
    bumpBadges()
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
  }
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
