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
