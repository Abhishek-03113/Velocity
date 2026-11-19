import { describe, expect, it } from 'vitest'
import { statusParts } from '../labels'
import type { ReaderLocation } from '../reader/types'
import type { BookAnnotation } from '../types'
import { bookmarksHere, byPosition } from './bookmarks'
import { FALLBACK_DEFAULTS, loadHighlightDefaults, saveHighlightDefaults } from './highlightDefaults'
import { placeToolbar } from './placement'

const bm = (over: Partial<BookAnnotation>): BookAnnotation => ({
  id: 1,
  book_id: 1,
  kind: 'bookmark',
  locator: 'cfi-a',
  text: null,
  note: null,
  color: null,
  style: null,
  chapter: 'Chapter 2',
  progress: 0.2,
  page: null,
  created_at: '2026-11-19 10:00:00',
  updated_at: '2026-11-19 10:00:00',
  ...over,
})
const loc = (over: Partial<ReaderLocation>): ReaderLocation => ({
  position: 'cfi-a',
  progress: 0.2,
  chapter: 'Chapter 2',
  atStart: false,
  atEnd: false,
  ...over,
})

describe('bookmarksHere (bookmark-on-page rule)', () => {
  it('matches an equal locator', () => {
    expect(bookmarksHere([bm({})], loc({}), 'epub')).toHaveLength(1)
  })

  it('EPUB: falls back to same chapter and nearby progress after a reflow', () => {
    const b = bm({ locator: 'cfi-old', progress: 0.2 })
    expect(bookmarksHere([b], loc({ position: 'cfi-new', progress: 0.2015 }), 'epub')).toHaveLength(1)
    expect(bookmarksHere([b], loc({ position: 'cfi-new', progress: 0.21 }), 'epub')).toHaveLength(0)
    expect(bookmarksHere([b], loc({ position: 'cfi-new', progress: 0.2, chapter: 'Chapter 3' }), 'epub')).toHaveLength(0)
  })

  it('PDF: matches by page, with or without an in-page offset', () => {
    const b = bm({ locator: 'page:12@0.35', page: 12, progress: 0.04 })
    expect(bookmarksHere([b], loc({ position: 'page:12', page: 12, chapter: null }), 'pdf')).toHaveLength(1)
    expect(bookmarksHere([b], loc({ position: 'page:13', page: 13, chapter: null }), 'pdf')).toHaveLength(0)
  })

  it('ignores highlights and a missing location', () => {
    expect(bookmarksHere([bm({ kind: 'highlight' })], loc({ position: 'zzz', progress: 0.9 }), 'epub')).toHaveLength(0)
    expect(bookmarksHere([bm({})], null, 'epub')).toEqual([])
  })

  it('sorts annotations in reading order', () => {
    const list = [bm({ id: 3, progress: 0.5 }), bm({ id: 1, progress: 0.1 }), bm({ id: 2, progress: 0.1, created_at: '2026-11-19 11:00:00' })]
    expect(byPosition(list).map((a) => a.id)).toEqual([1, 2, 3])
  })
})

describe('placeToolbar', () => {
  const bounds = { x: 100, y: 50, width: 800, height: 600 }
  const size = { width: 248, height: 124 }

  it('centres above the selection when there is room', () => {
    const p = placeToolbar({ rect: { x: 400, y: 300, width: 200, height: 20 }, bounds, size })
    expect(p.side).toBe('above')
    expect(p.top).toBe(300 - 50 - 10 - 124)
    expect(p.left).toBe(500 - 100 - 124)
    expect(p.notch).toBe(124)
  })

  it('flips below when the selection is near the top', () => {
    const p = placeToolbar({ rect: { x: 400, y: 70, width: 200, height: 20 }, bounds, size })
    expect(p.side).toBe('below')
    expect(p.top).toBe(70 - 50 + 20 + 10)
  })

  it('clamps inside the tile at the left and right edges and keeps the notch on the selection', () => {
    const left = placeToolbar({ rect: { x: 100, y: 300, width: 20, height: 20 }, bounds, size })
    expect(left.left).toBe(8)
    expect(left.notch).toBeGreaterThanOrEqual(14)
    const right = placeToolbar({ rect: { x: 880, y: 300, width: 20, height: 20 }, bounds, size })
    expect(right.left).toBe(800 - 248 - 8)
    expect(right.notch).toBeLessThanOrEqual(248 - 14)
  })

  it('stays inside a tile that is too tall for either side', () => {
    const p = placeToolbar({ rect: { x: 300, y: 60, width: 100, height: 560 }, bounds, size })
    expect(p.top).toBeGreaterThanOrEqual(8)
    expect(p.top + size.height).toBeLessThanOrEqual(600 - 8)
  })
})

describe('highlight defaults', () => {
  const memory = (initial?: unknown) => {
    const m = new Map<string, unknown>(initial === undefined ? [] : [['highlightDefaults', initial]])
    return { get: <T,>(k: string) => m.get(k) as T | undefined, set: (k: string, v: unknown) => void m.set(k, v) }
  }

  it('falls back to yellow highlight and remembers the last choice', () => {
    expect(loadHighlightDefaults(memory())).toEqual(FALLBACK_DEFAULTS)
    const s = memory()
    saveHighlightDefaults(s, { style: 'squiggle', color: 'pink' })
    expect(loadHighlightDefaults(s)).toEqual({ style: 'squiggle', color: 'pink' })
  })

  it('rejects junk', () => {
    expect(loadHighlightDefaults(memory({ style: 'glow', color: 'teal' }))).toEqual(FALLBACK_DEFAULTS)
  })
})

describe('statusParts', () => {
  it('EPUB paged: page in chapter', () => {
    expect(statusParts('epub', 'paginated', loc({ chapterPage: 5, chapterPages: 18, progress: 0.42 }), 'Book')).toEqual({
      chapter: 'Chapter 2',
      page: '5 / 18',
      percent: '42%',
    })
  })

  it('EPUB scroll has no page; PDF shows p. N of M', () => {
    expect(statusParts('epub', 'scrolled', loc({ chapterPage: 5, chapterPages: 18 }), 'Book').page).toBe('')
    expect(statusParts('pdf', 'paginated', loc({ page: 12, pageCount: 300, chapter: null, progress: 0.04 }), 'Book')).toEqual({
      chapter: 'Book',
      page: 'p. 12 of 300',
      percent: '4%',
    })
  })

  it('falls back to the book title before the first location', () => {
    expect(statusParts('epub', 'paginated', null, 'Book')).toEqual({ chapter: 'Book', page: '', percent: '' })
  })
})
