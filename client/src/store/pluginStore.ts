import { create } from 'zustand'
import { BROWSER_ONLY } from '../lib/runtime'
import { PLUGINS } from '../plugins/registry'

const KEY = 'velocity.plugins.v1'

type SettingValue = string | boolean

interface PluginState {
  /** Missing = enabled (every registered plugin is on by default). */
  enabled: Record<string, boolean>
  settings: Record<string, Record<string, SettingValue>>

  isEnabled: (id: string) => boolean
  setEnabled: (id: string, on: boolean) => void
  setSetting: (id: string, key: string, value: SettingValue) => void
  /** Stored value, falling back to the manifest default. */
  getSetting: <T extends SettingValue>(id: string, key: string) => T
}

function read(): Pick<PluginState, 'enabled' | 'settings'> {
  const empty = { enabled: {}, settings: {} }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<Pick<PluginState, 'enabled' | 'settings'>>
    const enabled: Record<string, boolean> = {}
    for (const [id, v] of Object.entries(parsed.enabled ?? {})) if (typeof v === 'boolean') enabled[id] = v
    const settings: Record<string, Record<string, SettingValue>> = {}
    for (const [id, bag] of Object.entries(parsed.settings ?? {})) {
      if (!bag || typeof bag !== 'object') continue
      settings[id] = {}
      for (const [k, v] of Object.entries(bag)) {
        if (typeof v === 'string' || typeof v === 'boolean') settings[id]![k] = v
      }
    }
    return { enabled, settings }
  } catch {
    return empty
  }
}

function write(state: Pick<PluginState, 'enabled' | 'settings'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled: state.enabled, settings: state.settings }))
  } catch {
    // Storage unavailable — stays in memory for this session.
  }
}

/** False for server-backed plugins in the browser-only build (they can never run there). */
export function pluginUnavailable(id: string): boolean {
  return BROWSER_ONLY && PLUGINS.find((p) => p.manifest.id === id)?.manifest.requiresServer === true
}

export function settingDefault(id: string, key: string): SettingValue | undefined {
  return PLUGINS.find((p) => p.manifest.id === id)?.settings?.find((s) => s.key === key)?.default
}

export const usePluginStore = create<PluginState>((set, get) => ({
  ...read(),

  isEnabled: (id) => !pluginUnavailable(id) && get().enabled[id] !== false,
  setEnabled: (id, on) => {
    const enabled = { ...get().enabled, [id]: on }
    write({ enabled, settings: get().settings })
    set({ enabled })
  },
  setSetting: (id, key, value) => {
    const settings = { ...get().settings, [id]: { ...get().settings[id], [key]: value } }
    write({ enabled: get().enabled, settings })
    set({ settings })
  },
  getSetting: <T extends SettingValue>(id: string, key: string): T => {
    const stored = get().settings[id]?.[key]
    const fallback = settingDefault(id, key)
    // Reject a stored value of the wrong type (hand-edited storage).
    if (stored !== undefined && (fallback === undefined || typeof stored === typeof fallback)) return stored as T
    return fallback as T
  },
}))
