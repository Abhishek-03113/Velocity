/** Pure helpers for PDF highlights: `pdf:` locators, rect normalisation and merging, hit-testing and colours. */
import type { HighlightColor } from '../types'

/** [x, y, width, height], each 0..1 of the unscaled page box. */
export type Rect = [number, number, number, number]

export interface BoxRect {
  left: number
  top: number
  width: number
  height: number
}

export const LOCATOR_PREFIX = 'pdf:'

export interface PdfLocator {
  page: number
  rects: Rect[]
}

export function formatLocator(page: number, rects: Rect[]): string {
  return LOCATOR_PREFIX + JSON.stringify({ page: Math.max(1, Math.floor(page)), rects })
}

export function isPdfLocator(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(LOCATOR_PREFIX)
}

export function parseLocator(value: string | null | undefined): PdfLocator | null {
  if (typeof value !== 'string' || !isPdfLocator(value)) return null
  try {
    const data = JSON.parse(value.slice(LOCATOR_PREFIX.length)) as { page?: unknown; rects?: unknown }
    if (typeof data.page !== 'number' || !Number.isSafeInteger(data.page) || data.page < 1) return null
    if (!Array.isArray(data.rects)) return null
    const rects: Rect[] = []
    for (const r of data.rects) {
      if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
      rects.push([r[0], r[1], r[2], r[3]])
    }
    return { page: data.page, rects }
  } catch {
    return null
  }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Normalise a viewport rect to the page box, clamped to 0..1. */
export function normaliseRect(r: BoxRect, box: BoxRect): Rect {
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  const x0 = clamp((r.left - box.left) / box.width)
  const y0 = clamp((r.top - box.top) / box.height)
  const x1 = clamp((r.left + r.width - box.left) / box.width)
  const y1 = clamp((r.top + r.height - box.top) / box.height)
  return [round4(x0), round4(y0), round4(x1 - x0), round4(y1 - y0)]
}

/**
 * Merge text-layer rects that sit on the same line: rects fully inside another are dropped, rects that overlap
 * vertically by at least half and are at most `gap` (page widths) apart are united. Result in reading order.
 */
export function mergeLineRects(rects: Rect[], gap = 0.02): Rect[] {
  const live = rects.filter((r) => r[2] > 0 && r[3] > 0)
  const eps = 1e-6
  const kept = live.filter(
    (a, i) =>
      !live.some(
        (b, j) =>
          j !== i &&
          b[0] <= a[0] + eps &&
          b[1] <= a[1] + eps &&
          b[0] + b[2] >= a[0] + a[2] - eps &&
          b[1] + b[3] >= a[1] + a[3] - eps &&
          (b[2] > a[2] + eps || b[3] > a[3] + eps || j < i),
      ),
  )
  interface Line {
    top: number
    bottom: number
    items: Rect[]
  }
  const lines: Line[] = []
  for (const r of [...kept].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const top = r[1]
    const bottom = r[1] + r[3]
    const line = lines.find((l) => Math.min(l.bottom, bottom) - Math.max(l.top, top) >= 0.5 * Math.min(l.bottom - l.top, bottom - top))
    if (line) {
      line.items.push(r)
      line.top = Math.min(line.top, top)
      line.bottom = Math.max(line.bottom, bottom)
    } else lines.push({ top, bottom, items: [r] })
  }
  const out: Rect[] = []
  for (const line of lines.sort((a, b) => a.top - b.top)) {
    const items = line.items.sort((a, b) => a[0] - b[0])
    let x0 = items[0][0]
    let x1 = items[0][0] + items[0][2]
    const flush = () => out.push([round4(x0), round4(line.top), round4(x1 - x0), round4(line.bottom - line.top)])
    for (const r of items.slice(1)) {
      if (r[0] <= x1 + gap) x1 = Math.max(x1, r[0] + r[2])
      else {
        flush()
        x0 = r[0]
        x1 = r[0] + r[2]
      }
    }
    flush()
  }
  return out
}

/** Client rects of a text selection -> merged, normalised rects of one page. Rects outside the page box are dropped. */
export function selectionRects(clientRects: BoxRect[], box: BoxRect): Rect[] {
  if (!(box.width > 0) || !(box.height > 0)) return []
  const inside = clientRects.filter((r) => {
    if (r.width < 0.5 || r.height < 0.5) return false
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    return cx >= box.left && cx <= box.left + box.width && cy >= box.top && cy <= box.top + box.height
  })
  return mergeLineRects(inside.map((r) => normaliseRect(r, box)))
}

/** Bounding rect of several rects. */
export function rectsBounds(rects: Rect[]): Rect {
  if (rects.length === 0) return [0, 0, 0, 0]
  const x0 = Math.min(...rects.map((r) => r[0]))
  const y0 = Math.min(...rects.map((r) => r[1]))
  const x1 = Math.max(...rects.map((r) => r[0] + r[2]))
  const y1 = Math.max(...rects.map((r) => r[1] + r[3]))
  return [x0, y0, x1 - x0, y1 - y0]
}

/** Index of the rect containing the normalised point (with a small tolerance), or -1. */
export function hitRect(rects: Rect[], x: number, y: number, tolerance = 0.004): number {
  return rects.findIndex((r) => x >= r[0] - tolerance && x <= r[0] + r[2] + tolerance && y >= r[1] - tolerance && y <= r[1] + r[3] + tolerance)
}

/** Fallback fills (alpha included) when the shell sends no `ReaderColors.highlights`. */
export const DEFAULT_HIGHLIGHTS_LIGHT: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 214, 10, 0.4)',
  green: 'rgba(52, 199, 89, 0.35)',
  blue: 'rgba(10, 132, 255, 0.3)',
  pink: 'rgba(255, 55, 95, 0.3)',
  orange: 'rgba(255, 159, 10, 0.4)',
}
export const DEFAULT_HIGHLIGHTS_DARK: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 214, 10, 0.3)',
  green: 'rgba(48, 209, 88, 0.3)',
  blue: 'rgba(10, 132, 255, 0.35)',
  pink: 'rgba(255, 55, 95, 0.35)',
  orange: 'rgba(255, 159, 10, 0.3)',
}

/** The same colour at full strength, for underline, strike and squiggle lines. Unrecognised input is returned as is. */
export function solidColor(css: string): string {
  const s = css.trim().toLowerCase()
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s)
  if (rgb) return `rgb(${Math.round(Number(rgb[1]))}, ${Math.round(Number(rgb[2]))}, ${Math.round(Number(rgb[3]))})`
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(s)
  if (hex) return `#${hex[1]}`
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+%)[\s,]+([\d.]+%)/.exec(s)
  if (hsl) return `hsl(${hsl[1]}, ${hsl[2]}, ${hsl[3]})`
  return css
}

/** A tiling SVG wave (as a CSS url()) for squiggly underlines. */
export function squiggleImage(color: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'>` +
    `<path d='M0 3 Q2 0.2 4 2 T8 2' fill='none' stroke='${color.replace(/'/g, '')}' stroke-width='1.4' stroke-linecap='round'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`

/** A tiling SVG of cursive loops (as a CSS url()) for curly underlines. */
export function curlyImage(color: string): string {
  const c = color.replace(/'/g, '')
  return svgUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='7' height='7' viewBox='0 0 7 7'>` +
      `<path d='M0 5.5C7.3 4.6 6.3 0 3.8 1.3 1.4 2.6 3.2 6.9 7 5.5' fill='none' stroke='${c}' stroke-width='1.1' stroke-linecap='round'/></svg>`,
  )
}

/**
 * Excalidraw-style hand-drawn underline (as a CSS url()), stretched to the line's width: two rough strokes that
 * wander and overshoot. `seed` picks one of a few shapes so neighbouring lines do not look stamped.
 */
export function sketchImage(color: string, seed = 0): string {
  const c = color.replace(/'/g, '')
  const shapes = [
    ['M1 3.2Q22 1.9 47 3.4T99 2.8', 'M2 5.1Q30 4.2 55 5.4T98 4.6'],
    ['M0.5 2.6Q28 3.9 52 2.7T99.5 3.3', 'M3 4.9Q26 5.6 49 4.5T97 5.2'],
    ['M1.5 3.5Q19 2.4 41 3.1T99 3', 'M1 5.3Q35 4.4 63 5.5T99 4.8'],
  ]
  const [a, b] = shapes[Math.abs(seed) % shapes.length]!
  return svgUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='7' viewBox='0 0 100 7' preserveAspectRatio='none'>` +
      `<path d='${a}' fill='none' stroke='${c}' stroke-width='1.6' stroke-linecap='round' vector-effect='non-scaling-stroke'/>` +
      `<path d='${b}' fill='none' stroke='${c}' stroke-width='1.05' stroke-opacity='0.75' stroke-linecap='round' vector-effect='non-scaling-stroke'/></svg>`,
  )
}
