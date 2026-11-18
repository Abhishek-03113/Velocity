import { describe, expect, it } from 'vitest'
import {
  FIXED_PALETTES,
  loadAppearance,
  resolveColors,
  sanitizeAppearance,
  saveAppearance,
  stepFontScale,
  stepPdfZoom,
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
    expect(loadAppearance(s)).toEqual({ theme: 'dark', fontFamily: 'sans', layout: 'scrolled', fontScale: 1.3, pdfZoom: 1.5 })
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
