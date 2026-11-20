import { describe, expect, it } from 'vitest'
import { applyMatrix, clipHalfPlane, easeInOutCubic, flipGeometry, polygonCss, reflection, type Pt } from './pageFlip'

const area = (poly: Pt[]) => Math.abs(poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0)) / 2
const close = (a: Pt, b: Pt) => {
  expect(a.x).toBeCloseTo(b.x, 6)
  expect(a.y).toBeCloseTo(b.y, 6)
}

describe('pageFlip geometry', () => {
  const W = 600
  const H = 800

  it('lies flat at the start: nothing folded, the whole page kept', () => {
    const g = flipGeometry(W, H, 0)
    expect(g.flap).toEqual([])
    expect(area(g.keep)).toBeCloseTo(W * H)
    expect(g.lift).toBe(0)
  })

  it('splits the page into the flat part and the flap without losing paper', () => {
    for (const e of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      for (const corner of ['bottom', 'top'] as const) {
        const g = flipGeometry(W, H, e, corner)
        expect(area(g.keep) + area(g.flap)).toBeCloseTo(W * H, 3)
        expect(g.flap.length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('folds the turning corner onto the moving corner and keeps the fold line in place', () => {
    const g = flipGeometry(W, H, 0.3, 'bottom')
    close(applyMatrix(g.matrix, { x: W, y: H }), g.corner)
    // Points on the fold line are their own mirror image.
    const onFold = { x: g.fold.x - g.fold.ny * 120, y: g.fold.y + g.fold.nx * 120 }
    close(applyMatrix(g.matrix, onFold), onFold)
  })

  it('lifts the corner off its edge mid-turn and lands it past the spine', () => {
    const mid = flipGeometry(W, H, 0.5, 'bottom')
    expect(mid.corner.x).toBeCloseTo(0)
    expect(mid.corner.y).toBeLessThan(H)
    expect(mid.lift).toBeCloseTo(1)
    const top = flipGeometry(W, H, 0.5, 'top')
    expect(top.corner.y).toBeGreaterThan(0)
    const end = flipGeometry(W, H, 1)
    expect(end.keep.length).toBeLessThan(3)
    close(end.corner, { x: -W, y: H })
  })

  it('folds more paper as the turn goes on', () => {
    let last = 0
    for (const e of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const a = area(flipGeometry(W, H, e).flap)
      expect(a).toBeGreaterThan(last)
      last = a
    }
  })

  it('curls the outer corner first: the fold leans towards the spine at the bottom for a bottom corner', () => {
    const g = flipGeometry(W, H, 0.25, 'bottom')
    // Normal points down-right, so the fold line's top end sits further right than its bottom end.
    expect(g.fold.nx).toBeGreaterThan(0)
    expect(g.fold.ny).toBeGreaterThan(0)
  })

  it('clips a convex polygon by a half-plane', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(area(clipHalfPlane(sq, (p) => p.x - 4))).toBeCloseTo(40)
    expect(clipHalfPlane(sq, (p) => -p.x - 1)).toEqual(sq)
    expect(clipHalfPlane(sq, (p) => p.x + 1)).toEqual([])
  })

  it('reflects across a line with a unit normal', () => {
    const m = reflection({ x: 5, y: 0 }, 1, 0) // the line x = 5
    close(applyMatrix(m, { x: 7, y: 3 }), { x: 3, y: 3 })
  })

  it('writes clip-path polygons, with an empty one for nothing', () => {
    expect(polygonCss([])).toBe('polygon(0px 0px, 0px 0px, 0px 0px)')
    expect(polygonCss([{ x: 0, y: 0 }, { x: 1.234, y: 0 }, { x: 1, y: 1 }])).toBe('polygon(0px 0px, 1.23px 0px, 1px 1px)')
  })

  it('eases in and out symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1)
  })
})
