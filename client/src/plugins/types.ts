import type { IconName } from '../components/Icon'

export interface PluginManifest {
  id: string
  name: string
  description: string
  icon: IconName
  version: string
  /** Needs the Velocity server (e.g. fetches pages); never activates in the browser-only build. */
  requiresServer?: boolean
}

export type PluginSetting =
  | { key: string; type: 'text'; label: string; hint?: string; default: string; placeholder?: string }
  | { key: string; type: 'toggle'; label: string; hint?: string; default: boolean }
  | {
      key: string
      type: 'choice'
      label: string
      hint?: string
      default: string
      options: { value: string; label: string }[]
    }

export interface PluginCommand {
  id: string
  title: string
  keys?: string[]
  keywords?: string
  run: () => void
  enabled?: () => boolean
}

export interface UrlHandler {
  label: string
  match: (url: URL) => boolean
  open: (url: string, opts: { split: boolean }) => void
}

/** A palette-style single-line text prompt (see CommandPalette "prompt" mode). */
export interface PromptSpec {
  title: string
  icon?: IconName
  placeholder: string
  hint?: string
  initialValue?: string
  /** Return an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null
  onSubmit: (value: string, opts: { split: boolean }) => void
  submitLabel?: string
  splitLabel?: string
}

export interface PluginContext {
  id: string
  setting<T extends string | boolean>(key: string): T
  /** Per-plugin key/value storage in localStorage (`velocity.plugin.<id>.v1`). */
  storage: { get<T>(key: string): T | undefined; set(key: string, value: unknown): void }
  /** Brief status-bar message (not a toast). */
  flash(message: string): void
  /** Longer-lived status-bar activity text; pass null to clear. */
  activity(message: string | null): void
  prompt(spec: PromptSpec): void
  /** GET `/api/plugins/<id>${path}`; unwraps the envelope and throws Error(error). */
  api: { get<T>(path: string): Promise<T> }
  notes: {
    create(input: { title: string; content: string; folder?: string; split?: boolean; mode?: 'read' | 'edit' }): number
    open(id: number, opts?: { split?: boolean; mode?: 'read' | 'edit' }): void
    exists(id: number): boolean
    current(): number | null
  }
  /** Existing (case-insensitive) or newly created folder id. */
  folders: { ensure(name: string): number }
}

export interface PluginInstance {
  commands?: PluginCommand[]
  urlHandler?: UrlHandler
  dispose?: () => void
}

export interface VelocityPlugin {
  manifest: PluginManifest
  settings?: PluginSetting[]
  /** Called once when the plugin is enabled (and at startup if enabled). */
  activate: (ctx: PluginContext) => PluginInstance
}
