/**
 * Theme registry. Each family has a CSS file in `styles/themes/` that overrides
 * the semantic tokens under `:root[data-theme-family='<id>'][data-theme='light|dark']`.
 * Adding a theme = add that CSS file (imported from `styles/themes/index.css`)
 * and one entry in THEME_FAMILIES below.
 */

export type Appearance = 'light' | 'dark'
export type AppearancePref = 'system' | Appearance

/** Colours used to draw the mini window preview in the Settings picker. */
export interface ThemeSwatch {
  bg: string
  sidebar: string
  accent: string
  text: string
}

export interface ThemeFamily {
  id: string
  name: string
  /** Appearances the family ships. Order matters: the first is the fallback. */
  appearances: readonly Appearance[]
  /** Preview swatches per shipped appearance; `accent` is the family's natural accent. */
  swatches: Partial<Record<Appearance, ThemeSwatch>>
  /** Name of the natural accent, shown as a hint in Settings. */
  accentName: string
}

export const DEFAULT_THEME_FAMILY = 'apple'

export const THEME_FAMILIES: readonly ThemeFamily[] = [
  {
    id: 'apple',
    name: 'Apple',
    appearances: ['light', 'dark'],
    accentName: 'Blue',
    swatches: {
      light: { bg: '#ffffff', sidebar: '#f0f0f4', accent: '#007aff', text: '#1d1d1f' },
      dark: { bg: '#1e1e1e', sidebar: '#28282a', accent: '#0a84ff', text: '#f2f2f7' },
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    appearances: ['light', 'dark'],
    accentName: 'Mauve',
    swatches: {
      light: { bg: '#eff1f5', sidebar: '#e6e9ef', accent: '#8839ef', text: '#4c4f69' },
      dark: { bg: '#1e1e2e', sidebar: '#181825', accent: '#cba6f7', text: '#cdd6f4' },
    },
  },
  {
    id: 'catppuccin-macchiato',
    name: 'Macchiato',
    appearances: ['light', 'dark'],
    accentName: 'Lavender',
    swatches: {
      light: { bg: '#eff1f5', sidebar: '#e6e9ef', accent: '#7287fd', text: '#4c4f69' },
      dark: { bg: '#24273a', sidebar: '#1e2030', accent: '#b7bdf8', text: '#cad3f5' },
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    appearances: ['light', 'dark'],
    accentName: 'Orange',
    swatches: {
      light: { bg: '#fbf1c7', sidebar: '#ebdbb2', accent: '#af3a03', text: '#3c3836' },
      dark: { bg: '#282828', sidebar: '#1d2021', accent: '#fe8019', text: '#ebdbb2' },
    },
  },
  {
    id: 'everforest',
    name: 'Everforest',
    appearances: ['light', 'dark'],
    accentName: 'Green',
    swatches: {
      light: { bg: '#fdf6e3', sidebar: '#f4f0d9', accent: '#6f8a00', text: '#5c6a72' },
      dark: { bg: '#2d353b', sidebar: '#232a2e', accent: '#a7c080', text: '#d3c6aa' },
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    appearances: ['dark'],
    accentName: 'Frost blue',
    swatches: {
      dark: { bg: '#2e3440', sidebar: '#272c36', accent: '#88c0d0', text: '#e5e9f0' },
    },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    appearances: ['light', 'dark'],
    accentName: 'Blue',
    swatches: {
      light: { bg: '#fdf6e3', sidebar: '#eee8d5', accent: '#268bd2', text: '#586e75' },
      dark: { bg: '#002b36', sidebar: '#073642', accent: '#268bd2', text: '#93a1a1' },
    },
  },
]

export function getThemeFamily(id: string): ThemeFamily {
  return THEME_FAMILIES.find((f) => f.id === id) ?? THEME_FAMILIES[0]!
}

/** Unknown / corrupt values (e.g. from localStorage) fall back to the default family. */
export function sanitizeThemeFamily(value: unknown): string {
  return typeof value === 'string' && THEME_FAMILIES.some((f) => f.id === value) ? value : DEFAULT_THEME_FAMILY
}

export function sanitizeAppearancePref(value: unknown, fallback: AppearancePref = 'system'): AppearancePref {
  return value === 'system' || value === 'light' || value === 'dark' ? value : fallback
}

/**
 * Resolve the appearance to render: the preference (or the OS setting for
 * 'system'), falling back to what the family actually ships.
 */
export function resolveAppearance(familyId: string, pref: AppearancePref, systemDark: boolean): Appearance {
  const family = getThemeFamily(familyId)
  const wanted: Appearance = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
  return family.appearances.includes(wanted) ? wanted : family.appearances[0]!
}

/** Swatch to preview for a family, preferring the given appearance. */
export function swatchFor(family: ThemeFamily, appearance: Appearance): ThemeSwatch {
  return (family.swatches[appearance] ?? family.swatches[family.appearances[0]!])!
}

/** localStorage key holding `{ [familyId]: appearances[] }` so index.html can resolve fallbacks pre-paint. */
export const THEME_INDEX_KEY = 'velocity.themes.v1'

export function themeIndex(): Record<string, readonly Appearance[]> {
  return Object.fromEntries(THEME_FAMILIES.map((f) => [f.id, f.appearances]))
}
