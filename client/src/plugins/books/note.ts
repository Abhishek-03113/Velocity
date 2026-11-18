import type { Book } from './types'

/** The marker the plugin owns on the first line of a book note. */
export const BOOK_MARKER_RE = /^<!-- velocity-book:(\d+) -->/

/** The book id a note belongs to, from the first 200 characters, or null for ordinary notes. */
export function bookIdOf(content: string | null | undefined): number | null {
  if (!content) return null
  const match = BOOK_MARKER_RE.exec(content.slice(0, 200))
  return match ? Number(match[1]) : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `18 Nov 2026` (d MMM yyyy, en-GB style, independent of the browser's ICU data). */
export function formatAddedDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** The starting Markdown of a book's note (docs/specs/books-plugin.md §2.1). */
export function bookNoteContent(book: Pick<Book, 'id' | 'author' | 'format'>, now: Date = new Date()): string {
  const parts = [book.author?.trim() ? `**${book.author.trim()}**` : null, book.format.toUpperCase(), `added ${formatAddedDate(now)}`]
  return `<!-- velocity-book:${book.id} -->\n> ${parts.filter(Boolean).join(' · ')}\n\n## Notes\n\n`
}

export interface NoteLike {
  id: number
  content?: string | undefined
}

/**
 * The note carrying a book's marker. Content may not be loaded yet, so `fallback` supplies the
 * cached text (the search index). The newest id wins when a marker was somehow duplicated.
 */
export function findBookNote(
  bookId: number,
  notes: readonly NoteLike[],
  fallback?: (id: number) => string | undefined,
): number | null {
  let found: number | null = null
  for (const note of notes) {
    const content = note.content ?? fallback?.(note.id)
    if (bookIdOf(content) === bookId && (found == null || note.id > found)) found = note.id
  }
  return found
}

/** The title the server gives a freshly uploaded file (mirrors server `titleFromFileName`). */
export function fileTitle(fileName: string): string {
  const base = fileName.replace(/\.(epub|pdf)$/i, '').trim()
  return (base || 'Untitled book').slice(0, 300)
}

/**
 * A book whose import was cut short (page closed or reloaded between the upload and the metadata
 * PATCH): still titled from its file name and without a cover. `checked` holds ids already looked at.
 */
export function needsMetadata(
  book: Pick<Book, 'id' | 'title' | 'file_name' | 'cover_url'>,
  skip: { has(id: number): boolean },
): boolean {
  return !book.cover_url && book.title === fileTitle(book.file_name) && !skip.has(book.id)
}

export type NoteLookup =
  | { status: 'found'; id: number }
  /** Nothing carries the marker and every candidate's content is known: the note really is gone. */
  | { status: 'missing' }
  /** Not found yet, but these notes' content is still unknown (not loaded, not in the search cache). */
  | { status: 'pending'; candidates: number[] }

export interface LookupNote extends NoteLike {
  group_id?: number | null
}

/**
 * Decide whether a book's note exists. Right after a reload the content of notes may not be cached
 * yet, so "not found" only means "missing" once every note in the Books folder has known content:
 * callers load the `pending` candidates and look again, and never create a note while any remain.
 */
export function lookupBookNote(
  bookId: number,
  notes: readonly LookupNote[],
  folderId: number | null,
  fallback?: (id: number) => string | undefined,
): NoteLookup {
  const id = findBookNote(bookId, notes, fallback)
  if (id != null) return { status: 'found', id }
  if (folderId == null) return { status: 'missing' }
  const candidates = notes
    .filter((n) => n.group_id === folderId && n.id > 0 && n.content === undefined && fallback?.(n.id) === undefined)
    .map((n) => n.id)
  return candidates.length ? { status: 'pending', candidates } : { status: 'missing' }
}
