import type { ReactNode } from 'react'
import type { IconName } from '../components/Icon'

export interface PluginManifest {
  id: string
  name: string
  description: string
  icon: IconName
  version: string
}

export type PluginSetting =
  | { key: string; type: 'text'; label: string; hint?: string; default: string; placeholder?: string; secret?: boolean }
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

/** System colour a badge is tinted with (`--system-<tone>`), so it follows the theme. */
export type BadgeTone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' | 'gray'

/** A coloured marker a plugin puts on one of its notes in the sidebar list. */
export interface NoteBadge {
  label: string
  tone: BadgeTone
  /** Tooltip / accessible name of the badge button. */
  title?: string
  /** Makes the badge a button (e.g. to toggle a state). */
  onClick?: () => void
}

/** One row of a palette pick list. */
export interface PickItem {
  id: string
  title: string
  detail?: string
  icon?: IconName
  section?: string
  badge?: { label: string; tone: BadgeTone }
  /** Shown but not choosable; `hint` says why. */
  disabled?: boolean
  hint?: string
}

/** A palette-style list the user filters and picks one item from. */
export interface PickSpec {
  title: string
  placeholder: string
  icon?: IconName
  items: PickItem[]
  /** Shown when there are no items at all (e.g. "herdr isn't running"). */
  emptyText?: string
  footerHint?: string
  onPick: (id: string) => void
}

/** A large plugin-rendered panel over the workspace (e.g. a board). */
export interface PanelSpec {
  title: string
  render: () => ReactNode
  onClose?: () => void
}

export interface RequestOptions {
  headers?: Record<string, string>
}

export interface StreamHandlers {
  onEvent: (event: string, data: string) => void
  onOpen?: () => void
  onError?: (error: Error) => void
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
  /** `/api/plugins/<id>${path}`; unwraps the envelope and throws Error(error) (with `.status`). */
  api: {
    get<T>(path: string, opts?: RequestOptions): Promise<T>
    post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>
    /** Server-sent events read over fetch (so headers can carry a token). Reconnects with back-off; returns a stop function. */
    stream(path: string, handlers: StreamHandlers, opts?: RequestOptions): () => void
  }
  /** Palette list mode: filter and pick one item. */
  pick(spec: PickSpec): void
  /** A large panel over the workspace; one at a time. */
  panel: { open(spec: PanelSpec): void; close(): void; isOpen(): boolean }
  notes: {
    create(input: { title: string; content: string; folder?: string; split?: boolean; mode?: 'read' | 'edit' }): number
    open(id: number, opts?: { split?: boolean; mode?: 'read' | 'edit' }): void
    exists(id: number): boolean
    current(): number | null
    title(id: number): string
    /** The note's Markdown, loading it first if needed. */
    content(id: number): Promise<string>
    /** Append Markdown at the end of the note (saved through the normal sync engine). */
    append(id: number, markdown: string): Promise<void>
    /** The current editor selection in that note, or ''. */
    selection(id: number): string
  }
  /** The note's whiteboard, if it has one. */
  boards: {
    has(id: number): boolean
    /** Render the whiteboard to a PNG data URL (null when empty or unavailable). */
    exportPng(id: number): Promise<string | null>
  }
  /** Existing (case-insensitive) or newly created folder id. */
  folders: { ensure(name: string): number }
  /** Ask the UI to re-read this plugin's note badges (call after their state changes). */
  refreshBadges(): void
}

export interface PluginInstance {
  commands?: PluginCommand[]
  urlHandler?: UrlHandler
  /** Badge for a note in the sidebar, or null for notes this plugin doesn't decorate. Keep it cheap. */
  noteBadge?: (noteId: number) => NoteBadge | null
  dispose?: () => void
}

export interface VelocityPlugin {
  manifest: PluginManifest
  settings?: PluginSetting[]
  /** Called once when the plugin is enabled (and at startup if enabled). */
  activate: (ctx: PluginContext) => PluginInstance
}
