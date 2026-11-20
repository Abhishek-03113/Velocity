/**
 * The Curl page turn: a hand-built page flip (in the spirit of StPageFlip / react-pageflip, no dependency).
 *
 * The turning page is a flat sheet folded along a straight line. Its free corner travels from the page's outer
 * corner to the far side of the spine, lifting a little on the way, and the fold line is the perpendicular bisector
 * of the segment between where the corner started and where it is now. So:
 *
 *  - the part of the sheet on the spine side of the fold still lies flat (`keep`: the leaf is clipped to it),
 *  - the part beyond the fold is the flap (`flap`): it is mirrored across the fold, so its back shows,
 *  - the page underneath shows through where the flap used to lie.
 *
 * Shading sells the bend: a crease shadow and a soft sheen on the back of the flap, a drop shadow from the lifted
 * flap onto the leaf, and a shadow cast along the fold onto the page being revealed.
 *
 * `flipGeometry` is pure (unit-tested); `playPageFlip` drives it on the DOM with requestAnimationFrame, writing only
 * `clip-path` and `transform`, and always leaves the DOM as it found it.
 */

export interface Pt {
  x: number
  y: number
}

export type FlipCorner = 'top' | 'bottom'

/** CSS `matrix(a, b, c, d, e, f)`. */
export type Matrix = [number, number, number, number, number, number]

export interface FlipGeometry {
  /** How far through the flip, 0 (flat on the page) to 1 (turned over past the spine). */
  progress: number
  /** 0 when the sheet lies flat at either end, 1 at the middle of the turn: drives the shadows. */
  lift: number
  /** Where the folding corner is now (page coordinates). */
  corner: Pt
  /** The part of the sheet still lying flat, as a convex polygon (page coordinates). Empty once fully turned. */
  keep: Pt[]
  /** The folded part, in page coordinates *before* it is mirrored. Empty while the sheet is flat. */
  flap: Pt[]
  /** Maps page coordinates onto the flap's place on screen: the reflection across the fold line. */
  matrix: Matrix
  /** A point on the fold line and its unit normal, pointing into the folded part (towards the starting corner). */
  fold: { x: number; y: number; nx: number; ny: number }
  /** Largest distance from the fold line to the flap (0 when nothing is folded). */
  depth: number
}

/** How high the corner rises above its edge at the middle of the turn, as a share of the page height. */
export const FLIP_LIFT = 0.14
/** Duration of one page flip. */
export const FLIP_MS = 640

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** Sutherland–Hodgman: the part of a convex polygon where `side(p) <= 0`. */
export function clipHalfPlane(poly: Pt[], side: (p: Pt) => number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const sa = side(a)
    const sb = side(b)
    if (sa <= 0) out.push(a)
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

/** The reflection across the line through `m` with unit normal `n`, as a CSS matrix. */
export function reflection(m: Pt, nx: number, ny: number): Matrix {
  const k = 2 * (m.x * nx + m.y * ny)
  return [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny, k * nx, k * ny]
}

export function applyMatrix(mx: Matrix, p: Pt): Pt {
  return { x: mx[0] * p.x + mx[2] * p.y + mx[4], y: mx[1] * p.x + mx[3] * p.y + mx[5] }
}

/**
 * The fold for a page of `w` × `h` at `progress` (0..1, already eased). The sheet hinges on its left edge (the
 * spine) and is turned by its right-hand `corner`.
 */
export function flipGeometry(w: number, h: number, progress: number, corner: FlipCorner = 'bottom'): FlipGeometry {
  const e = Math.min(1, Math.max(0, progress))
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  const start: Pt = { x: w, y: corner === 'bottom' ? h : 0 }
  const lift = Math.sin(Math.PI * e)
  const rise = FLIP_LIFT * h * lift
  const at: Pt = { x: w - 2 * w * e, y: corner === 'bottom' ? h - rise : rise }
  const dx = start.x - at.x
  const dy = start.y - at.y
  const len = Math.hypot(dx, dy)
  if (len < 0.5 || w <= 0 || h <= 0) {
    return { progress: e, lift, corner: at, keep: rect, flap: [], matrix: IDENTITY, fold: { x: w, y: start.y, nx: 1, ny: 0 }, depth: 0 }
  }
  const nx = dx / len
  const ny = dy / len
  const m: Pt = { x: (start.x + at.x) / 2, y: (start.y + at.y) / 2 }
  const side = (p: Pt) => (p.x - m.x) * nx + (p.y - m.y) * ny
  const keep = clipHalfPlane(rect, side)
  const flap = clipHalfPlane(rect, (p) => -side(p))
  const depth = flap.reduce((d, p) => Math.max(d, side(p)), 0)
  return { progress: e, lift, corner: at, keep, flap, matrix: reflection(m, nx, ny), fold: { x: m.x, y: m.y, nx, ny }, depth }
}

/** A CSS `polygon()` for `clip-path`; an empty polygon clips everything away. */
export function polygonCss(pts: Pt[]): string {
  if (pts.length < 3) return 'polygon(0px 0px, 0px 0px, 0px 0px)'
  return `polygon(${pts.map((p) => `${round(p.x)}px ${round(p.y)}px`).join(', ')})`
}

const round = (n: number) => Math.round(n * 100) / 100

/** Places a band whose local x axis starts on the fold line and runs along its normal (into the folded side). */
function bandTransform(g: FlipGeometry, span: number): string {
  const angle = Math.atan2(g.fold.ny, g.fold.nx)
  return `translate(${round(g.fold.x)}px, ${round(g.fold.y)}px) rotate(${round((angle * 180) / Math.PI)}deg) translate(0px, ${round(-span)}px)`
}

export interface PageFlipOptions {
  /** The sheet that turns. It is clipped to the part still lying flat; its box is the page (0,0)–(width,height). */
  leaf: HTMLElement
  /** An element laid exactly over the page and stacked above the leaf: the flap and shadows are drawn in it. */
  host: HTMLElement
  width: number
  height: number
  /** next: the leaf is the page being turned away. prev: the leaf is the page coming back, unfolding over the old one. */
  dir: 'next' | 'prev'
  paper: { color: string; image?: string | null; dark: boolean }
  corner?: FlipCorner
  duration?: number
}

export interface PageFlip {
  done: Promise<void>
  cancel(): void
}

/** Run one page flip on the DOM. */
export function playPageFlip(o: PageFlipOptions): PageFlip {
  const { leaf, host, width: w, height: h, dir, paper } = o
  const duration = Math.max(1, o.duration ?? FLIP_MS)
  const corner = o.corner ?? 'bottom'
  const span = Math.hypot(w, h)

  // Shadow cast on the page being revealed, clipped to the page.
  const castClip = document.createElement('div')
  castClip.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;'
  const cast = document.createElement('div')
  cast.style.cssText = `position:absolute;left:0;top:0;width:${round(span)}px;height:${round(span * 2)}px;transform-origin:0 0;will-change:transform;`
  castClip.appendChild(cast)

  // The flap: a sheet of paper mirrored onto the leaf, with a drop shadow on whatever is beneath it.
  const flapWrap = document.createElement('div')
  flapWrap.style.cssText = `position:absolute;inset:0;pointer-events:none;filter:drop-shadow(0 1px 6px rgba(0,0,0,${paper.dark ? 0.55 : 0.3}));`
  const flap = document.createElement('div')
  flap.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;overflow:hidden;will-change:transform,clip-path;` +
    `background-color:${paper.color};${paper.image ? `background-image:${paper.image};` : ''}`
  // The back of a sheet sits a touch darker than its front.
  const back = document.createElement('div')
  back.style.cssText = `position:absolute;inset:0;background:rgba(0,0,0,${paper.dark ? 0.1 : 0.035});`
  const crease = document.createElement('div')
  crease.style.cssText = `position:absolute;left:0;top:0;width:${round(span)}px;height:${round(span * 2)}px;transform-origin:0 0;will-change:transform;`
  flap.append(back, crease)
  flapWrap.appendChild(flap)
  host.append(castClip, flapWrap)

  const prevClip = leaf.style.clipPath
  const prevWill = leaf.style.willChange
  leaf.style.willChange = 'clip-path'
  // Sheen on the curve of the flap: kept faint on dark paper so a turn never flashes light.
  const sheen = paper.dark ? 0.045 : 0.22

  const apply = (t: number) => {
    const eased = easeInOutCubic(t)
    const g = flipGeometry(w, h, dir === 'next' ? eased : 1 - eased, corner)
    leaf.style.clipPath = polygonCss(g.keep)
    if (g.flap.length < 3) {
      flapWrap.style.visibility = 'hidden'
      castClip.style.visibility = 'hidden'
      return
    }
    flapWrap.style.visibility = ''
    castClip.style.visibility = ''
    // Off the page at the very end (next) or start (prev) the sheet fades instead of popping.
    flapWrap.style.opacity = String(Math.min(1, (1 - g.progress) * 10))
    flap.style.transform = `matrix(${g.matrix.map(round).join(',')})`
    flap.style.clipPath = polygonCss(g.flap)
    const d = Math.max(1, g.depth)
    const k = g.lift
    crease.style.transform = bandTransform(g, span)
    crease.style.background =
      `linear-gradient(90deg, rgba(0,0,0,${round(0.26 * k + 0.04)}) 0px, rgba(0,0,0,${round(0.08 * k)}) ${round(d * 0.12)}px, ` +
      `rgba(255,255,255,${round(sheen * k)}) ${round(d * 0.38)}px, rgba(0,0,0,0) ${round(d * 0.7)}px, rgba(0,0,0,${round(0.08 * k)}) ${round(d)}px)`
    const reach = Math.max(8, Math.min(w, h) * 0.2 * (0.35 + 0.65 * k))
    const strength = (paper.dark ? 0.6 : 0.34) * k
    cast.style.transform = bandTransform(g, span)
    cast.style.background =
      `linear-gradient(90deg, rgba(0,0,0,${round(strength)}) 0px, rgba(0,0,0,${round(strength * 0.35)}) ${round(reach * 0.3)}px, rgba(0,0,0,0) ${round(reach)}px)`
  }

  let raf = 0
  let timer = 0
  let finished = false
  let resolve: () => void = () => undefined
  const done = new Promise<void>((r) => (resolve = r))
  const finish = () => {
    if (finished) return
    finished = true
    cancelAnimationFrame(raf)
    window.clearTimeout(timer)
    castClip.remove()
    flapWrap.remove()
    leaf.style.clipPath = prevClip
    leaf.style.willChange = prevWill
    resolve()
  }

  apply(0) // the first painted frame already shows the fold, so nothing flashes between the setup and the first tick
  const startAt = performance.now()
  const tick = (now: number) => {
    if (finished) return
    const t = Math.min(1, (now - startAt) / duration)
    apply(t)
    if (t >= 1) finish()
    else raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  // A hidden tab stops animation frames: never leave a turn hanging.
  timer = window.setTimeout(finish, duration + 400)
  return { done, cancel: finish }
}
