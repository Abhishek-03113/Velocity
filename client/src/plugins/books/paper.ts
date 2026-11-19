/**
 * The "Paper" reader stock (spec §3.2): paper, ink and muted ink derived from the live Velocity tokens, a grain +
 * vignette `background-image`, and highlight fills tuned per stock. Pure: concrete colours come from the
 * `PaperTokens` it is given, which resolves `color-mix()` expressions on the real document.
 */
import { HIGHLIGHT_COLORS, type HighlightColor, type ReaderColors } from './reader/types'

/** Every fixed colour of the paper stock and the highlight palette lives here. */
export const PAPER_STOCK = {
  light: {
    /** Warm tint mixed into `--bg-content`, and the share of the app background kept. */
    paperTint: '#f3e7cf',
    // The spec says 88%; on pure-white app backgrounds that is barely warmer than Light, so light stocks keep 80%.
    paperKeep: 80,
    inkTint: '#2b2118',
    inkKeep: 92,
    /** Grain: speck colour (0..1 rgb), noise alpha, vignette edge colour. */
    grainRgb: [0.17, 0.13, 0.09],
    grainAlpha: 0.04,
    vignette: 'rgba(60, 40, 15, 0.05)',
    highlightAlpha: 0.35,
  },
  dark: {
    paperTint: '#2a2420',
    paperKeep: 88,
    inkTint: '#efe4d2',
    inkKeep: 92,
    grainRgb: [1, 0.95, 0.88],
    grainAlpha: 0.06,
    vignette: 'rgba(0, 0, 0, 0.22)',
    highlightAlpha: 0.3,
  },
  /** Share of ink kept for muted text. */
  mutedKeep: 60,
  grainBaseFrequency: 0.9,
  grainOctaves: 2,
  grainTile: 160,
  /** Solid bases of the five highlight colours (also the dots in the selection toolbar). */
  highlightBase: {
    yellow: '#ffd60a',
    green: '#34c759',
    blue: '#0a84ff',
    pink: '#ff375f',
    orange: '#ff9f0a',
  } satisfies Record<HighlightColor, string>,
} as const

/** Reads resolved CSS colours (any `var(--token)` / `color-mix()` expression) and the dark flag of the live theme. */
export interface PaperTokens {
  color(expression: string): string
  isDark(): boolean
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Highlight fills for a stock: base colour at 35% (light) / 30% (dark) alpha. */
export function highlightFills(dark: boolean): Record<HighlightColor, string> {
  const alpha = (dark ? PAPER_STOCK.dark : PAPER_STOCK.light).highlightAlpha
  return Object.fromEntries(HIGHLIGHT_COLORS.map((c) => [c, hexToRgba(PAPER_STOCK.highlightBase[c], alpha)])) as Record<
    HighlightColor,
    string
  >
}

/** The grain + vignette as one CSS `background-image` value (vignette on top, noise tile below it). */
export function paperBackgroundImage(dark: boolean): string {
  const s = dark ? PAPER_STOCK.dark : PAPER_STOCK.light
  const [r, g, b] = s.grainRgb
  // fractalNoise carries signal in every channel; the alpha row reads red so the specks vary, scaled so the mean is grainAlpha.
  const k = (s.grainAlpha * 2).toFixed(3)
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${PAPER_STOCK.grainTile}' height='${PAPER_STOCK.grainTile}'>` +
    `<filter id='n' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${PAPER_STOCK.grainBaseFrequency}' numOctaves='${PAPER_STOCK.grainOctaves}' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${k} 0 0 0 0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/></svg>`
  const vignette = `radial-gradient(ellipse at center, transparent 66%, ${s.vignette} 100%)`
  return `${vignette}, url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** `color-mix` expressions for paper, ink and muted ink. */
export function paperExpressions(dark: boolean) {
  const s = dark ? PAPER_STOCK.dark : PAPER_STOCK.light
  const paper = `color-mix(in oklab, var(--bg-content) ${s.paperKeep}%, ${s.paperTint})`
  const ink = `color-mix(in oklab, var(--label) ${s.inkKeep}%, ${s.inkTint})`
  const muted = `color-mix(in oklab, ${ink} ${PAPER_STOCK.mutedKeep}%, ${paper})`
  return { paper, ink, muted }
}

export function paperColors(tokens: PaperTokens): ReaderColors {
  const dark = tokens.isDark()
  const { paper, ink, muted } = paperExpressions(dark)
  return {
    background: tokens.color(paper),
    text: tokens.color(ink),
    muted: tokens.color(muted),
    link: tokens.color('var(--accent)'),
    selection: tokens.color('var(--editor-selection, color-mix(in srgb, var(--accent) 30%, transparent))'),
    dark,
    backgroundImage: paperBackgroundImage(dark),
    highlights: highlightFills(dark),
  }
}
