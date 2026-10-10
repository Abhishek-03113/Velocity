/**
 * Theme registry. Each family has a CSS file in `styles/themes/` that overrides
 * the semantic tokens (see `styles/tokens.css`).
 *
 * Selector convention (also documented in `styles/themes/index.css`):
 *
 *   plain family (no variants for that appearance):
 *     :root[data-theme-family='<family>'][data-theme='<light|dark>']
 *   family with variants (flavours, contrast levels, ...):
 *     :root[data-theme-family='<family>'][data-theme='<light|dark>'][data-theme-variant='<variant>']
 *
 * `<html data-theme-variant>` is only present when the family declares variants
 * for the resolved appearance; otherwise the attribute is removed.
 *
 * Adding a family:
 *   1. Create `styles/themes/<id>.css` and `@import` it in `styles/themes/index.css`.
 *   2. Add an entry to THEME_FAMILIES below (swatches are required per appearance).
 *   3. Optional variants: add `variants: { light: [...], dark: [...] }` (each variant
 *      has an id, a display name and a preview swatch) and `defaultVariants` for the
 *      default id per appearance (the first listed variant is used when omitted).
 *      Write the CSS under the variant selector above, one block per appearance + variant.
 *      Settings, the palette commands ("Theme: <Family> <Variant>") and prefs sanitizing
 *      are all generated from the registry.
 *   4. Run `npx vitest run`: `themes.test.ts` fails until the pre-paint map in
 *      `client/index.html` (`var THEMES = ...`, regenerated from `themeIndex()`) is updated.
 *   5. Renaming/merging a family: add a LEGACY_THEME_FAMILIES entry so stored prefs migrate.
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

/** One selectable variant of a family within an appearance (e.g. Catppuccin "Mocha"). */
export interface ThemeVariant {
  id: string
  name: string
  /** Preview colours for this variant (used by Settings chips and the picker card). */
  swatch: ThemeSwatch
}

export type ThemeVariants = Partial<Record<Appearance, readonly ThemeVariant[]>>

/** Per-family variant choices as stored in preferences: familyId -> appearance -> variant id. */
export type ThemeVariantPrefs = Record<string, Partial<Record<Appearance, string>>>

export interface ThemeFamily {
  id: string
  name: string
  /** Appearances the family ships. Order matters: the first is the fallback. */
  appearances: readonly Appearance[]
  /** Preview swatches per shipped appearance; `accent` is the family's natural accent. */
  swatches: Partial<Record<Appearance, ThemeSwatch>>
  /** Name of the natural accent, shown as a hint in Settings. */
  accentName: string
  /** Optional variants per appearance. Emitted as `data-theme-variant` on <html>. */
  variants?: ThemeVariants
  /** Default variant id per appearance; falls back to the first listed variant. */
  defaultVariants?: Partial<Record<Appearance, string>>
  /** Noun for the variant control in Settings ("Flavour", "Contrast"…). Default "Variant". */
  variantLabel?: string
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
    variantLabel: 'Flavour',
    defaultVariants: { light: 'latte', dark: 'mocha' },
    variants: {
      light: [{ id: 'latte', name: 'Latte', swatch: { bg: '#eff1f5', sidebar: '#e6e9ef', accent: '#8839ef', text: '#4c4f69' } }],
      dark: [
        { id: 'frappe', name: 'Frappé', swatch: { bg: '#303446', sidebar: '#292c3c', accent: '#ca9ee6', text: '#c6d0f5' } },
        { id: 'macchiato', name: 'Macchiato', swatch: { bg: '#24273a', sidebar: '#1e2030', accent: '#c6a0f6', text: '#cad3f5' } },
        { id: 'mocha', name: 'Mocha', swatch: { bg: '#1e1e2e', sidebar: '#181825', accent: '#cba6f7', text: '#cdd6f4' } },
      ],
    },
    swatches: {
      light: { bg: '#eff1f5', sidebar: '#e6e9ef', accent: '#8839ef', text: '#4c4f69' },
      dark: { bg: '#1e1e2e', sidebar: '#181825', accent: '#cba6f7', text: '#cdd6f4' },
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
    variantLabel: 'Contrast',
    defaultVariants: { light: 'medium', dark: 'medium' },
    variants: {
      light: [
        { id: 'hard', name: 'Hard', swatch: { bg: '#fffbef', sidebar: '#f8f5e4', accent: '#7c8e29', text: '#5c6a72' } },
        { id: 'medium', name: 'Medium', swatch: { bg: '#fdf6e3', sidebar: '#f4f0d9', accent: '#7c8e29', text: '#5c6a72' } },
        { id: 'soft', name: 'Soft', swatch: { bg: '#f3ead3', sidebar: '#eae4ca', accent: '#7c8e29', text: '#5c6a72' } },
      ],
      dark: [
        { id: 'hard', name: 'Hard', swatch: { bg: '#272e33', sidebar: '#1e2326', accent: '#a7c080', text: '#d3c6aa' } },
        { id: 'medium', name: 'Medium', swatch: { bg: '#2d353b', sidebar: '#232a2e', accent: '#a7c080', text: '#d3c6aa' } },
        { id: 'soft', name: 'Soft', swatch: { bg: '#333c43', sidebar: '#293136', accent: '#a7c080', text: '#d3c6aa' } },
      ],
    },
    swatches: {
      light: { bg: '#fdf6e3', sidebar: '#f4f0d9', accent: '#7c8e29', text: '#5c6a72' },
      dark: { bg: '#2d353b', sidebar: '#232a2e', accent: '#a7c080', text: '#d3c6aa' },
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    appearances: ['light', 'dark'],
    accentName: 'Frost blue',
    swatches: {
      light: { bg: '#eceff4', sidebar: '#e5e9f0', accent: '#5e81ac', text: '#2e3440' },
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
  return resolveFamilyAppearance(getThemeFamily(familyId), pref, systemDark)
}

export function resolveFamilyAppearance(
  family: Pick<ThemeFamily, 'appearances'>,
  pref: AppearancePref,
  systemDark: boolean,
): Appearance {
  const wanted: Appearance = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
  return family.appearances.includes(wanted) ? wanted : family.appearances[0]!
}

/** Old family ids kept working after a merge: stored prefs migrate to `family` (+ variant choices). */
export const LEGACY_THEME_FAMILIES: Readonly<
  Record<string, { family: string; variants?: Partial<Record<Appearance, string>> }>
> = {
  'catppuccin-macchiato': { family: 'catppuccin', variants: { dark: 'macchiato' } },
}

/** Variants a family offers for an appearance (empty when it has none). */
export function variantsFor(family: ThemeFamily, appearance: Appearance): readonly ThemeVariant[] {
  return family.variants?.[appearance] ?? []
}

/** Default variant id for an appearance, or undefined when the family has no variants there. */
export function defaultVariantId(family: ThemeFamily, appearance: Appearance): string | undefined {
  const list = variantsFor(family, appearance)
  if (list.length === 0) return undefined
  const wanted = family.defaultVariants?.[appearance]
  return list.some((v) => v.id === wanted) ? wanted : list[0]!.id
}

/** Variant id to render: the stored choice if it still exists, else the default. */
export function resolveVariant(
  family: ThemeFamily,
  appearance: Appearance,
  prefs: ThemeVariantPrefs | undefined,
): string | undefined {
  const stored = prefs?.[family.id]?.[appearance]
  return variantsFor(family, appearance).some((v) => v.id === stored) ? stored : defaultVariantId(family, appearance)
}

/** Drops unknown families / variants / appearances from untrusted (localStorage) input. */
export function sanitizeThemeVariants(value: unknown): ThemeVariantPrefs {
  const out: ThemeVariantPrefs = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const family of THEME_FAMILIES) {
    if (!family.variants) continue
    const raw = (value as Record<string, unknown>)[family.id]
    if (!raw || typeof raw !== 'object') continue
    for (const appearance of ['light', 'dark'] as const) {
      const id = (raw as Record<string, unknown>)[appearance]
      if (typeof id === 'string' && variantsFor(family, appearance).some((v) => v.id === id)) {
        out[family.id] = { ...out[family.id], [appearance]: id }
      }
    }
  }
  return out
}

/** Swatch to preview for a family, preferring the given appearance (and variant, if any). */
export function swatchFor(family: ThemeFamily, appearance: Appearance, variantId?: string): ThemeSwatch {
  const variant = variantId ? variantsFor(family, appearance).find((v) => v.id === variantId) : undefined
  return variant?.swatch ?? (family.swatches[appearance] ?? family.swatches[family.appearances[0]!])!
}

export interface ThemeIndexEntry {
  appearances: readonly Appearance[]
  /** Only appearances that have variants: default id + all ids. */
  variants?: Partial<Record<Appearance, { default: string; ids: string[] }>>
}

/**
 * Pre-paint data: family -> appearances (+ variant ids/defaults). Embedded as `var THEMES`
 * in index.html's inline script (a unit test keeps it in sync).
 */
export function themeIndex(): Record<string, ThemeIndexEntry> {
  return Object.fromEntries(
    THEME_FAMILIES.map((f) => {
      const entry: ThemeIndexEntry = { appearances: f.appearances }
      for (const a of f.appearances) {
        const list = variantsFor(f, a)
        if (list.length > 0) {
          entry.variants = { ...entry.variants, [a]: { default: defaultVariantId(f, a)!, ids: list.map((v) => v.id) } }
        }
      }
      return [f.id, entry]
    }),
  )
}

/** Legacy id -> { family, variants } map; embedded as `var LEGACY` in index.html. */
export function legacyIndex() {
  return LEGACY_THEME_FAMILIES
}
