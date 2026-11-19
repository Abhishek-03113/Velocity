/**
 * Highlight drawing for one rendered EPUB section. Two transparent SVG layers sit over the section's iframe,
 * in the parent document: highlight fills go *behind* the (transparent) iframe so the ink stays crisp, and
 * underline / strike / squiggle / note marks go in front. Geometry comes from the range's client rects, which are
 * already in the iframe's coordinate space, so no offsets are needed. Clicks are not handled by the SVG (it has
 * `pointer-events: none`); the engine hit-tests the click it receives inside the iframe with `hit()`.
 */
import type { HighlightColor, ReaderAnnotation, ReaderColors } from '../types'
import { curlyPath, fullStrength, mergeLineRects, pointInRects, seedOf, sketchPaths, squigglePath, strikeY, underlineY, type RectLike } from './helpers'

const NS = 'http://www.w3.org/2000/svg'

/** Used when the shell hands no palette (Auto stock before ACC-38 lands). */
const FALLBACK_FILLS: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 214, 10, 0.38)',
  green: 'rgba(52, 199, 89, 0.34)',
  blue: 'rgba(10, 132, 255, 0.30)',
  pink: 'rgba(255, 55, 140, 0.30)',
  orange: 'rgba(255, 149, 0, 0.36)',
}

export interface MarkContents {
  document: Document
  sectionIndex?: number
  range(cfi: string, ignoreClass?: string): Range | null | undefined
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

export class MarksLayer {
  readonly back: SVGSVGElement
  readonly front: SVGSVGElement
  private groups = new Map<string, { back: SVGGElement; front: SVGGElement }>()
  private rects = new Map<string, RectLike[]>()

  constructor(
    private readonly contents: MarkContents,
    private readonly frame: HTMLIFrameElement,
    /** Section index (spine position) a locator belongs to, or null when it cannot be parsed. */
    private readonly sectionOf: (locator: string) => number | null,
  ) {
    const mk = (z: number, front: boolean): SVGSVGElement => {
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('data-vel-marks', front ? 'front' : 'back')
      svg.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;overflow:hidden;z-index:${z};`
      return svg
    }
    this.back = mk(0, false)
    this.front = mk(2, true)
    const host = frame.parentElement
    if (host) {
      frame.style.position = 'relative'
      frame.style.zIndex = '1'
      host.insertBefore(this.back, frame)
      host.appendChild(this.front)
    }
    this.fit()
  }

  /** Size the layers to the iframe (its width changes as chapters reflow). */
  private fit(): void {
    const w = this.frame.offsetWidth
    const h = this.frame.offsetHeight
    for (const svg of [this.back, this.front]) {
      svg.style.width = `${w}px`
      svg.style.height = `${h}px`
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
  }

  private mine(a: ReaderAnnotation): boolean {
    const idx = this.sectionOf(a.locator)
    return idx !== null && idx === this.contents.sectionIndex
  }

  /**
   * Bring the layer in line with `annotations`. `redraw` ids (or 'all', after a reflow) are re-measured; everything
   * else is left as it is, so adding one highlight does not touch the rest.
   */
  sync(annotations: ReadonlyMap<string, ReaderAnnotation>, colors: ReaderColors, redraw: ReadonlySet<string> | 'all' = new Set()): void {
    this.fit()
    for (const id of [...this.groups.keys()]) {
      const a = annotations.get(id)
      if (!a || !this.mine(a) || redraw === 'all' || redraw.has(id)) this.drop(id)
    }
    for (const a of annotations.values()) {
      if (this.groups.has(a.id) || !this.mine(a)) continue
      this.draw(a, colors)
    }
  }

  private drop(id: string): void {
    const g = this.groups.get(id)
    if (g) {
      g.back.remove()
      g.front.remove()
    }
    this.groups.delete(id)
    this.rects.delete(id)
  }

  private draw(a: ReaderAnnotation, colors: ReaderColors): void {
    let range: Range | null | undefined
    try {
      range = this.contents.range(a.locator)
    } catch {
      range = null
    }
    if (!range) return
    const raw = Array.from(range.getClientRects()).map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
    const rects = mergeLineRects(raw)
    if (!rects.length) return
    const fill = colors.highlights?.[a.color] ?? FALLBACK_FILLS[a.color]
    const stroke = fullStrength(fill)
    const back = el('g', { 'data-id': a.id })
    const front = el('g', { 'data-id': a.id })

    for (const r of rects) {
      if (a.style === 'highlight') {
        back.appendChild(el('rect', { x: r.left, y: r.top + 1, width: r.width, height: Math.max(1, r.height - 2), rx: 2.5, fill }))
      } else if (a.style === 'underline') {
        const y = underlineY(r)
        front.appendChild(el('line', { x1: r.left, x2: r.left + r.width, y1: y, y2: y, stroke, 'stroke-width': 2, 'stroke-linecap': 'round' }))
      } else if (a.style === 'strike') {
        const y = strikeY(r)
        front.appendChild(el('line', { x1: r.left, x2: r.left + r.width, y1: y, y2: y, stroke, 'stroke-width': 2, 'stroke-linecap': 'round' }))
      } else if (a.style === 'double') {
        const y = underlineY(r) - 0.5
        for (const dy of [0, 3]) {
          front.appendChild(el('line', { x1: r.left, x2: r.left + r.width, y1: y + dy, y2: y + dy, stroke, 'stroke-width': 1.3, 'stroke-linecap': 'round' }))
        }
      } else if (a.style === 'dotted' || a.style === 'dashed') {
        const y = underlineY(r)
        const dash = a.style === 'dotted' ? '0.1 4' : '6 4'
        front.appendChild(el('line', { x1: r.left, x2: r.left + r.width, y1: y, y2: y, stroke, 'stroke-width': a.style === 'dotted' ? 2.2 : 1.8, 'stroke-linecap': 'round', 'stroke-dasharray': dash }))
      } else if (a.style === 'sketch') {
        const y = underlineY(r) + 0.5
        const seed = seedOf(`${a.id}:${Math.round(r.top)}`)
        sketchPaths(r.left, y, r.width, seed).forEach((d, i) => {
          front.appendChild(el('path', { d, stroke, 'stroke-width': i === 0 ? 1.7 : 1.1, opacity: i === 0 ? 1 : 0.75, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
        })
      } else if (a.style === 'curly') {
        const y = underlineY(r) + 3
        front.appendChild(el('path', { d: curlyPath(r.left, y, r.width, 6), stroke, 'stroke-width': 1.2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
      } else {
        const y = underlineY(r) + 0.5
        front.appendChild(el('path', { d: squigglePath(r.left, y, r.width, 1.4, 5), stroke, 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
      }
    }
    if (a.hasNote) {
      const last = rects[rects.length - 1]!
      // A small dot raised above the end of the passage, like a footnote mark, so it never covers a glyph.
      const cx = last.left + last.width + 1
      const cy = last.top + 1
      front.appendChild(el('circle', { cx, cy, r: 4.5, fill: stroke, opacity: 0.95 }))
      front.appendChild(el('circle', { cx, cy, r: 1.5, fill: colors.background }))
    }
    this.back.appendChild(back)
    this.front.appendChild(front)
    this.groups.set(a.id, { back, front })
    this.rects.set(a.id, rects)
  }

  /** Id of the annotation under an iframe-space point, if any (the one drawn last wins). */
  hit(x: number, y: number): string | null {
    let found: string | null = null
    for (const [id, rects] of this.rects) if (pointInRects(x, y, rects)) found = id
    return found
  }

  /** Bounding box of an annotation in iframe space. */
  boundsOf(id: string): RectLike | null {
    const rects = this.rects.get(id)
    if (!rects?.length) return null
    const left = Math.min(...rects.map((r) => r.left))
    const top = Math.min(...rects.map((r) => r.top))
    const right = Math.max(...rects.map((r) => r.left + r.width))
    const bottom = Math.max(...rects.map((r) => r.top + r.height))
    return { left, top, width: right - left, height: bottom - top }
  }

  get ids(): string[] {
    return [...this.groups.keys()]
  }

  destroy(): void {
    this.back.remove()
    this.front.remove()
    this.groups.clear()
    this.rects.clear()
  }
}
