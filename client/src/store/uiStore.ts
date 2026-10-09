import { create } from 'zustand'
import {
  DEFAULT_THEME_FAMILY,
  getThemeFamily,
  resolveAppearance,
  sanitizeAppearancePref,
  sanitizeThemeFamily,
  swatchFor,
  type Appearance,
} from '../lib/themes'

export type ThemePref = 'system' | 'light' | 'dark'
/** 'theme' follows the active theme family's natural accent. */
export type Accent = 'theme' | 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'graphite'
export type EditorFont = 'system' | 'serif' | 'mono'
export type Measure = 'narrow' | 'medium' | 'wide' | 'full'
export type SortOrder = 'updated' | 'title'

export const ACCENTS: Accent[] = ['theme', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite']

export interface Preferences {
  themeFamily: string
  theme: ThemePref
  accent: Accent
  editorFont: EditorFont
  editorSize: number
  measure: Measure
  tileGaps: boolean
  sort: SortOrder
  spellcheck: boolean
}

export const DEFAULT_PREFS: Preferences = {
  themeFamily: DEFAULT_THEME_FAMILY,
  theme: 'system',
  accent: 'theme',
  editorFont: 'system',
  editorSize: 16,
  measure: 'medium',
  tileGaps: true,
  sort: 'updated',
  spellcheck: true,
}

const PREFS_KEY = 'velocity.prefs.v1'
const CHROME_KEY = 'velocity.chrome.v1'

export type PaletteMode = 'notes' | 'commands'

export interface AlertSpec {
  title: string
  message?: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

interface UiState {
  prefs: Preferences
  resolvedTheme: Appearance
  sidebarOpen: boolean
  foldersOpen: boolean
  paletteOpen: boolean
  paletteMode: PaletteMode
  settingsOpen: boolean
  shortcutsOpen: boolean
  alert: AlertSpec | null
  /** Brief status message in the status bar ("Saved", "Exported…") — not a toast. */
  flash: string | null

  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void
  /** Switch colour theme family; the accent resets to the theme's own. */
  setThemeFamily: (id: string) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleFolders: () => void
  openPalette: (mode?: PaletteMode) => void
  closePalette: () => void
  setSettingsOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  confirm: (spec: AlertSpec) => void
  dismissAlert: () => void
  showFlash: (message: string) => void
}

function readJson<T>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Partial<T>) : {}
  } catch {
    return {}
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private mode / quota) — preferences stay in memory.
  }
}

export function sanitizePrefs(raw: Partial<Preferences>): Preferences {
  const p = { ...DEFAULT_PREFS }
  p.themeFamily = sanitizeThemeFamily(raw.themeFamily)
  p.theme = sanitizeAppearancePref(raw.theme, DEFAULT_PREFS.theme)
  if (raw.accent && ACCENTS.includes(raw.accent)) p.accent = raw.accent
  if (raw.editorFont === 'system' || raw.editorFont === 'serif' || raw.editorFont === 'mono') {
    p.editorFont = raw.editorFont
  }
  if (typeof raw.editorSize === 'number' && raw.editorSize >= 12 && raw.editorSize <= 24) {
    p.editorSize = Math.round(raw.editorSize)
  }
  if (raw.measure && ['narrow', 'medium', 'wide', 'full'].includes(raw.measure)) p.measure = raw.measure
  if (typeof raw.tileGaps === 'boolean') p.tileGaps = raw.tileGaps
  if (raw.sort === 'updated' || raw.sort === 'title') p.sort = raw.sort
  if (typeof raw.spellcheck === 'boolean') p.spellcheck = raw.spellcheck
  return p
}

const darkQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function resolveTheme(prefs: Pick<Preferences, 'themeFamily' | 'theme'>): Appearance {
  return resolveAppearance(prefs.themeFamily, prefs.theme, !!darkQuery?.matches)
}

const MEASURES: Record<Measure, string> = {
  narrow: '600px',
  medium: '720px',
  wide: '920px',
  full: '100%',
}

const FONTS: Record<EditorFont, string> = {
  system: 'var(--font-system)',
  serif: 'var(--font-serif)',
  mono: 'var(--font-mono)',
}

/** Push preferences onto <html> so CSS tokens (and CodeMirror) pick them up. */
export function applyPreferences(prefs: Preferences, theme: Appearance): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.themeFamily = prefs.themeFamily
  root.dataset.theme = theme
  root.dataset.accent = prefs.accent
  root.style.setProperty('--editor-font', FONTS[prefs.editorFont])
  root.style.setProperty('--editor-size', `${prefs.editorSize}px`)
  root.style.setProperty('--editor-measure', MEASURES[prefs.measure])
  root.style.setProperty('--tile-gap', prefs.tileGaps ? '8px' : '0px')
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', swatchFor(getThemeFamily(prefs.themeFamily), theme).bg)
}

const initialPrefs = sanitizePrefs(readJson<Preferences>(PREFS_KEY))
const initialChrome = readJson<{ sidebarOpen: boolean; foldersOpen: boolean }>(CHROME_KEY)
const narrowViewport = typeof window !== 'undefined' && window.innerWidth < 760

export const useUiStore = create<UiState>((set, get) => ({
  prefs: initialPrefs,
  resolvedTheme: resolveTheme(initialPrefs),
  sidebarOpen: narrowViewport ? false : initialChrome.sidebarOpen ?? true,
  foldersOpen: initialChrome.foldersOpen ?? true,
  paletteOpen: false,
  paletteMode: 'notes',
  settingsOpen: false,
  shortcutsOpen: false,
  alert: null,
  flash: null,

  setPref: (key, value) => {
    const prefs = { ...get().prefs, [key]: value }
    writeJson(PREFS_KEY, prefs)
    set({ prefs, resolvedTheme: resolveTheme(prefs) })
  },
  setThemeFamily: (id) => {
    const prefs = { ...get().prefs, themeFamily: sanitizeThemeFamily(id), accent: 'theme' as Accent }
    writeJson(PREFS_KEY, prefs)
    set({ prefs, resolvedTheme: resolveTheme(prefs) })
  },

  toggleSidebar: () => get().setSidebarOpen(!get().sidebarOpen),
  setSidebarOpen: (open) => {
    set({ sidebarOpen: open })
    if (window.innerWidth >= 760) {
      writeJson(CHROME_KEY, { sidebarOpen: open, foldersOpen: get().foldersOpen })
    }
  },
  toggleFolders: () => {
    const foldersOpen = !get().foldersOpen
    set({ foldersOpen })
    writeJson(CHROME_KEY, { sidebarOpen: get().sidebarOpen, foldersOpen })
  },

  openPalette: (mode = 'notes') => set({ paletteOpen: true, paletteMode: mode }),
  closePalette: () => set({ paletteOpen: false }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  confirm: (spec) => set({ alert: spec }),
  dismissAlert: () => set({ alert: null }),

  showFlash: (message) => {
    set({ flash: message })
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => set({ flash: null }), 2200)
  },
}))

let flashTimer: ReturnType<typeof setTimeout> | null = null

applyPreferences(initialPrefs, resolveTheme(initialPrefs))

useUiStore.subscribe((state, prev) => {
  if (state.prefs !== prev.prefs || state.resolvedTheme !== prev.resolvedTheme) {
    applyPreferences(state.prefs, state.resolvedTheme)
  }
})

darkQuery?.addEventListener('change', () => {
  const { prefs } = useUiStore.getState()
  useUiStore.setState({ resolvedTheme: resolveTheme(prefs) })
})
