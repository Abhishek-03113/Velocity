/**
 * Velocity's motion layer. One place for durations, easings and the small
 * physics helpers (rubber banding, pointer origins, reversible animations).
 *
 * Rules (see docs/motion.md):
 * - Frequency of use sets the tier: the more often something happens, the less it moves.
 * - Nothing runs longer than MAX_DURATION_MS (300 ms).
 * - Only transform and opacity are animated, after state has committed, so input never waits.
 * - Reduced motion (OS setting or the "Reduce interface motion" preference) skips every animation.
 */

export type MotionTier = 'hot' | 'warm' | 'cool' | 'rare'

/** Hard ceiling for any UI animation. */
export const MAX_DURATION_MS = 300

/** Default duration per tier, in ms. Hot paths (typing, tab switch, results) barely move. */
export const TIER_MS: Record<MotionTier, number> = {
  hot: 90,
  warm: 160,
  cool: 240,
  rare: 300,
}

/** Same curves as the --ease-* tokens in styles/tokens.css. */
export const EASE = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  spring: 'cubic-bezier(0.32, 0.72, 0, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const

/** Clamp a duration into [0, MAX_DURATION_MS]. */
export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0
  return Math.min(MAX_DURATION_MS, ms)
}

/** Duration for a tier, optionally overridden, always clamped to the ceiling. */
export function tierDuration(tier: MotionTier, override?: number): number {
  return clampDuration(override ?? TIER_MS[tier])
}

/** Delay for the i-th item of a staggered entrance; only the first `cap` items are staggered. */
export function staggerDelay(index: number, step = 14, cap = 5): number {
  return Math.max(0, Math.min(index, cap)) * step
}

/**
 * Distance actually drawn for `over` px of pointer travel past a limit.
 * dim · (1 − 1 / (c · over / dim + 1)): linear-ish at first, approaching `dim`.
 * Sign-preserving, so it works on either side of a limit.
 */
export function rubberBand(over: number, dim: number, c = 0.55): number {
  if (!Number.isFinite(over) || over === 0 || dim <= 0) return 0
  const sign = over < 0 ? -1 : 1
  const x = Math.abs(over)
  return sign * dim * (1 - 1 / ((c * x) / dim + 1))
}

/** A raw value held inside [min, max] with rubber banding past either end. */
export function rubberBandClamp(value: number, min: number, max: number, dim: number): number {
  if (value > max) return max + rubberBand(value - max, dim)
  if (value < min) return min + rubberBand(value - min, dim)
  return value
}

export interface Point {
  x: number
  y: number
}

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/** A point expressed relative to a rect, clamped inside it — ready for transform-origin. */
export function originWithin(point: Point, rect: RectLike): Point {
  return {
    x: Math.round(Math.min(rect.width, Math.max(0, point.x - rect.left))),
    y: Math.round(Math.min(rect.height, Math.max(0, point.y - rect.top))),
  }
}

export function originCss(p: Point): string {
  return `${p.x}px ${p.y}px`
}

/** Translate + scale that maps `to` onto `from` (FLIP "invert" from a rect to another). */
export function flipFrom(from: RectLike, to: RectLike): { dx: number; dy: number; sx: number; sy: number } {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  const sx = to.width > 0 ? from.width / to.width : 1
  const sy = to.height > 0 ? from.height / to.height : 1
  return { dx, dy, sx, sy }
}

// ---- Reduced motion ---------------------------------------------------------

let userReducedMotion = false

/** Set by the preferences store ("Reduce interface motion"). */
export function setUserReducedMotion(on: boolean): void {
  userReducedMotion = on
}

/** True when either the OS or the user's preference asks for reduced motion. */
export function reducedMotion(): boolean {
  if (userReducedMotion) return true
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ---- Pointer origin ------------------------------------------------------------

let lastPointer: (Point & { at: number }) | null = null
let tracking = false

/** Remember where the last pointer press happened (capture phase, passive). Idempotent. */
export function trackPointerOrigins(): void {
  if (tracking || typeof window === 'undefined') return
  tracking = true
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY, at: performance.now() }
    },
    { capture: true, passive: true },
  )
  // A key press means the next overlay was opened from the keyboard, not by the pointer.
  window.addEventListener('keydown', () => {
    lastPointer = null
  }, { capture: true, passive: true })
}

/** The last pointer press if it happened within `maxAgeMs`, else null (keyboard-opened). */
export function recentPointer(maxAgeMs = 800): Point | null {
  if (!lastPointer) return null
  if (performance.now() - lastPointer.at > maxAgeMs) return null
  return { x: lastPointer.x, y: lastPointer.y }
}

/** Test hook. */
export function _setLastPointer(p: (Point & { at: number }) | null): void {
  lastPointer = p
}

// ---- Animations ------------------------------------------------------------------

export interface MotionOptions {
  tier?: MotionTier
  duration?: number
  delay?: number
  easing?: string
  fill?: FillMode
}

function canAnimate(el: Element | null | undefined): el is Element {
  return !!el && typeof (el as HTMLElement).animate === 'function' && !reducedMotion()
}

/**
 * Run a Web Animation with a clamped duration. Returns null (and does nothing)
 * under reduced motion or where WAAPI is missing (jsdom).
 */
export function animate(el: Element | null | undefined, keyframes: Keyframe[], opts: MotionOptions = {}): Animation | null {
  if (!canAnimate(el)) return null
  const duration = opts.duration != null ? clampDuration(opts.duration) : tierDuration(opts.tier ?? 'warm')
  return el.animate(keyframes, {
    duration,
    delay: clampDuration(opts.delay ?? 0),
    easing: opts.easing ?? EASE.out,
    fill: opts.fill ?? 'none',
  })
}

export interface Reversible {
  animation: Animation | null
  /** Play back to the start from wherever it is now, then call `done`. */
  reverse: (done: () => void, speed?: number) => void
}

/**
 * An entrance that can be called back mid-flight: closing plays the same
 * animation backwards from its current frame instead of snapping.
 */
export function reversible(el: Element | null | undefined, keyframes: Keyframe[], opts: MotionOptions = {}): Reversible {
  const animation = animate(el, keyframes, { fill: 'both', ...opts })
  let reversing = false
  return {
    animation,
    reverse: (done, speed = 1.5) => {
      if (!animation || reversing) {
        if (!animation) done()
        return
      }
      reversing = true
      if (opts.easing !== EASE.inOut) animation.effect?.updateTiming({ easing: EASE.inOut })
      animation.onfinish = () => done()
      animation.oncancel = () => done()
      animation.updatePlaybackRate(-Math.abs(speed))
      if (animation.playState === 'finished' || animation.playState === 'idle') animation.play()
    },
  }
}

/**
 * FLIP siblings: call `measure()` before a DOM change and the returned function after it.
 * Each element that moved animates from its old position (transform only).
 */
export function flipList(
  elements: Iterable<HTMLElement>,
  opts: MotionOptions & { stagger?: number; overshoot?: number } = {},
): () => void {
  const before = new Map<HTMLElement, DOMRect>()
  for (const el of elements) before.set(el, el.getBoundingClientRect())
  return () => {
    if (reducedMotion()) return
    let i = 0
    for (const [el, old] of before) {
      if (!el.isConnected) continue
      const now = el.getBoundingClientRect()
      const dx = old.left - now.left
      const dy = old.top - now.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      const o = opts.overshoot ?? 0
      const frames: Keyframe[] = [{ transform: `translate(${dx}px, ${dy}px)` }]
      if (o) frames.push({ transform: `translate(${-Math.sign(dx) * o}px, ${-Math.sign(dy) * o}px)`, offset: 0.75 })
      frames.push({ transform: 'translate(0, 0)' })
      animate(el, frames, { tier: opts.tier ?? 'warm', duration: opts.duration, easing: opts.easing ?? EASE.out, delay: (opts.stagger ?? 0) * i, fill: 'backwards' })
      i++
    }
  }
}

/** Press feedback: sink on pointerdown, spring back on release or slide-off. */
export function pressIn(el: HTMLElement): Animation | null {
  return animate(el, [{ transform: 'scale(1)' }, { transform: 'scale(0.96)' }], { duration: 70, easing: EASE.out, fill: 'forwards' })
}

export function pressOut(el: HTMLElement, from: Animation | null): void {
  from?.cancel()
  animate(el, [{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: 220, easing: EASE.overshoot })
}

/** Ease-out with a small overshoot past 1 (spring-backs after a stretch). */
export function easeOutBack(t: number, s = 1.2): number {
  const u = t - 1
  return 1 + (s + 1) * u * u * u + s * u * u
}

/**
 * Tween a number with requestAnimationFrame, for values WAAPI cannot animate
 * (a CSS variable that drives layout). Returns a cancel function. Under reduced
 * motion it jumps straight to the end.
 */
export function tween(
  from: number,
  to: number,
  onFrame: (value: number) => void,
  opts: { duration?: number; ease?: (t: number) => number; onDone?: () => void } = {},
): () => void {
  const duration = clampDuration(opts.duration ?? TIER_MS.cool)
  if (reducedMotion() || duration === 0 || from === to || typeof requestAnimationFrame !== 'function') {
    onFrame(to)
    opts.onDone?.()
    return () => {}
  }
  const ease = opts.ease ?? easeOutBack
  const start = performance.now()
  let raf = 0
  let cancelled = false
  const step = (now: number) => {
    if (cancelled) return
    const t = Math.min(1, (now - start) / duration)
    onFrame(from + (to - from) * ease(t))
    if (t < 1) raf = requestAnimationFrame(step)
    else opts.onDone?.()
  }
  raf = requestAnimationFrame(step)
  return () => {
    cancelled = true
    cancelAnimationFrame(raf)
  }
}

let pressInstalled = false

/**
 * Press feedback for every `[data-press]` element, from one capture listener:
 * it sinks on pointerdown (same frame, well inside the Doherty threshold) and
 * springs back on release, or when the pointer slides off (the click is then
 * cancelled by the browser, so the press can be taken back).
 */
export function installPressFeedback(): void {
  if (pressInstalled || typeof window === 'undefined') return
  pressInstalled = true
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-press]')
      if (!el || (el as HTMLButtonElement).disabled) return
      const sink = pressIn(el)
      if (!sink) return
      const release = () => {
        el.removeEventListener('pointerup', release)
        el.removeEventListener('pointerleave', release)
        el.removeEventListener('pointercancel', release)
        pressOut(el, sink)
      }
      el.addEventListener('pointerup', release)
      el.addEventListener('pointerleave', release)
      el.addEventListener('pointercancel', release)
    },
    { capture: true, passive: true },
  )
}
