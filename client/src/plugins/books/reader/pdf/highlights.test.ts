import { describe, expect, it } from 'vitest'
import {
  formatLocator,
  hitRect,
  isPdfLocator,
  mergeLineRects,
  normaliseRect,
  parseLocator,
  rectsBounds,
  selectionRects,
  solidColor,
  squiggleImage,
  type Rect,
} from './highlights'

describe('locators', () => {
  it('formats and parses pdf: locators', () => {
    const rects: Rect[] = [[0.1, 0.2, 0.5, 0.02], [0.1, 0.22, 0.3, 0.02]]
    const loc = formatLocator(12, rects)
    expect(loc).toBe('pdf:{"page":12,"rects":[[0.1,0.2,0.5,0.02],[0.1,0.22,0.3,0.02]]}')
    expect(isPdfLocator(loc)).toBe(true)
    expect(parseLocator(loc)).toEqual({ page: 12, rects })
  })
  it('rejects anything else', () => {
    expect(parseLocator(null)).toBeNull()
    expect(parseLocator('epubcfi(/6/4)')).toBeNull()
    expect(parseLocator('pdf:not json')).toBeNull()
    expect(parseLocator('pdf:{"page":0,"rects":[]}')).toBeNull()
    expect(parseLocator('pdf:{"page":1,"rects":[[1,2,3]]}')).toBeNull()
    expect(parseLocator('pdf:{"page":1,"rects":[["a",2,3,4]]}')).toBeNull()
    expect(parseLocator('pdf:{"page":1}')).toBeNull()
  })
})

describe('rect normalisation', () => {
  const box = { left: 100, top: 50, width: 400, height: 600 }
  it('maps viewport rects into 0..1 of the page box', () => {
    expect(normaliseRect({ left: 200, top: 350, width: 100, height: 30 }, box)).toEqual([0.25, 0.5, 0.25, 0.05])
  })
  it('clamps rects that stick out', () => {
    expect(normaliseRect({ left: 50, top: 40, width: 600, height: 20 }, box)).toEqual([0, 0, 1, 0.0167])
  })
})

describe('mergeLineRects', () => {
  it('unites word rects on one line', () => {
    const merged = mergeLineRects([
      [0.1, 0.2, 0.1, 0.02],
      [0.21, 0.2, 0.1, 0.02],
      [0.32, 0.201, 0.1, 0.02],
    ])
    expect(merged).toEqual([[0.1, 0.2, 0.32, 0.021]])
  })
  it('keeps separate lines and orders them top to bottom', () => {
    const merged = mergeLineRects([
      [0.1, 0.3, 0.4, 0.02],
      [0.1, 0.2, 0.5, 0.02],
    ])
    expect(merged).toEqual([
      [0.1, 0.2, 0.5, 0.02],
      [0.1, 0.3, 0.4, 0.02],
    ])
  })
  it('does not bridge a wide gap (columns)', () => {
    const merged = mergeLineRects([
      [0.05, 0.2, 0.3, 0.02],
      [0.55, 0.2, 0.3, 0.02],
    ])
    expect(merged).toHaveLength(2)
  })
  it('drops rects contained in another and degenerate ones', () => {
    const merged = mergeLineRects([
      [0.1, 0.2, 0.5, 0.02],
      [0.2, 0.2, 0.1, 0.02],
      [0.3, 0.3, 0, 0.02],
    ])
    expect(merged).toEqual([[0.1, 0.2, 0.5, 0.02]])
  })
  it('drops exact duplicates once', () => {
    expect(mergeLineRects([[0.1, 0.2, 0.5, 0.02], [0.1, 0.2, 0.5, 0.02]])).toEqual([[0.1, 0.2, 0.5, 0.02]])
  })
  it('handles empty input', () => {
    expect(mergeLineRects([])).toEqual([])
  })
})

describe('selectionRects', () => {
  const box = { left: 0, top: 0, width: 1000, height: 1000 }
  it('keeps rects inside the page, merges per line and ignores tiny or foreign ones', () => {
    const rects = selectionRects(
      [
        { left: 100, top: 100, width: 100, height: 20 },
        { left: 205, top: 100, width: 100, height: 20 },
        { left: 100, top: 140, width: 50, height: 20 },
        { left: 100, top: 1500, width: 50, height: 20 },
        { left: 100, top: 100, width: 0, height: 20 },
      ],
      box,
    )
    expect(rects).toEqual([
      [0.1, 0.1, 0.205, 0.02],
      [0.1, 0.14, 0.05, 0.02],
    ])
  })
  it('returns nothing for an empty box', () => {
    expect(selectionRects([{ left: 1, top: 1, width: 5, height: 5 }], { left: 0, top: 0, width: 0, height: 0 })).toEqual([])
  })
})

describe('hit testing and bounds', () => {
  const rects: Rect[] = [[0.1, 0.2, 0.5, 0.02], [0.1, 0.22, 0.3, 0.02]]
  it('finds the rect under a point', () => {
    expect(hitRect(rects, 0.3, 0.21)).toBe(0)
    expect(hitRect(rects, 0.2, 0.23)).toBe(1)
    expect(hitRect(rects, 0.9, 0.9)).toBe(-1)
  })
  it('bounds several rects', () => {
    const b = rectsBounds(rects)
    expect(b[0]).toBeCloseTo(0.1)
    expect(b[1]).toBeCloseTo(0.2)
    expect(b[2]).toBeCloseTo(0.5)
    expect(b[3]).toBeCloseTo(0.04)
    expect(rectsBounds([])).toEqual([0, 0, 0, 0])
  })
})

describe('colours', () => {
  it('drops alpha for line styles', () => {
    expect(solidColor('rgba(255, 214, 10, 0.4)')).toBe('rgb(255, 214, 10)')
    expect(solidColor('#ffd60a80')).toBe('#ffd60a')
    expect(solidColor('hsla(40, 90%, 50%, 0.3)')).toBe('hsl(40, 90%, 50%)')
    expect(solidColor('oklch(0.8 0.1 90)')).toBe('oklch(0.8 0.1 90)')
  })
  it('builds a tiling squiggle', () => {
    expect(squiggleImage('rgb(1, 2, 3)')).toMatch(/^url\("data:image\/svg\+xml,%3Csvg/)
  })
})
