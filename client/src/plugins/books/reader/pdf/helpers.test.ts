import { describe, expect, it } from 'vitest'
import {
  chapterForPage,
  cleanInfoString,
  clampZoom,
  computeLayout,
  currentPage,
  fitPageScale,
  fitWidthScale,
  flattenOutline,
  comparePosition,
  formatPage,
  formatPosition,
  parsePdfPosition,
  roundFrac,
  pageBlend,
  pageFilter,
  parsePosition,
  progressAt,
  renderWindow,
  resolveScale,
  scrollTopForProgress,
} from './helpers'

const sizes = Array.from({ length: 10 }, () => ({ width: 600, height: 800 }))

describe('positions', () => {
  it('parses page:N and page:N@f', () => {
    expect(parsePosition('page:12')).toBe(12)
    expect(parsePosition('page:12@0.35')).toBe(12)
    expect(parsePdfPosition('page:9@0.4')).toEqual({ page: 9, frac: 0.4 })
    expect(parsePdfPosition('page:9')).toEqual({ page: 9, frac: 0 })
    expect(parsePdfPosition('page:9@.5')).toEqual({ page: 9, frac: 0.5 })
    expect(parsePdfPosition('page:9@1.7')).toEqual({ page: 9, frac: 1 })
    expect(parsePdfPosition('page:9@0.123')).toEqual({ page: 9, frac: 0.12 })
    expect(parsePosition('page:0')).toBeNull()
    expect(parsePosition('page:3@')).toBeNull()
    expect(parsePosition('page:3@-1')).toBeNull()
    expect(parsePosition('page:x')).toBeNull()
    expect(parsePosition('epubcfi(/6/4)')).toBeNull()
    expect(parsePosition(null)).toBeNull()
  })
  it('formats page:N@f with two decimals', () => {
    expect(formatPosition(7)).toBe('page:7@0')
    expect(formatPosition(9, 0.4)).toBe('page:9@0.4')
    expect(formatPosition(9, 0.3333)).toBe('page:9@0.33')
    expect(formatPosition(9, 2)).toBe('page:9@1')
    expect(formatPosition(0, -1)).toBe('page:1@0')
    expect(formatPage(5)).toBe('page:5')
    expect(roundFrac(NaN)).toBe(0)
  })
  it('round-trips and compares', () => {
    expect(parsePdfPosition(formatPosition(12, 0.35))).toEqual({ page: 12, frac: 0.35 })
    expect(comparePosition({ page: 2, frac: 0.9 }, { page: 3, frac: 0 })).toBeLessThan(0)
    expect(comparePosition({ page: 3, frac: 0.2 }, { page: 3, frac: 0.2001 })).toBe(0)
    expect(comparePosition({ page: 3, frac: 0.5 }, { page: 3, frac: 0.2 })).toBeGreaterThan(0)
  })
})

describe('zoom', () => {
  it('clamps numeric zoom', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(9)).toBe(4)
    expect(clampZoom(1.5)).toBe(1.5)
    expect(clampZoom(NaN)).toBe(1)
  })
  it('fits width and page minus padding', () => {
    const page = { width: 600, height: 800 }
    const box = { width: 632, height: 400 }
    expect(fitWidthScale(page, box)).toBeCloseTo(1)
    expect(fitPageScale(page, box)).toBeCloseTo(368 / 800)
    expect(resolveScale('fit-width', page, box)).toBeCloseTo(1)
    expect(resolveScale(10, page, box)).toBe(4)
  })
})

describe('layout', () => {
  const layout = computeLayout(sizes, 1)
  it('stacks pages with gap and padding', () => {
    expect(layout.tops[0]).toBe(16)
    expect(layout.tops[1]).toBe(16 + 800 + 16)
    expect(layout.total).toBe(16 + 10 * 800 + 9 * 16 + 16)
  })
  it('renders visible pages plus two on each side', () => {
    expect(renderWindow(layout, 0, 900)).toEqual([0, 3])
    expect(renderWindow(layout, layout.tops[5], 800)).toEqual([3, 7])
    expect(renderWindow(layout, layout.total, 900)[1]).toBe(9)
    expect(renderWindow(computeLayout([], 1), 0, 100)).toEqual([0, -1])
  })
  it('picks the current page at 35% of the viewport', () => {
    expect(currentPage(layout, 0, 900)).toBe(1)
    expect(currentPage(layout, layout.tops[3], 900)).toBe(4)
    expect(currentPage(layout, 400, 900)).toBe(1)
    expect(currentPage(layout, 600, 900)).toBe(2)
  })
})

describe('progress', () => {
  const layout = computeLayout(sizes, 1)
  it('is exact at page tops and 1 at the bottom', () => {
    expect(progressAt(layout, 1, 0, 900)).toBe(0)
    expect(progressAt(layout, 5, layout.tops[4], 900)).toBeCloseTo(0.4)
    expect(progressAt(layout, 10, layout.total - 900, 900)).toBe(1)
  })
  it('round-trips through scrollTopForProgress', () => {
    const top = scrollTopForProgress(layout, 0.55, 900)
    expect(progressAt(layout, currentPage(layout, top, 900), top, 900)).toBeCloseTo(0.55)
    expect(scrollTopForProgress(layout, 1, 900)).toBe(layout.total - 900)
  })
})

describe('pageFilter', () => {
  it('inverts dark with a warm ink, leaves light stocks to the multiply blend', () => {
    expect(pageFilter({ dark: true })).toContain('invert')
    expect(pageFilter({ dark: true })).toContain('sepia')
    expect(pageFilter({ dark: false })).toBe('none')
    expect(pageBlend({ dark: false })).toBe('multiply')
    expect(pageBlend({ dark: true })).toBe('lighten')
  })
})

describe('outline', () => {
  const pages: Record<string, number> = { a: 1, b: 5, c: 9 }
  const resolve = async (dest: unknown) => (typeof dest === 'string' ? (pages[dest] ?? null) : null)
  it('flattens in order, drops unresolvable, nests levels', async () => {
    const toc = await flattenOutline(
      [
        { title: 'Part I', dest: 'a', items: [{ title: 'Ch  1', dest: 'b' }, { title: 'Broken', dest: 'zzz' }] },
        { title: 'Part II', dest: 'c' },
        { title: 'No dest', dest: null },
      ],
      resolve,
    )
    expect(toc.map((t) => [t.label, t.target, t.level])).toEqual([
      ['Part I', 'page:1', 0],
      ['Ch 1', 'page:5', 1],
      ['Part II', 'page:9', 0],
    ])
    expect(new Set(toc.map((t) => t.id)).size).toBe(3)
  })
  it('finds the chapter for a page', () => {
    const toc = [
      { id: '0', label: 'A', target: 'page:1', level: 0 },
      { id: '1', label: 'B', target: 'page:5', level: 0 },
    ]
    expect(chapterForPage(toc, 4)).toBe('A')
    expect(chapterForPage(toc, 5)).toBe('B')
    expect(chapterForPage([], 3)).toBeNull()
  })
})

describe('cleanInfoString', () => {
  it('ignores junk', () => {
    expect(cleanInfoString('  Dune ')).toBe('Dune')
    expect(cleanInfoString('')).toBeNull()
    expect(cleanInfoString('Untitled')).toBeNull()
    expect(cleanInfoString('paper.dvi')).toBeNull()
    expect(cleanInfoString(undefined)).toBeNull()
  })
})
