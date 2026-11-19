/**
 * Pure helpers for the EPUB engine: TOC flattening, appearance → CSS rules, page geometry, tap zones, mark
 * geometry, turn queueing and position bookkeeping. No epub.js or DOM imports so they are trivially unit-testable.
 */
import { withAppearanceDefaults } from '../types'
import type { ReaderAppearance, ReaderColors, TocItem } from '../types'

/** The part of epub.js's `NavItem` the engine reads. */
export interface NavLike {
  id?: string
  href: string
  label: string
  subitems?: NavLike[]
}

export const MIN_FONT_SCALE = 0.8
export const MAX_FONT_SCALE = 1.6

export function clampFontScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, scale))
}

/** Depth-first flatten of epub.js's nested navigation into reading-order `TocItem`s. */
export function flattenToc(items: readonly NavLike[] | undefined, level = 0, out: TocItem[] = []): TocItem[] {
  for (const item of items ?? []) {
    const label = (item.label ?? '').replace(/\s+/g, ' ').trim()
    if (item.href) {
      out.push({ id: item.id || `toc-${out.length}`, label: label || item.href, target: item.href, level })
    }
    if (item.subitems?.length) flattenToc(item.subitems, level + 1, out)
  }
  return out
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Page geometry                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------- */

/** Base text size at fontScale 1 (spec §3.2: about 19px). */
export const BASE_FONT_PX = 19
/** Measure cap: about 68 characters of serif text, in em. */
export const MEASURE_EM = 33
/** Tile width from which the paginated layout shows a two-page spread. */
export const SPREAD_MIN_WIDTH = 900

const MARGIN_PX = { narrow: 24, normal: 48, wide: 88 } as const

export interface PageGeometry {
  /** Two columns side by side. */
  spread: boolean
  /** epub.js `gap`: the page margin on both outer sides, and the gutter between the two pages of a spread. */
  gap: number
  /** One side margin in px. */
  margin: number
  /** Width of the element epub.js renders into (paged layout); the page sheet is centred in the tile. */
  mountWidth: number
  /** Space above and below the text block in the paged layout. */
  padTop: number
  padBottom: number
  /** Maximum text-column width in px (the measure cap). */
  textWidth: number
  narrow: boolean
}

/** Layout maths shared by the component and the CSS: margins, measure cap and spread breakpoint. */
export function computeGeometry(
  width: number,
  height: number,
  appearance: Pick<ReaderAppearance, 'fontScale' | 'margins'>,
): PageGeometry {
  const narrow = width < 600
  const margin = Math.round(MARGIN_PX[appearance.margins ?? 'normal'] * (narrow ? 0.5 : 1))
  const textWidth = Math.round(MEASURE_EM * BASE_FONT_PX * clampFontScale(appearance.fontScale))
  const spread = width >= SPREAD_MIN_WIDTH
  const needed = spread ? 2 * textWidth + 4 * margin : textWidth + 2 * margin
  // Even widths keep two columns pixel-aligned.
  const mountWidth = Math.max(1, Math.floor(Math.min(width, needed) / 2) * 2)
  const padTop = narrow ? 18 : 28
  const padBottom = narrow ? 22 : 32
  void height
  return { spread, gap: margin * 2, margin, mountWidth, padTop, padBottom, textWidth, narrow }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Theme rules                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------- */

export const FONT_STACKS = {
  serif: `"Iowan Old Style", "Charter", "Literata", Georgia, serif`,
  sans: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
} as const

export type ThemeRules = Record<string, Record<string, string>>

const IMP = ' !important'
/** Paragraph-like blocks the alignment and spacing rules apply to (centred epigraphs and the like are left alone). */
const FLOW_BLOCKS = 'p:not([class*="cent" i]):not([align="center"]):not([style*="center"]), li, dd'
const TEXT_BLOCKS = 'p, li, dd, blockquote, figcaption, td, th'

/** Appearance + resolved colours → epub.js style rules (selector → declarations). */
export function buildThemeRules(
  input: Pick<ReaderAppearance, 'fontScale' | 'fontFamily'> & Partial<ReaderAppearance>,
  colors: ReaderColors,
  geometry?: Pick<PageGeometry, 'margin' | 'textWidth' | 'narrow'>,
): ThemeRules {
  const a = withAppearanceDefaults(input as ReaderAppearance)
  const scale = clampFontScale(a.fontScale)
  const paged = a.layout === 'paginated'
  const margin = geometry?.margin ?? MARGIN_PX[a.margins]
  const textWidth = geometry?.textWidth ?? Math.round(MEASURE_EM * BASE_FONT_PX * scale)
  const ink = colors.text
  const muted = colors.muted ?? colors.text
  const stack = a.fontFamily === 'publisher' ? null : FONT_STACKS[a.fontFamily]

  const html: Record<string, string> = {
    // rem- and em-based publisher sizes both follow the scale because it lives on the root.
    'font-size': `${Math.round(BASE_FONT_PX * scale * 100) / 100}px${IMP}`,
    // The tile paints the paper; the page itself stays transparent so highlights can sit behind the text.
    background: `transparent${IMP}`,
    '-webkit-text-size-adjust': '100%',
    'touch-action': 'pan-y pinch-zoom',
    '-webkit-tap-highlight-color': 'transparent',
  }
  const body: Record<string, string> = {
    color: `${ink}${IMP}`,
    background: `transparent${IMP}`,
    'font-size': `100%${IMP}`,
    'line-height': `${a.lineHeight}${IMP}`,
    'text-rendering': 'optimizeLegibility',
    'font-kerning': 'normal',
    'font-variant-ligatures': 'common-ligatures',
    '-webkit-font-smoothing': 'antialiased',
    'overflow-wrap': 'break-word',
  }
  if (stack) body['font-family'] = `${stack}${IMP}`
  if (!paged) {
    // Continuous scroll: the iframe spans the tile, the text block is capped to the measure and centred.
    body.margin = `0 auto${IMP}`
    body.padding = `${geometry?.narrow ? 20 : 32}px ${margin}px ${geometry?.narrow ? 48 : 72}px${IMP}`
    body['max-width'] = `${textWidth + margin * 2}px${IMP}`
    body['box-sizing'] = `border-box${IMP}`
  }

  const rules: ThemeRules = {
    html,
    body,
    '*': { '-webkit-tap-highlight-color': 'transparent' },
    'a, a:link, a:visited': {
      color: `${ink}${IMP}`,
      'text-decoration': `underline${IMP}`,
      'text-decoration-color': `${colors.link}${IMP}`,
      'text-decoration-thickness': '1px',
      'text-underline-offset': '0.18em',
    },
    '::selection': { background: `${colors.selection}${IMP}`, color: 'inherit' },
    [TEXT_BLOCKS]: {
      'line-height': `${a.lineHeight}${IMP}`,
      'text-wrap': 'pretty',
      orphans: '2',
      widows: '2',
      color: `${ink}${IMP}`,
    },
    p: {
      margin: `0 0 ${a.paragraphSpacing}em 0${IMP}`,
      padding: `0${IMP}`,
    },
    [FLOW_BLOCKS]: {
      'text-align': `${a.align === 'justify' ? 'justify' : 'left'}${IMP}`,
    },
    'h1, h2, h3, h4, h5, h6': {
      'text-align': `center${IMP}`,
      margin: `1.6em 0 0.8em${IMP}`,
      'line-height': `1.25${IMP}`,
      'text-indent': `0${IMP}`,
      hyphens: `manual${IMP}`,
      '-webkit-hyphens': `manual${IMP}`,
      'text-wrap': 'balance',
      'break-after': 'avoid',
      'page-break-after': 'avoid',
      color: `${ink}${IMP}`,
    },
    h1: { 'font-size': `1.55em${IMP}` },
    h2: { 'font-size': `1.3em${IMP}` },
    'h3, h4': { 'font-size': `1.12em${IMP}` },
    'img, svg, video': {
      'max-width': `100%${IMP}`,
      height: `auto${IMP}`,
      'max-height': `${paged ? 90 : 100}${paged ? 'vh' : '%'}${IMP}`,
      'object-fit': 'contain',
    },
    img: { display: `block${IMP}`, margin: `1em auto${IMP}` },
    'pre, code': { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' },
    table: { 'max-width': `100%${IMP}` },
    blockquote: { 'border-color': `${muted}${IMP}` },
    hr: { 'border-color': `${muted}${IMP}`, opacity: '0.5' },
  }

  if (stack) {
    rules[`${TEXT_BLOCKS}, h1, h2, h3, h4, h5, h6, span, div`] = { 'font-family': `inherit${IMP}` }
    rules['h1, h2, h3, h4, h5, h6'] = { ...rules['h1, h2, h3, h4, h5, h6'], 'font-family': `${stack}${IMP}` }
  }

  if (a.paragraphSpacing > 0) {
    // Spacing replaces the first-line indent (Moon+ does the same); with no spacing the book's indent stays.
    rules.p['text-indent'] = `0${IMP}`
  }

  if (a.align === 'justify') {
    // Justified text without hyphenation makes rivers, so the two always travel together.
    rules[FLOW_BLOCKS].hyphens = `auto${IMP}`
    rules[FLOW_BLOCKS]['-webkit-hyphens'] = `auto${IMP}`
    rules[FLOW_BLOCKS]['hyphenate-limit-chars'] = '6 3 3'
    rules[FLOW_BLOCKS]['text-justify'] = 'inter-word'
  }
  return rules
}

/** Serialise rules to a CSS string (used for a single replaceable `<style>` per chapter). */
export function rulesToCss(rules: ThemeRules): string {
  return Object.entries(rules)
    .map(([selector, decls]) => `${selector}{${Object.entries(decls).map(([k, v]) => `${k}:${v};`).join('')}}`)
    .join('\n')
}

/** True when two appearances differ in something that reflows the text (so the position must be re-anchored). */
export function reflows(a: ReaderAppearance, b: ReaderAppearance): boolean {
  const x = withAppearanceDefaults(a)
  const y = withAppearanceDefaults(b)
  return (
    x.fontScale !== y.fontScale ||
    x.fontFamily !== y.fontFamily ||
    x.lineHeight !== y.lineHeight ||
    x.paragraphSpacing !== y.paragraphSpacing ||
    x.margins !== y.margins ||
    x.align !== y.align
  )
}

/* ------------------------------------------------------------------------------------------------------------- */
/* TOC                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

function stripFragment(href: string): string {
  const i = href.indexOf('#')
  return i === -1 ? href : href.slice(0, i)
}

function samePath(a: string, b: string): boolean {
  if (a === b) return true
  // TOC hrefs are relative to the nav document, spine hrefs to the package; tolerate a differing folder prefix.
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

/**
 * Label of the chapter containing `href`: the TOC entry for that file, else the nearest earlier spine item
 * that has one. `spineHrefs` is the reading order. Null when nothing matches.
 */
export function chapterLabelForHref(href: string | undefined, toc: readonly TocItem[], spineHrefs: readonly string[] = []): string | null {
  if (!href) return null
  const file = stripFragment(href)
  const find = (f: string): TocItem | undefined => toc.find((t) => samePath(stripFragment(t.target), f))
  const direct = find(file)
  if (direct) return direct.label
  let idx = spineHrefs.findIndex((h) => samePath(stripFragment(h), file))
  for (idx -= 1; idx >= 0; idx--) {
    const hit = find(stripFragment(spineHrefs[idx]))
    if (hit) return hit.label
  }
  return null
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Input                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------- */

export type TapZone = 'prev' | 'next' | 'center'
/** Moon+ tap zones: left 30% turns back, right 30% turns forward, the middle belongs to the shell's chrome. */
export const TAP_ZONE_FRACTION = 0.3

export function tapZone(x: number, width: number, paged = true): TapZone {
  if (!paged || !(width > 0)) return 'center'
  const f = x / width
  if (f < TAP_ZONE_FRACTION) return 'prev'
  if (f > 1 - TAP_ZONE_FRACTION) return 'next'
  return 'center'
}

export const SWIPE_MIN_PX = 40

/** A touch/pen drag that is horizontal enough and long enough turns the page. Dragging left goes forward. */
export function swipeDirection(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX) return null
  if (Math.abs(dx) < Math.abs(dy) * 1.2) return null
  return dx < 0 ? 'next' : 'prev'
}

export interface WheelTurner {
  push(dx: number, dy: number, now: number): 'next' | 'prev' | null
  reset(): void
}

/**
 * Trackpad horizontal scrolling → page turns. Deltas accumulate until a threshold, one turn fires, and further
 * deltas (the inertia tail of the same gesture) are ignored until a quiet gap.
 */
export function createWheelTurner(threshold = 60, quietMs = 140, lockMs = 380): WheelTurner {
  let acc = 0
  let last = 0
  let lockUntil = 0
  return {
    push(dx, dy, now) {
      if (Math.abs(dx) <= Math.abs(dy)) return null
      if (now - last > quietMs) acc = 0
      last = now
      if (now < lockUntil) {
        // Still inside the previous turn; extend the lock while deltas keep arriving.
        lockUntil = Math.max(lockUntil, now + 60)
        return null
      }
      acc += dx
      if (Math.abs(acc) < threshold) return null
      const dir = acc > 0 ? 'next' : 'prev'
      acc = 0
      lockUntil = now + lockMs
      return dir
    },
    reset() {
      acc = 0
      last = 0
      lockUntil = 0
    },
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Page-turn queue                                                                                                */
/* ------------------------------------------------------------------------------------------------------------- */

export type TurnDir = 'next' | 'prev'

/**
 * Never stack animations: while a turn runs, at most one more is remembered (the latest request wins). `request`
 * says what to do now, `done` hands back the queued turn to run next.
 */
export class TurnQueue {
  private busy = false
  private queued: TurnDir | null = null

  request(dir: TurnDir): 'start' | 'queued' {
    if (!this.busy) {
      this.busy = true
      return 'start'
    }
    this.queued = dir
    return 'queued'
  }

  done(): TurnDir | null {
    const next = this.queued
    this.queued = null
    if (!next) this.busy = false
    return next
  }

  get running(): boolean {
    return this.busy
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Annotation geometry                                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Client rects of a range come back as many boxes (per text node, plus block boxes). Drop slivers and boxes
 * contained in another, then join neighbours on the same line so strike lines and squiggles run unbroken.
 */
export function mergeLineRects(rects: readonly RectLike[]): RectLike[] {
  const usable = rects.filter((r) => r.width >= 1 && r.height >= 1)
  const kept = usable.filter((r, i) => !usable.some((o, j) => j !== i && contains(o, r, i, j)))
  kept.sort((a, b) => a.top - b.top || a.left - b.left)
  const out: RectLike[] = []
  for (const r of kept) {
    const prev = out[out.length - 1]
    const sameLine = prev && Math.abs(prev.top - r.top) < Math.min(prev.height, r.height) * 0.4
    if (prev && sameLine && r.left - (prev.left + prev.width) < 3) {
      const left = Math.min(prev.left, r.left)
      const right = Math.max(prev.left + prev.width, r.left + r.width)
      const top = Math.min(prev.top, r.top)
      const bottom = Math.max(prev.top + prev.height, r.top + r.height)
      out[out.length - 1] = { left, top, width: right - left, height: bottom - top }
    } else {
      out.push({ ...r })
    }
  }
  return out
}

function contains(o: RectLike, r: RectLike, i: number, j: number): boolean {
  const inside = r.left >= o.left - 0.5 && r.top >= o.top - 0.5 && r.left + r.width <= o.left + o.width + 0.5 && r.top + r.height <= o.top + o.height + 0.5
  if (!inside) return false
  // Identical boxes: keep the first only.
  const same = o.left === r.left && o.top === r.top && o.width === r.width && o.height === r.height
  return same ? j < i : true
}

/** Squiggle (wavy underline) as an SVG path: smooth quadratic waves `wavelength` px long and `amp` px high. */
export function squigglePath(x: number, y: number, width: number, amp = 1.6, wavelength = 5): string {
  const half = wavelength / 2
  const n = Math.max(1, Math.round(width / half))
  const step = width / n
  let d = `M${r2(x)} ${r2(y)}`
  for (let i = 0; i < n; i++) {
    const cx = x + step * (i + 0.5)
    const ex = x + step * (i + 1)
    const cy = y + (i % 2 === 0 ? -amp : amp) * 2
    d += `Q${r2(cx)} ${r2(cy)} ${r2(ex)} ${r2(y)}`
  }
  return d
}

/** y of an underline, just below the glyph baseline area of a line box. */
export function underlineY(rect: RectLike): number {
  return rect.top + rect.height - 2
}

/** y of a strike-through: the vertical middle of the line box (a touch high, where the x-height sits). */
export function strikeY(rect: RectLike): number {
  return rect.top + rect.height * 0.54
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

export function pointInRects(x: number, y: number, rects: readonly RectLike[], slop = 2): boolean {
  return rects.some((r) => x >= r.left - slop && x <= r.left + r.width + slop && y >= r.top - slop && y <= r.top + r.height + slop)
}

export interface AnnotationLike {
  id: string
  locator: string
  color: string
  style: string
  hasNote?: boolean
}

export interface AnnotationDiff<T extends AnnotationLike> {
  add: T[]
  remove: string[]
  update: T[]
}

/** Diff two annotation lists by id. `update` holds those whose colour, style, note flag or locator changed. */
export function diffAnnotations<T extends AnnotationLike>(prev: ReadonlyMap<string, T>, next: readonly T[]): AnnotationDiff<T> {
  const add: T[] = []
  const update: T[] = []
  const seen = new Set<string>()
  for (const a of next) {
    seen.add(a.id)
    const old = prev.get(a.id)
    if (!old) add.push(a)
    else if (old.locator !== a.locator || old.color !== a.color || old.style !== a.style || !!old.hasNote !== !!a.hasNote) update.push(a)
  }
  const remove = [...prev.keys()].filter((id) => !seen.has(id))
  return { add, remove, update }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Positions                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------- */

export type CfiCompare = (a: string, b: string) => number

export interface RestoreState {
  /** The CFI the reader was asked to show (saved position, or the first visible text before a relayout). */
  target: string
  /** The page start observed once the restore finished; the hold ends when the reader moves off it. */
  settled: string | null
}

export interface ResolvedPosition {
  /** CFI to report, or null when this location is an intermediate step that must not be reported. */
  position: string | null
  /** True while the restore still governs what is reported. */
  hold: boolean
}

/**
 * Which position to report for a page spanning `start`..`end`. While a restore target is held, nothing earlier
 * than the target is ever reported: a page that ends before it is skipped (an intermediate step), and a page that
 * starts before it but contains it reports the target itself.
 */
export function resolvePosition(start: string, end: string | undefined, restore: RestoreState | null, compare: CfiCompare): ResolvedPosition {
  if (!restore) return { position: start, hold: false }
  let cmpStartTarget = 0
  let cmpEndTarget = 1
  try {
    cmpStartTarget = compare(start, restore.target)
    cmpEndTarget = end ? compare(end, restore.target) : 1
  } catch {
    return { position: start, hold: false }
  }
  if (restore.settled === null) {
    if (cmpEndTarget < 0) return { position: null, hold: true }
    return { position: cmpStartTarget < 0 ? restore.target : start, hold: true }
  }
  if (start !== restore.settled) return { position: start, hold: false }
  return { position: cmpStartTarget < 0 ? restore.target : start, hold: true }
}

/** Vertical/horizontal visibility of a range's first line against the page window, for restore verification. */
export function stepToward(rectLeft: number, rectTop: number, win: { left: number; top: number; width: number; height: number }, paged: boolean): 'next' | 'prev' | 'here' {
  if (paged) {
    if (rectLeft >= win.left + win.width - 1) return 'next'
    if (rectLeft < win.left - 1) return 'prev'
    return 'here'
  }
  if (rectTop >= win.top + win.height - 1) return 'next'
  if (rectTop < win.top) return 'prev'
  return 'here'
}

/** Fully opaque version of a CSS colour with alpha (rgba/hsla/#rrggbbaa), for strokes drawn at full strength. */
export function fullStrength(css: string): string {
  const c = css.trim()
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c)
  if (m) return `rgb(${m[1]}, ${m[2]}, ${m[3]})`
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+%)[\s,]+([\d.]+%)/i.exec(c)
  if (m) return `hsl(${m[1]}, ${m[2]}, ${m[3]})`
  const hex = /^#([0-9a-f]{8})$/i.exec(c)
  if (hex) return `#${hex[1].slice(0, 6)}`
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]$/i.exec(c)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return c
}
