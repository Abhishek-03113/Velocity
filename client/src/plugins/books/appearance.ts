/**
 * Reader appearance: persisted preferences (per browser, `ctx.storage('appearance')`) and the concrete colours
 * the shell hands to the engines. Pure: the DOM is only touched through the `TokenReader` it is given.
 */
import { DEFAULT_APPEARANCE, type ReaderAppearance, type ReaderColors, type ReaderTheme } from './reader/types'

export interface AppearanceStorage {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

export const APPEARANCE_KEY = 'appearance'

export const THEMES: readonly ReaderTheme[] = ['auto', 'light', 'sepia', 'dark']
export const FONT_SCALE = { min: 0.8, max: 1.6, step: 0.1 } as const
export const PDF_ZOOM = { min: 0.5, max: 4 } as const

/** The fixed reader palettes: the only raw colours in the reader. Auto reads Velocity tokens instead. */
export const FIXED_PALETTES: Record<Exclude<ReaderTheme, 'auto'>, ReaderColors> = {
  light: { background: '#ffffff', text: '#1d1d1f', link: '#0066cc', selection: 'rgba(0, 102, 204, 0.25)', dark: false },
  sepia: { background: '#f4ecd8', text: '#5b4636', link: '#8a5a2b', selection: 'rgba(138, 90, 43, 0.28)', dark: false },
  dark: { background: '#1c1c1e', text: '#e5e5e7', link: '#64a8ff', selection: 'rgba(100, 168, 255, 0.35)', dark: true },
}

/** Reads resolved CSS colours (any `var(--token)` expression) and the dark flag of the current Velocity theme. */
export interface TokenReader {
  color(expression: string): string
  isDark(): boolean
}

export function resolveColors(theme: ReaderTheme, tokens: TokenReader): ReaderColors {
  if (theme !== 'auto') return { ...FIXED_PALETTES[theme] }
  return {
    background: tokens.color('var(--bg-content)'),
    text: tokens.color('var(--label)'),
    link: tokens.color('var(--accent)'),
    selection: tokens.color('var(--editor-selection, color-mix(in srgb, var(--accent) 30%, transparent))'),
    dark: tokens.isDark(),
  }
}

/** Token reader backed by the live document: a probe element resolves var() and color-mix() to concrete colours. */
export function domTokens(): TokenReader {
  return {
    color(expression) {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
      probe.style.color = expression
      document.documentElement.appendChild(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return resolved
    },
    isDark: () => document.documentElement.dataset.theme === 'dark',
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const round1 = (n: number) => Math.round(n * 10) / 10

export function sanitizeAppearance(raw: unknown): ReaderAppearance {
  const base = DEFAULT_APPEARANCE
  if (!raw || typeof raw !== 'object') return { ...base }
  const r = raw as Record<string, unknown>
  const theme = THEMES.includes(r.theme as ReaderTheme) ? (r.theme as ReaderTheme) : base.theme
  const fontScale =
    typeof r.fontScale === 'number' && Number.isFinite(r.fontScale)
      ? round1(clamp(r.fontScale, FONT_SCALE.min, FONT_SCALE.max))
      : base.fontScale
  const fontFamily =
    r.fontFamily === 'serif' || r.fontFamily === 'sans' || r.fontFamily === 'publisher' ? r.fontFamily : base.fontFamily
  const layout = r.layout === 'paginated' || r.layout === 'scrolled' ? r.layout : base.layout
  let pdfZoom: ReaderAppearance['pdfZoom'] = base.pdfZoom
  if (r.pdfZoom === 'fit-width' || r.pdfZoom === 'fit-page') pdfZoom = r.pdfZoom
  else if (typeof r.pdfZoom === 'number' && Number.isFinite(r.pdfZoom)) {
    pdfZoom = Math.round(clamp(r.pdfZoom, PDF_ZOOM.min, PDF_ZOOM.max) * 100) / 100
  }
  return { theme, fontScale, fontFamily, layout, pdfZoom }
}

export function loadAppearance(storage: AppearanceStorage): ReaderAppearance {
  try {
    return sanitizeAppearance(storage.get<unknown>(APPEARANCE_KEY))
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function saveAppearance(storage: AppearanceStorage, appearance: ReaderAppearance): void {
  try {
    storage.set(APPEARANCE_KEY, sanitizeAppearance(appearance))
  } catch (err) {
    console.error('[books] could not save reader appearance', err)
  }
}

/** Next/previous text size, clamped to the allowed range. */
export function stepFontScale(current: number, direction: 1 | -1): number {
  return round1(clamp(current + direction * FONT_SCALE.step, FONT_SCALE.min, FONT_SCALE.max))
}

/** Zoom steps: 10% up to 100%, then 25% (spec: 50-400, steps 10/25). From a fit preset, start at `fitScale`. */
export function stepPdfZoom(current: ReaderAppearance['pdfZoom'], direction: 1 | -1, fitScale = 1): number {
  const value = typeof current === 'number' ? current : fitScale
  const step = (direction === 1 ? value >= 1 : value > 1) ? 0.25 : 0.1
  const next = Math.round((value + direction * step) * 100) / 100
  return clamp(next, PDF_ZOOM.min, PDF_ZOOM.max)
}
