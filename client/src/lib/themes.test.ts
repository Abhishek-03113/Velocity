import indexHtml from '../../index.html?raw'
import { describe, expect, it } from 'vitest'
import { COMMANDS } from './commands'
import {
  THEME_FAMILIES,
  LEGACY_THEME_FAMILIES,
  defaultVariantId,
  getThemeFamily,
  resolveAppearance,
  resolveVariant,
  sanitizeThemeVariants,
  swatchFor,
  variantsFor,
  resolveFamilyAppearance,
  sanitizeAppearancePref,
  sanitizeThemeFamily,
  themeIndex,
} from './themes'
import { DEFAULT_PREFS, sanitizePrefs } from '../store/uiStore'

describe('theme registry', () => {
  it('has unique ids, at least one appearance and swatches for each', () => {
    const ids = THEME_FAMILIES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of THEME_FAMILIES) {
      expect(f.appearances.length).toBeGreaterThan(0)
      for (const a of f.appearances) expect(f.swatches[a]).toBeTruthy()
    }
    expect(ids).toEqual(expect.arrayContaining(['apple', 'catppuccin', 'gruvbox', 'everforest', 'nord', 'solarized']))
  })

  it('generates one palette command per family', () => {
    for (const f of THEME_FAMILIES) {
      expect(COMMANDS.find((c) => c.id === `theme.${f.id}`)?.title).toBe(`Theme: ${f.name}`)
    }
  })

  it('keeps the pre-paint script in index.html in sync with the registry', () => {
    const m = /var THEMES = (\{.*\})/.exec(indexHtml)
    expect(m).toBeTruthy()
    expect(JSON.parse(m![1]!)).toEqual(JSON.parse(JSON.stringify(themeIndex())))
    const legacy = /var LEGACY = (\{.*\})/.exec(indexHtml)
    expect(legacy).toBeTruthy()
    expect(JSON.parse(legacy![1]!)).toEqual(JSON.parse(JSON.stringify(LEGACY_THEME_FAMILIES)))
  })

  it('exposes appearances and variants for the pre-paint script', () => {
    expect(themeIndex()['nord']).toEqual({ appearances: ['light', 'dark'] })
    expect(themeIndex()['catppuccin']?.variants).toEqual({
      light: { default: 'latte', ids: ['latte'] },
      dark: { default: 'mocha', ids: ['frappe', 'macchiato', 'mocha'] },
    })
  })

  it('declares well-formed variants with swatches and valid defaults', () => {
    for (const f of THEME_FAMILIES) {
      for (const a of ['light', 'dark'] as const) {
        const list = variantsFor(f, a)
        if (list.length === 0) continue
        expect(f.appearances).toContain(a)
        expect(new Set(list.map((v) => v.id)).size).toBe(list.length)
        expect(list.map((v) => v.id)).toContain(defaultVariantId(f, a))
        for (const v of list) expect(v.swatch.bg).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('has one Catppuccin family with Latte and three dark flavours', () => {
    expect(THEME_FAMILIES.some((f) => f.id === 'catppuccin-macchiato')).toBe(false)
    const c = getThemeFamily('catppuccin')
    expect(variantsFor(c, 'light').map((v) => v.id)).toEqual(['latte'])
    expect(variantsFor(c, 'dark').map((v) => v.id)).toEqual(['frappe', 'macchiato', 'mocha'])
    expect(defaultVariantId(c, 'dark')).toBe('mocha')
    expect(defaultVariantId(getThemeFamily('nord'), 'dark')).toBeUndefined()
  })

  it('generates one palette command per family variant', () => {
    expect(COMMANDS.find((c) => c.id === 'theme.catppuccin.dark.mocha')?.title).toBe('Theme: Catppuccin Mocha')
    expect(COMMANDS.find((c) => c.id === 'theme.catppuccin.dark.frappe')?.title).toBe('Theme: Catppuccin Frappé')
    expect(COMMANDS.find((c) => c.id === 'theme.catppuccin.light.latte')?.title).toBe('Theme: Catppuccin Latte')
    expect(COMMANDS.find((c) => c.id === 'theme.nord.dark.nord')).toBeUndefined()
  })
})

describe('appearance resolution', () => {
  it('follows the preference or the OS when the family ships both', () => {
    expect(resolveAppearance('gruvbox', 'light', true)).toBe('light')
    expect(resolveAppearance('gruvbox', 'dark', false)).toBe('dark')
    expect(resolveAppearance('gruvbox', 'system', true)).toBe('dark')
    expect(resolveAppearance('gruvbox', 'system', false)).toBe('light')
  })

  it('falls back to the appearance a family actually has', () => {
    const darkOnly = { appearances: ['dark'] as const }
    expect(resolveFamilyAppearance(darkOnly, 'light', false)).toBe('dark')
    expect(resolveFamilyAppearance(darkOnly, 'system', false)).toBe('dark')
    expect(resolveFamilyAppearance(darkOnly, 'dark', false)).toBe('dark')
    const lightOnly = { appearances: ['light'] as const }
    expect(resolveFamilyAppearance(lightOnly, 'dark', true)).toBe('light')
  })

  it('every shipped family supports light and dark', () => {
    for (const f of THEME_FAMILIES) expect(resolveAppearance(f.id, 'light', true)).toBe('light')
  })

  it('treats unknown families as Apple', () => {
    expect(getThemeFamily('nope').id).toBe('apple')
    expect(resolveAppearance('nope', 'light', true)).toBe('light')
  })
})

describe('theme variants', () => {
  const cat = getThemeFamily('catppuccin')

  it('resolves stored choices and falls back to the defaults', () => {
    expect(resolveVariant(cat, 'dark', undefined)).toBe('mocha')
    expect(resolveVariant(cat, 'light', {})).toBe('latte')
    expect(resolveVariant(cat, 'dark', { catppuccin: { dark: 'frappe' } })).toBe('frappe')
    expect(resolveVariant(cat, 'dark', { catppuccin: { dark: 'nope' } })).toBe('mocha')
    expect(resolveVariant(getThemeFamily('nord'), 'dark', { nord: { dark: 'x' } })).toBeUndefined()
  })

  it('sanitizes variant prefs', () => {
    expect(sanitizeThemeVariants({ catppuccin: { dark: 'macchiato', light: 'latte' } })).toEqual({
      catppuccin: { dark: 'macchiato', light: 'latte' },
    })
    expect(
      sanitizeThemeVariants({ catppuccin: { dark: 'latte', light: 7 }, nord: { dark: 'x' }, bogus: { dark: 'a' } }),
    ).toEqual({})
    expect(sanitizeThemeVariants(null)).toEqual({})
    expect(sanitizeThemeVariants([1])).toEqual({})
    expect(sanitizeThemeVariants('x')).toEqual({})
    expect(sanitizePrefs({ themeVariants: { catppuccin: { dark: 'bad' } } }).themeVariants).toEqual({})
    expect(DEFAULT_PREFS.themeVariants).toEqual({})
  })

  it('previews the chosen variant swatch', () => {
    expect(swatchFor(cat, 'dark', 'frappe').bg).toBe('#303446')
    expect(swatchFor(cat, 'dark', 'bogus').bg).toBe(swatchFor(cat, 'dark').bg)
    expect(swatchFor(cat, 'dark').bg).toBe('#1e1e2e')
  })

  it('migrates the old catppuccin-macchiato family', () => {
    const p = sanitizePrefs({ themeFamily: 'catppuccin-macchiato', theme: 'dark' })
    expect(p.themeFamily).toBe('catppuccin')
    expect(p.themeVariants).toEqual({ catppuccin: { dark: 'macchiato' } })
    expect(resolveVariant(cat, 'dark', p.themeVariants)).toBe('macchiato')
    expect(resolveVariant(cat, 'light', p.themeVariants)).toBe('latte')
    // An explicit choice in the same prefs object wins over the implied one.
    const q = sanitizePrefs({ themeFamily: 'catppuccin-macchiato', themeVariants: { catppuccin: { dark: 'frappe' } } })
    expect(q.themeVariants.catppuccin?.dark).toBe('frappe')
  })
})

describe('preference sanitizing', () => {
  it('rejects unknown values', () => {
    expect(sanitizeThemeFamily('gruvbox')).toBe('gruvbox')
    expect(sanitizeThemeFamily('hot-dog-stand')).toBe('apple')
    expect(sanitizeThemeFamily(42)).toBe('apple')
    expect(sanitizeAppearancePref('purple')).toBe('system')
  })

  it('sanitizes stored preferences', () => {
    const p = sanitizePrefs({ themeFamily: 'bogus', theme: 'neon' as never, accent: 'chartreuse' as never })
    expect(p.themeFamily).toBe('apple')
    expect(p.theme).toBe('system')
    expect(p.accent).toBe(DEFAULT_PREFS.accent)
    expect(sanitizePrefs({ themeFamily: 'nord', accent: 'theme', theme: 'dark' })).toMatchObject({
      themeFamily: 'nord',
      accent: 'theme',
      theme: 'dark',
    })
    expect(sanitizePrefs({ accent: 'orange' }).accent).toBe('orange')
  })
})
