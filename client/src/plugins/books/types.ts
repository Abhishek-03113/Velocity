/**
 * Shared contract between the Books plugin core (ACC-23: index, api, store, Bookshelf) and the
 * reader tile (ACC-24: ReaderTile, position). See docs/specs/books-plugin.md §2.
 */
import type { BookFormat } from './reader/types'

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
  /** SQLite timestamps: 'YYYY-MM-DD HH:MM:SS' in UTC. Use parseServerTime. */
  last_opened_at: string | null
  created_at: string
  updated_at: string
  /** '/api/plugins/books/<id>/file' (relative). */
  file_url: string
}

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
}
