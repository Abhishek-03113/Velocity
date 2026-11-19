import { parseServerTime, type BookAnnotation } from '../types'
import type { BookFormat, ReaderLocation } from '../reader/types'

/** Progress distance (0..1) within which an EPUB bookmark counts as "this page": about half a page of a 150-page book. */
export const BOOKMARK_PROGRESS_EPSILON = 0.003

const pdfPage = (locator: string): number | null => {
  const m = /^page:(\d+)(?:@|$)/.exec(locator)
  return m ? Number(m[1]) : null
}

/**
 * The bookmarks that sit on the page the reader is showing. A bookmark counts when
 *  1. its locator equals the current position, or
 *  2. PDF: its page is the current page, or
 *  3. EPUB fallback (the CFI differs after a resize / layout change): same chapter and a progress within
 *     `BOOKMARK_PROGRESS_EPSILON` of the current one.
 */
export function bookmarksHere(bookmarks: BookAnnotation[], loc: ReaderLocation | null, format: BookFormat): BookAnnotation[] {
  if (!loc) return []
  return bookmarks.filter((b) => {
    if (b.kind !== 'bookmark') return false
    if (b.locator === loc.position) return true
    if (format === 'pdf') {
      const page = pdfPage(b.locator) ?? b.page
      return page != null && loc.page != null && page === loc.page
    }
    return (b.chapter ?? null) === (loc.chapter ?? null) && Math.abs(b.progress - loc.progress) <= BOOKMARK_PROGRESS_EPSILON
  })
}

/** Annotations in reading order (progress, then creation). */
export function byPosition(list: BookAnnotation[]): BookAnnotation[] {
  return [...list].sort((a, b) => a.progress - b.progress || parseServerTime(a.created_at) - parseServerTime(b.created_at) || a.id - b.id)
}
