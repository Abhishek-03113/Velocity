import { describe, expect, it } from 'vitest'
import {
  FIXED_PALETTES,
  loadAppearance,
  resolveColors,
  sanitizeAppearance,
  saveAppearance,
  LINE_HEIGHT,
  PARAGRAPH_SPACING,
  stepFontScale,
  stepPdfZoom,
  stepRange,
  THEMES,
  type TokenReader,
} from './appearance'
import { DEFAULT_APPEARANCE } from './reader/types'

function memoryStorage(initial?: unknown) {
  const store = new Map<string, unknown>()
  if (initial !== undefined) store.set('appearance', initial)
  return {
    store,
    get: <T,>(k: string) => store.get(k) as T | undefined,
    set: (k: string, v: unknown) => void store.set(k, v),
  }
}

const tokens = (dark: boolean): TokenReader => ({
  color: (expr) => `resolved(${expr})`,
  isDark: () => dark,
})

describe('resolveColors', () => {
  it('returns the fixed palettes', () => {
    expect(resolveColors('light', tokens(true))).toMatchObject({ background: '#ffffff', text: '#1d1d1f', link: '#0066cc', dark: false })
    expect(resolveColors('sepia', tokens(true))).toMatchObject({ background: '#f4ecd8', text: '#5b4636', link: '#8a5a2b', dark: false })
    expect(resolveColors('dark', tokens(false))).toMatchObject({ background: '#1c1c1e', text: '#e5e5e7', link: '#64a8ff', dark: true })
  })

  it('does not hand out the shared palette object', () => {
    const a = resolveColors('light', tokens(false))
    a.background = 'x'
    expect(FIXED_PALETTES.light.background).toBe('#ffffff')
  })

  it('Auto reads Velocity tokens and the dark flag', () => {
    const light = resolveColors('auto', tokens(false))
    expect(light.background).toBe('resolved(var(--bg-content))')
    expect(light.text).toBe('resolved(var(--label))')
    expect(light.link).toBe('resolved(var(--accent))')
    expect(light.selection).toContain('--editor-selection')
    expect(light.dark).toBe(false)
    expect(resolveColors('auto', tokens(true)).dark).toBe(true)
  })
})

describe('appearance persistence', () => {
  it('falls back to defaults', () => {
    expect(loadAppearance(memoryStorage())).toEqual(DEFAULT_APPEARANCE)
    expect(loadAppearance(memoryStorage('junk'))).toEqual(DEFAULT_APPEARANCE)
  })

  it('merges a partial value over the defaults and clamps', () => {
    const a = loadAppearance(memoryStorage({ theme: 'sepia', fontScale: 9, pdfZoom: 0.1, layout: 'weird' }))
    expect(a).toEqual({ ...DEFAULT_APPEARANCE, theme: 'sepia', fontScale: 1.6, pdfZoom: 0.5 })
  })

  it('keeps valid presets and rejects invalid ones', () => {
    expect(sanitizeAppearance({ pdfZoom: 'fit-page' }).pdfZoom).toBe('fit-page')
    expect(sanitizeAppearance({ pdfZoom: 'nope' }).pdfZoom).toBe('fit-width')
    expect(sanitizeAppearance({ theme: 'neon', fontFamily: 'comic' })).toEqual(DEFAULT_APPEARANCE)
  })

  it('round-trips through storage', () => {
    const s = memoryStorage()
    saveAppearance(s, { ...DEFAULT_APPEARANCE, theme: 'dark', fontFamily: 'sans', layout: 'scrolled', fontScale: 1.3, pdfZoom: 1.5 })
    expect(loadAppearance(s)).toEqual({ ...DEFAULT_APPEARANCE, theme: 'dark', fontFamily: 'sans', layout: 'scrolled', fontScale: 1.3, pdfZoom: 1.5 })
  })
})

describe('steps', () => {
  it('steps the font scale within 80-160', () => {
    expect(stepFontScale(1, 1)).toBe(1.1)
    expect(stepFontScale(0.8, -1)).toBe(0.8)
    expect(stepFontScale(1.6, 1)).toBe(1.6)
    expect(stepFontScale(1.2, 1)).toBe(1.3)
  })

  it('steps zoom by 10% below 100% and 25% above', () => {
    expect(stepPdfZoom(0.5, -1)).toBe(0.5)
    expect(stepPdfZoom(0.8, 1)).toBe(0.9)
    expect(stepPdfZoom(1, 1)).toBe(1.25)
    expect(stepPdfZoom(1.25, -1)).toBe(1)
    expect(stepPdfZoom(1, -1)).toBe(0.9)
    expect(stepPdfZoom(4, 1)).toBe(4)
    expect(stepPdfZoom('fit-width', 1, 0.8)).toBe(0.9)
  })
})

describe('appearance v2', () => {
  it('defaults to the paper theme', () => {
    expect(DEFAULT_APPEARANCE.theme).toBe('paper')
    expect(sanitizeAppearance(undefined).theme).toBe('paper')
    expect(THEMES).toEqual(['paper', 'auto', 'light', 'sepia', 'dark'])
  })

  it('migrates an older stored value: v1 fields kept, v2 fields filled with defaults', () => {
    const a = loadAppearance(memoryStorage({ theme: 'auto', fontScale: 1.2, fontFamily: 'sans', layout: 'scrolled', pdfZoom: 'fit-page' }))
    expect(a).toEqual({ ...DEFAULT_APPEARANCE, theme: 'auto', fontScale: 1.2, fontFamily: 'sans', layout: 'scrolled', pdfZoom: 'fit-page' })
    expect(a.lineHeight).toBe(1.6)
    expect(a.pageTurn).toBe('slide')
  })

  it('clamps and rounds line height and paragraph spacing', () => {
    expect(sanitizeAppearance({ lineHeight: 9, paragraphSpacing: -3 })).toMatchObject({ lineHeight: 2.2, paragraphSpacing: 0 })
    expect(sanitizeAppearance({ lineHeight: 0.5, paragraphSpacing: 9 })).toMatchObject({ lineHeight: 1.2, paragraphSpacing: 1.5 })
    expect(sanitizeAppearance({ lineHeight: 1.64, paragraphSpacing: 0.26 })).toMatchObject({ lineHeight: 1.6, paragraphSpacing: 0.3 })
    expect(sanitizeAppearance({ lineHeight: Number.NaN, paragraphSpacing: 'x' })).toMatchObject({ lineHeight: 1.6, paragraphSpacing: 0.6 })
  })

  it('validates margins, align and page turn', () => {
    expect(sanitizeAppearance({ margins: 'wide', align: 'justify', pageTurn: 'curl' })).toMatchObject({ margins: 'wide', align: 'justify', pageTurn: 'curl' })
    expect(sanitizeAppearance({ margins: 'huge', align: 'center', pageTurn: 'flip' })).toMatchObject({ margins: 'normal', align: 'left', pageTurn: 'slide' })
  })

  it('round-trips the v2 fields', () => {
    const s = memoryStorage()
    const value = { ...DEFAULT_APPEARANCE, lineHeight: 1.9, paragraphSpacing: 1, margins: 'narrow' as const, align: 'justify' as const, pageTurn: 'fade' as const }
    saveAppearance(s, value)
    expect(loadAppearance(s)).toEqual(value)
  })

  it('steps ranged settings by 0.1 within bounds', () => {
    expect(stepRange(1.6, 1, LINE_HEIGHT)).toBe(1.7)
    expect(stepRange(2.2, 1, LINE_HEIGHT)).toBe(2.2)
    expect(stepRange(1.2, -1, LINE_HEIGHT)).toBe(1.2)
    expect(stepRange(0.1, -1, PARAGRAPH_SPACING)).toBe(0)
    expect(stepRange(1.5, 1, PARAGRAPH_SPACING)).toBe(1.5)
  })

  it('every stock carries highlight fills; paper adds grain', () => {
    const t = tokens(false)
    for (const theme of ['paper', 'auto', 'light', 'sepia', 'dark'] as const) {
      const c = resolveColors(theme, t)
      expect(Object.keys(c.highlights ?? {})).toEqual(['yellow', 'green', 'blue', 'pink', 'orange'])
      expect(c.muted).toBeTruthy()
    }
    expect(resolveColors('paper', t).backgroundImage).toContain('feTurbulence')
    expect(resolveColors('light', t).backgroundImage).toBeNull()
  })
})
