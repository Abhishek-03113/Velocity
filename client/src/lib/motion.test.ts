import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_DURATION_MS,
  TIER_MS,
  _setLastPointer,
  animate,
  clampDuration,
  easeOutBack,
  flipFrom,
  originWithin,
  recentPointer,
  reducedMotion,
  reversible,
  rubberBand,
  rubberBandClamp,
  setUserReducedMotion,
  staggerDelay,
  tierDuration,
  tween,
} from './motion'

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches }) })
}

afterEach(() => {
  setUserReducedMotion(false)
  delete (window as { matchMedia?: unknown }).matchMedia
  _setLastPointer(null)
  vi.restoreAllMocks()
})

describe('durations', () => {
  it('never exceeds the 300 ms ceiling', () => {
    expect(MAX_DURATION_MS).toBe(300)
    expect(clampDuration(1000)).toBe(300)
    expect(clampDuration(-5)).toBe(0)
    expect(clampDuration(Number.NaN)).toBe(0)
    for (const ms of Object.values(TIER_MS)) expect(ms).toBeLessThanOrEqual(300)
    expect(tierDuration('rare', 900)).toBe(300)
  })

  it('orders tiers by frequency of use', () => {
    expect(TIER_MS.hot).toBeLessThan(TIER_MS.warm)
    expect(TIER_MS.warm).toBeLessThan(TIER_MS.cool)
    expect(TIER_MS.cool).toBeLessThanOrEqual(TIER_MS.rare)
  })

  it('caps the stagger after the first items', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(2)).toBe(28)
    expect(staggerDelay(50)).toBe(staggerDelay(5))
  })
})

describe('rubberBand', () => {
  it('matches the documented curve', () => {
    expect(rubberBand(60, 80)).toBeCloseTo(23.36, 1)
    expect(rubberBand(160, 80)).toBeCloseTo(41.9, 1)
    expect(rubberBand(300, 80)).toBeCloseTo(53.9, 1)
  })

  it('is monotonic, sign-preserving and bounded by dim', () => {
    let prev = 0
    for (let x = 10; x < 5000; x += 50) {
      const y = rubberBand(x, 80)
      expect(y).toBeGreaterThan(prev)
      expect(y).toBeLessThan(80)
      prev = y
    }
    expect(rubberBand(-60, 80)).toBeCloseTo(-rubberBand(60, 80))
    expect(rubberBand(0, 80)).toBe(0)
    expect(rubberBand(10, 0)).toBe(0)
  })

  it('only stretches outside the bounds', () => {
    expect(rubberBandClamp(150, 100, 200, 80)).toBe(150)
    expect(rubberBandClamp(260, 100, 200, 80)).toBeCloseTo(200 + rubberBand(60, 80))
    expect(rubberBandClamp(40, 100, 200, 80)).toBeCloseTo(100 - rubberBand(60, 80))
  })
})

describe('origins', () => {
  const rect = { left: 100, top: 50, width: 200, height: 120 }

  it('expresses a point inside the rect', () => {
    expect(originWithin({ x: 130, y: 60 }, rect)).toEqual({ x: 30, y: 10 })
  })

  it('clamps points outside to the nearest edge (menu flipped up or left)', () => {
    expect(originWithin({ x: 400, y: 300 }, rect)).toEqual({ x: 200, y: 120 })
    expect(originWithin({ x: 0, y: 0 }, rect)).toEqual({ x: 0, y: 0 })
  })

  it('computes a FLIP from a button to a sheet', () => {
    const button = { left: 500, top: 10, width: 20, height: 20 }
    const sheet = { left: 200, top: 100, width: 400, height: 300 }
    const f = flipFrom(button, sheet)
    expect(f.dx).toBe(110)
    expect(f.dy).toBe(-230)
    expect(f.sx).toBeCloseTo(0.05)
  })

  it('forgets stale pointer presses (keyboard-opened overlays)', () => {
    _setLastPointer({ x: 5, y: 6, at: performance.now() })
    expect(recentPointer()).toEqual({ x: 5, y: 6 })
    _setLastPointer({ x: 5, y: 6, at: performance.now() - 5000 })
    expect(recentPointer()).toBeNull()
  })
})

describe('reduced motion', () => {
  function fakeEl() {
    const a = { onfinish: null, updatePlaybackRate: vi.fn(), play: vi.fn(), playState: 'running', effect: { updateTiming: vi.fn() } }
    return { el: { animate: vi.fn(() => a) } as unknown as Element, a }
  }

  it('honours the user preference', () => {
    setUserReducedMotion(true)
    expect(reducedMotion()).toBe(true)
    const { el } = fakeEl()
    expect(animate(el, [{ opacity: 0 }, { opacity: 1 }])).toBeNull()
    expect((el as unknown as { animate: ReturnType<typeof vi.fn> }).animate).not.toHaveBeenCalled()
  })

  it('honours the OS setting', () => {
    setMatchMedia(true)
    expect(reducedMotion()).toBe(true)
  })

  it('clamps durations passed to the browser', () => {
    setMatchMedia(false)
    const { el } = fakeEl()
    animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 2000 })
    const spy = (el as unknown as { animate: ReturnType<typeof vi.fn> }).animate
    expect(spy.mock.calls[0][1].duration).toBe(300)
  })

  it('a reversible entrance closes immediately when nothing animated', () => {
    setUserReducedMotion(true)
    const done = vi.fn()
    reversible(null, [{ opacity: 0 }, { opacity: 1 }]).reverse(done)
    expect(done).toHaveBeenCalledOnce()
  })

  it('a reversible entrance plays backwards from its current frame', () => {
    setMatchMedia(false)
    const { el, a } = fakeEl()
    const r = reversible(el, [{ opacity: 0 }, { opacity: 1 }])
    const done = vi.fn()
    r.reverse(done, 2)
    expect(a.updatePlaybackRate).toHaveBeenCalledWith(-2)
    ;(a.onfinish as unknown as () => void)()
    expect(done).toHaveBeenCalledOnce()
  })
})

describe('spring-back tween', () => {
  it('overshoots slightly and lands exactly on the target', () => {
    expect(easeOutBack(0)).toBeCloseTo(0)
    expect(easeOutBack(1)).toBeCloseTo(1)
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 50)))
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.1)
  })

  it('jumps to the end under reduced motion', () => {
    setUserReducedMotion(true)
    const frames: number[] = []
    const done = vi.fn()
    tween(400, 360, (v) => frames.push(v), { onDone: done })
    expect(frames).toEqual([360])
    expect(done).toHaveBeenCalledOnce()
  })
})
