/** Pure helpers for the PDF engine: positions, zoom, virtualised layout, progress and outline. No DOM, no pdf.js. */
import type { ReaderColors, TocItem } from '../types'

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4
/** Gap between pages and padding around the page column, in CSS px. */
export const PAGE_GAP = 16
export const PAGE_PADDING = 16
/** Pages rendered above and below the viewport. */
export const RENDER_MARGIN = 2
/** A page becomes "current" once it covers this fraction of the viewport height from the top. */
export const CURRENT_LINE = 0.35

export type PdfZoom = 'fit-width' | 'fit-page' | number

export interface Size {
  width: number
  height: number
}

export interface PdfPosition {
  /** 1-based page. */
  page: number
  /** 0..1: fraction of the page scrolled past the top of the viewport. */
  frac: number
}

export function roundFrac(frac: number): number {
  if (!Number.isFinite(frac)) return 0
  return Math.round(Math.min(1, Math.max(0, frac)) * 100) / 100
}

/** 'page:12' or 'page:12@0.35' -> { page, frac }; anything else -> null. */
export function parsePdfPosition(position: string | null | undefined): PdfPosition | null {
  if (!position) return null
  const m = /^page:(\d+)(?:@(\d*\.?\d+))?$/.exec(position.trim())
  if (!m) return null
  const page = Number(m[1])
  if (!Number.isSafeInteger(page) || page < 1) return null
  const frac = m[2] === undefined ? 0 : Number(m[2])
  if (!Number.isFinite(frac)) return null
  return { page, frac: roundFrac(frac) }
}

/** 'page:12' / 'page:12@0.35' -> 12; anything else -> null. */
export function parsePosition(position: string | null | undefined): number | null {
  return parsePdfPosition(position)?.page ?? null
}

/** The persisted position: 'page:<n>@<fraction>' (fraction with at most two decimals). */
export function formatPosition(page: number, frac = 0): string {
  return `page:${Math.max(1, Math.floor(page))}@${roundFrac(frac)}`
}

/** A plain page target (outline entries): 'page:<n>'. */
export function formatPage(page: number): string {
  return `page:${Math.max(1, Math.floor(page))}`
}

/** Negative when a is before b. Fractions compare at their persisted precision. */
export function comparePosition(a: PdfPosition, b: PdfPosition): number {
  if (a.page !== b.page) return a.page - b.page
  return roundFrac(a.frac) - roundFrac(b.frac)
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function fitWidthScale(page: Size, container: Size, padding = PAGE_PADDING): number {
  if (page.width <= 0) return 1
  return Math.max(0.1, (container.width - padding * 2) / page.width)
}

export function fitPageScale(page: Size, container: Size, padding = PAGE_PADDING): number {
  if (page.width <= 0 || page.height <= 0) return 1
  const w = (container.width - padding * 2) / page.width
  const h = (container.height - padding * 2) / page.height
  return Math.max(0.1, Math.min(w, h))
}

/** Concrete scale for a zoom setting; `page` is the page size at scale 1. */
export function resolveScale(zoom: PdfZoom, page: Size, container: Size): number {
  if (zoom === 'fit-width') return fitWidthScale(page, container)
  if (zoom === 'fit-page') return fitPageScale(page, container)
  return clampZoom(zoom)
}

export interface PageLayout {
  tops: number[]
  heights: number[]
  total: number
}

/** Vertical layout of all pages for the given scale-1 sizes. Pages start PAGE_PADDING from the top. */
export function computeLayout(sizes: Size[], scale: number, gap = PAGE_GAP, padding = PAGE_PADDING): PageLayout {
  const tops: number[] = []
  const heights: number[] = []
  let y = padding
  for (const s of sizes) {
    const h = s.height * scale
    tops.push(y)
    heights.push(h)
    y += h + gap
  }
  return { tops, heights, total: sizes.length ? y - gap + padding : 0 }
}

/** Index of the last page whose top is at or above `y`. */
function indexAt(tops: number[], y: number): number {
  let lo = 0
  let hi = tops.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid] <= y) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export const pageIndexAt = indexAt

/** Inclusive 0-based range of pages to keep rendered: visible pages plus `margin` on each side. */
export function renderWindow(
  layout: PageLayout,
  scrollTop: number,
  viewHeight: number,
  margin = RENDER_MARGIN,
): [number, number] {
  const n = layout.tops.length
  if (n === 0) return [0, -1]
  let first = indexAt(layout.tops, scrollTop)
  // The page found by `indexAt` may end above the viewport (inside the gap).
  if (layout.tops[first] + layout.heights[first] < scrollTop && first < n - 1) first++
  let last = indexAt(layout.tops, scrollTop + viewHeight)
  if (last < first) last = first
  return [Math.max(0, first - margin), Math.min(n - 1, last + margin)]
}

/** 1-based current page: the page under a line at 35% of the viewport height. */
export function currentPage(layout: PageLayout, scrollTop: number, viewHeight: number): number {
  if (layout.tops.length === 0) return 1
  return indexAt(layout.tops, scrollTop + viewHeight * CURRENT_LINE) + 1
}

export function isAtBottom(layout: PageLayout, scrollTop: number, viewHeight: number): boolean {
  return layout.total > 0 && scrollTop + viewHeight >= layout.total - 2
}

/** 0..1 through the document. The top of page N is exactly (N-1)/count; the bottom of the last page is 1. */
export function progressAt(layout: PageLayout, page: number, scrollTop: number, viewHeight: number): number {
  const count = layout.tops.length
  if (count === 0) return 0
  if (isAtBottom(layout, scrollTop, viewHeight)) return 1
  const i = Math.min(count - 1, Math.max(0, page - 1))
  const h = layout.heights[i]
  const frac = h > 0 ? Math.min(1, Math.max(0, (scrollTop - layout.tops[i]) / h)) : 0
  return Math.min(1, Math.max(0, (i + frac) / count))
}

/** Inverse of `progressAt`: the scrollTop for a progress fraction. */
export function scrollTopForProgress(layout: PageLayout, progress: number, viewHeight: number): number {
  const count = layout.tops.length
  if (count === 0) return 0
  const p = Math.min(1, Math.max(0, progress))
  if (p >= 1) return Math.max(0, layout.total - viewHeight)
  const x = p * count
  const i = Math.min(count - 1, Math.floor(x))
  return layout.tops[i] + (x - i) * layout.heights[i]
}

/**
 * CSS filter for the page canvas. Light stocks (paper, light, sepia, auto): none, the canvas is multiplied onto the paper
 * (see `pageBlend`). Dark: invert with hue kept, ink tinted warm.
 */
export function pageFilter(colors: Pick<ReaderColors, 'dark'>): string {
  return colors.dark ? 'invert(0.9) hue-rotate(180deg) sepia(0.15)' : 'none'
}

/**
 * Blend mode of the page canvas over the paper-coloured page box. Light: multiply (white page becomes paper, black stays ink).
 * Dark: lighten (the inverted page background becomes the dark paper, the inverted ink stays).
 */
export function pageBlend(colors: Pick<ReaderColors, 'dark'>): 'multiply' | 'lighten' {
  return colors.dark ? 'lighten' : 'multiply'
}


/** Shape of a pdf.js outline node (kept structural so this file does not import pdf.js). */
export interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items?: OutlineNode[]
}

/** Flatten an outline in reading order. `resolve` maps a dest to a 1-based page; unresolvable items are dropped (their children are kept). */
export async function flattenOutline(
  nodes: OutlineNode[] | null | undefined,
  resolve: (dest: OutlineNode['dest']) => Promise<number | null>,
): Promise<TocItem[]> {
  const out: TocItem[] = []
  const walk = async (list: OutlineNode[], level: number): Promise<void> => {
    for (const node of list) {
      const label = (node.title ?? '').replace(/\s+/g, ' ').trim()
      let page: number | null = null
      try {
        page = node.dest ? await resolve(node.dest) : null
      } catch {
        page = null
      }
      let childLevel = level
      if (page && label) {
        out.push({ id: `outline-${out.length}`, label, target: formatPage(page), level })
        childLevel = level + 1
      }
      if (node.items?.length) await walk(node.items, childLevel)
    }
  }
  await walk(nodes ?? [], 0)
  return out
}

/** Chapter label for a page: the last outline item whose page is <= `page`. */
export function chapterForPage(toc: TocItem[], page: number): string | null {
  let label: string | null = null
  for (const item of toc) {
    const p = parsePosition(item.target)
    if (p !== null && p <= page) label = item.label
  }
  return label
}

/** Clean a PDF info string: trim, drop empties and generator junk. */
export function cleanInfoString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.replace(/\0/g, '').trim()
  if (!v) return null
  const lower = v.toLowerCase()
  if (lower === 'untitled' || lower === 'unknown' || lower.endsWith('.dvi') || lower.startsWith('microsoft word - ')) return null
  return v
}
