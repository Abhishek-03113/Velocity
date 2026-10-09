import indexHtml from '../../index.html?raw'
import { describe, expect, it } from 'vitest'
import { COMMANDS } from './commands'
import {
  THEME_FAMILIES,
  getThemeFamily,
  resolveAppearance,
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
  })

  it('exposes an index for the pre-paint script', () => {
    expect(themeIndex()['nord']).toEqual(['light', 'dark'])
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
