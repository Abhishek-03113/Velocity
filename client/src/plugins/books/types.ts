/**
 * Shared contract between the Books plugin core (ACC-23: index, api, store, Bookshelf) and the
 * reader tile (ACC-24: ReaderTile, position). See docs/specs/books-plugin.md §2.
 */
import type { BookFormat, HighlightColor, HighlightStyle } from './reader/types'

export type BookStatus = 'unread' | 'reading' | 'finished'

/** A book as the server returns it (`/api/plugins/books`). */
export interface Book {
  id: number
  format: BookFormat
  title: string
  author: string | null
  file_name: string
  byte_size: number
  sha256: string
  /** '/api/assets/<id>' or null (relative: prefix with apiBaseUrl to load). */
  cover_url: string | null
  /** EPUB CFI or PDF 'page:<n>'. */
  position: string | null
  progress: number
  status: BookStatus
  page_count: number | null
  /** Per-book reader settings as JSON (see bookSettings.ts), saved on the book row so they follow it across devices. */
  settings?: string | null
  /** SQLite timestamps: 'YYYY-MM-DD HH:MM:SS' in UTC. Use parseServerTime. */
  last_opened_at: string | null
  created_at: string
  updated_at: string
  /** '/api/plugins/books/<id>/file' (relative). */
  file_url: string
}

/** v2: a highlight or bookmark as the server returns it (`/api/plugins/books/:id/annotations`). */
export interface BookAnnotation {
  id: number
  book_id: number
  /** quote: a passage sent to the book's note with Quote in Notes (text, locator, no colour or style). */
  kind: 'highlight' | 'bookmark' | 'quote'
  /** Highlight / quote: ReaderAnnotation.locator. Bookmark: a ReaderLocation.position. */
  locator: string
  /** Highlighted passage (null for bookmarks). */
  text: string | null
  note: string | null
  color: HighlightColor | null
  style: HighlightStyle | null
  /** Chapter / outline label at the annotation. */
  chapter: string | null
  progress: number
  /** PDF page (1-based) or null. */
  page: number | null
  created_at: string
  updated_at: string
}

export type NewAnnotation = Omit<BookAnnotation, 'id' | 'book_id' | 'created_at' | 'updated_at'>
export type AnnotationPatch = Partial<Pick<BookAnnotation, 'color' | 'style' | 'note'>>

/** Reading state the reader writes back. */
export interface ProgressPatch {
  position: string
  progress: number
  status: Exclude<BookStatus, 'unread'>
}

/** Milliseconds since epoch for a server timestamp ('YYYY-MM-DD HH:MM:SS' UTC, or ISO). 0 when missing/invalid. */
export function parseServerTime(value: string | null | undefined): number {
  if (!value) return 0
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * What the reader tile needs from the plugin core. ACC-23 implements it (backed by the books store
 * and api.ts) and passes it to `readerTileView(ctx, host)` from ACC-24's ReaderTile.tsx.
 */
export interface ReaderHost {
  /** React hook: the book behind a book note, live from the store. undefined while loading, null when the note is not a book (or the book is gone). */
  useBookForNote(noteId: number): Book | null | undefined
  /** Absolute URL of the book file (apiBaseUrl + file_url). */
  fileUrl(book: Book): string
  /** Local-first: update the store at once (shelf progress bars and badges follow). */
  setLocalProgress(bookId: number, patch: ProgressPatch): void
  /** Persist to the server (PATCH). `keepalive` for flushes during unload. */
  saveProgress(bookId: number, patch: ProgressPatch, opts?: { keepalive?: boolean }): Promise<void>
  /** PATCH { opened: true }; the core sends it at most once per book per session. */
  markOpened(bookId: number): void
  /** Hand the user the original file. */
  downloadOriginal(book: Book): void

  // v2 annotations (implemented by ACC-39; optional until integrated).
  /** React hook: the book's highlights and bookmarks, live and local-first (temp ids are negative). */
  useAnnotations?(bookId: number): BookAnnotation[]
  /** Optimistic add; returns the annotation with a temporary negative id until the server confirms. */
  addAnnotation?(bookId: number, input: NewAnnotation): BookAnnotation
  updateAnnotation?(bookId: number, id: number, patch: AnnotationPatch): void
  removeAnnotation?(bookId: number, id: number): void
  /** Open (creating if needed) the book's highlights note in the Books folder. */
  openHighlightsNote?(bookId: number): void
}

/** v2: in-app link to a place in a book, used by the highlights note. */
export function bookLink(bookId: number, locator: string): string {
  return `velocity://book/${bookId}?at=${encodeURIComponent(locator)}`
}

/** Parse a `bookLink`; null when the URL is not one. */
export function parseBookLink(href: string): { bookId: number; locator: string | null } | null {
  const m = /^velocity:\/\/book\/(\d+)(?:\?at=([^#]*))?$/.exec(href)
  if (!m) return null
  let locator: string | null = null
  if (m[2]) {
    try {
      locator = decodeURIComponent(m[2])
    } catch {
      return null
    }
  }
  return { bookId: Number(m[1]), locator }
}
