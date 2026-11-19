import { describe, expect, it } from 'vitest'
import { chapterNumberLabel, currentTocIndex, progressLabel } from './labels'
import type { ReaderLocation, TocItem } from './reader/types'

const loc = (over: Partial<ReaderLocation>): ReaderLocation => ({
  position: 'p',
  progress: 0.42,
  chapter: null,
  atStart: false,
  atEnd: false,
  ...over,
})

describe('chapterNumberLabel', () => {
  it('extracts a chapter or part number', () => {
    expect(chapterNumberLabel('Chapter 3: Foo')).toBe('Chapter 3')
    expect(chapterNumberLabel('chapter 12')).toBe('Chapter 12')
    expect(chapterNumberLabel('Part III: Mastery')).toBe('Part III')
    expect(chapterNumberLabel('7. Habits')).toBe('Chapter 7')
  })
  it('returns null for unnumbered titles', () => {
    expect(chapterNumberLabel('Preface')).toBeNull()
    expect(chapterNumberLabel(null)).toBeNull()
  })
})

describe('progressLabel', () => {
  it('formats PDF pages and EPUB chapter + percent', () => {
    expect(progressLabel('pdf', loc({ page: 12, pageCount: 300 }))).toBe('Page 12 of 300')
    expect(progressLabel('epub', loc({ chapter: 'Chapter 3' }))).toBe('Chapter 3 · 42%')
    expect(progressLabel('epub', loc({ chapter: 'Preface' }))).toBe('42%')
    expect(progressLabel('epub', null)).toBe('')
  })
})

describe('currentTocIndex', () => {
  const pdfToc: TocItem[] = [
    { id: '1', label: 'Intro', target: 'page:1', level: 0 },
    { id: '2', label: 'Part III', target: 'page:9', level: 0 },
    { id: '3', label: 'Deep', target: 'page:10', level: 1 },
  ]
  it('finds the last outline entry at or before the page', () => {
    expect(currentTocIndex(pdfToc, 'pdf', loc({ page: 1, pageCount: 12 }))).toBe(0)
    expect(currentTocIndex(pdfToc, 'pdf', loc({ page: 9, pageCount: 12 }))).toBe(1)
    expect(currentTocIndex(pdfToc, 'pdf', loc({ page: 12, pageCount: 12 }))).toBe(2)
  })
  it('matches EPUB entries by chapter label', () => {
    const toc: TocItem[] = [
      { id: 'a', label: 'One', target: 'a.xhtml', level: 0 },
      { id: 'b', label: 'Two', target: 'b.xhtml', level: 0 },
    ]
    expect(currentTocIndex(toc, 'epub', loc({ chapter: 'Two' }))).toBe(1)
    expect(currentTocIndex(toc, 'epub', loc({ chapter: null }))).toBe(-1)
    expect(currentTocIndex([], 'epub', loc({ chapter: 'Two' }))).toBe(-1)
  })
})
