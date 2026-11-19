/** Small pure helpers for the reader bar: progress label and "where am I" in the contents. */
import type { BookFormat, ReaderLocation, TocItem } from './reader/types'

/** "Chapter 3" / "Part III" from a chapter label like "Chapter 3: Foo", "Part III: Mastery" or "3. Foo"; else null. */
export function chapterNumberLabel(label: string | null | undefined): string | null {
  if (!label) return null
  const named = /^\s*(chapter|part|book|section)\s+([0-9]+|[ivxlcdm]+)\b/i.exec(label)
  if (named) {
    const word = `${named[1][0].toUpperCase()}${named[1].slice(1).toLowerCase()}`
    return `${word} ${named[2].toUpperCase()}`
  }
  const numbered = /^\s*(\d{1,3})[.:)]\s/.exec(label)
  if (numbered) return `Chapter ${numbered[1]}`
  return null
}

export function percentLabel(progress: number): string {
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`
}

/** "Page 12 of 300" (PDF) or "Chapter 3 · 42%" / "42%" (EPUB). Empty before the first location. */
export function progressLabel(format: BookFormat, loc: ReaderLocation | null): string {
  if (!loc) return ''
  if (format === 'pdf' && loc.page != null) {
    return loc.pageCount ? `Page ${loc.page} of ${loc.pageCount}` : `Page ${loc.page}`
  }
  const pct = percentLabel(loc.progress)
  const chapter = chapterNumberLabel(loc.chapter)
  return chapter ? `${chapter} · ${pct}` : pct
}

/** Index of the contents entry the reader is in, or -1. PDF: last outline page at or before the current page. */
export function currentTocIndex(toc: TocItem[], format: BookFormat, loc: ReaderLocation | null): number {
  if (!loc || toc.length === 0) return -1
  if (format === 'pdf' && loc.page != null) {
    let found = -1
    let foundPage = -1
    toc.forEach((item, i) => {
      const m = /^page:(\d+)$/.exec(item.target)
      if (!m) return
      const page = Number(m[1])
      if (page <= loc.page! && page >= foundPage) {
        found = i
        foundPage = page
      }
    })
    return found
  }
  if (!loc.chapter) return -1
  return toc.findIndex((item) => item.label === loc.chapter)
}

export interface StatusParts {
  /** Chapter title (left). */
  chapter: string
  /** `5 / 18` (EPUB paged, page in chapter) or `p. 12 of 300` (PDF); empty when unknown (centre). */
  page: string
  /** `42%` (right). */
  percent: string
}

/** The three parts of the status line (spec §3.3). */
export function statusParts(
  format: BookFormat,
  layout: 'paginated' | 'scrolled',
  loc: ReaderLocation | null,
  fallbackChapter: string,
): StatusParts {
  if (!loc) return { chapter: fallbackChapter, page: '', percent: '' }
  let page = ''
  if (format === 'pdf') {
    if (loc.page != null) page = loc.pageCount ? `p. ${loc.page} of ${loc.pageCount}` : `p. ${loc.page}`
  } else if (layout === 'paginated' && loc.chapterPage != null && loc.chapterPages) {
    page = `${loc.chapterPage} / ${loc.chapterPages}`
  }
  return { chapter: loc.chapter || fallbackChapter, page, percent: percentLabel(loc.progress) }
}
