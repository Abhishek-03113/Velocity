/**
 * The Markdown of a book's highlights note (docs/specs/books-reading-experience.md §5). Pure: the
 * same book and annotations always give the same text, so the note is only written when it changed.
 */
import { formatAddedDate } from './note'
import { bookLink, parseServerTime, type Book, type BookAnnotation } from './types'

export const UNTITLED_SECTION = 'Untitled section'

/** Coloured dot emoji: survives Markdown export, unlike a CSS swatch. */
export const COLOR_DOTS: Record<NonNullable<BookAnnotation['color']>, string> = {
  yellow: '🟡',
  green: '🟢',
  blue: '🔵',
  pink: '🩷',
  orange: '🟠',
}

/** Named only when the highlight is not a plain highlight. */
const STYLE_WORDS: Record<NonNullable<BookAnnotation['style']>, string | null> = {
  highlight: null,
  underline: 'underline',
  strike: 'strikethrough',
  squiggle: 'squiggly',
}

export const highlightsTitle = (book: Pick<Book, 'title'>): string => `${book.title} — Highlights`

export const highlightsMarker = (bookId: number): string => `<!-- velocity-book-highlights:${bookId} -->`

/** A link whose target survives Markdown: parentheses in a locator (EPUB CFIs) are percent-encoded. */
function safeLink(bookId: number, locator: string): string {
  return bookLink(bookId, locator).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** Keep a leading `#`, `>` or list marker from turning a line of quoted text into Markdown structure. */
function escapeLine(line: string): string {
  return line.replace(/^(\s*)([#>]|[-+*]\s|\d+[.)]\s)/, (_m, space: string, mark: string) => `${space}\\${mark}`)
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function percent(progress: number): string {
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`
}

/** `p. 12 · 4%` for a PDF page, `4%` for an EPUB (it has no stable pages). */
function place(book: Pick<Book, 'format'>, a: Pick<BookAnnotation, 'page' | 'progress'>): string {
  return book.format === 'pdf' && a.page != null ? `p. ${a.page} · ${percent(a.progress)}` : percent(a.progress)
}

function dateOf(value: string): string {
  const ms = parseServerTime(value)
  return ms ? formatAddedDate(new Date(ms)) : ''
}

const byPlace = (a: BookAnnotation, b: BookAnnotation) =>
  a.progress - b.progress || parseServerTime(a.created_at) - parseServerTime(b.created_at) || a.id - b.id

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function highlightBlock(book: Pick<Book, 'id' | 'format'>, a: BookAnnotation): string {
  const quote = (a.text ?? '').trim().split(/\r?\n/).map((l) => `> ${escapeLine(l.trim())}`.trimEnd())
  const style = a.style ? STYLE_WORDS[a.style] : null
  const date = dateOf(a.created_at)
  const meta = [`${a.color ? `${COLOR_DOTS[a.color]} ` : ''}${style ? `${style} · ` : ''}[${place(book, a)}](${safeLink(book.id, a.locator)})`, date]
    .filter(Boolean)
    .join(' · ')
  const lines = [...quote, '>', `> ${meta}`]
  const note = a.note?.trim()
  if (note) {
    const noteLines = note.split(/\r?\n/).map((l, i) => (i === 0 ? l.trimEnd() : escapeLine(l.trimEnd())))
    lines.push('', `**Note:** ${noteLines.join('  \n')}`)
  }
  return lines.join('\n')
}

/** The whole note for a book. Header counts, chapters in reading order, then bookmarks. */
export function highlightsNoteContent(
  book: Pick<Book, 'id' | 'title' | 'author' | 'format'>,
  annotations: readonly BookAnnotation[],
): string {
  const highlights = annotations.filter((a) => a.kind === 'highlight').sort(byPlace)
  const bookmarks = annotations.filter((a) => a.kind === 'bookmark').sort(byPlace)
  const updated = annotations.reduce((max, a) => Math.max(max, parseServerTime(a.updated_at)), 0)

  const head = [
    `**${book.title.trim()}**`,
    book.author?.trim() || null,
    highlights.length ? plural(highlights.length, 'highlight') : null,
    bookmarks.length ? plural(bookmarks.length, 'bookmark') : null,
    updated ? `updated ${formatAddedDate(new Date(updated))}` : null,
  ]
  const out = [highlightsMarker(book.id), `> ${head.filter(Boolean).join(' · ')}`]

  const groups = new Map<string, BookAnnotation[]>()
  for (const h of highlights) {
    const chapter = oneLine(h.chapter ?? '') || UNTITLED_SECTION
    const group = groups.get(chapter)
    if (group) group.push(h)
    else groups.set(chapter, [h])
  }
  for (const [chapter, rows] of groups) {
    out.push('', `## ${chapter.replace(/^#+\s*/, '')}`)
    for (const row of rows) out.push('', highlightBlock(book, row))
  }

  if (bookmarks.length) {
    out.push('', '## Bookmarks', '')
    for (const b of bookmarks) {
      const chapter = oneLine(b.chapter ?? '')
      const label = [chapter || null, place(book, b)].filter(Boolean).join(' · ')
      out.push(`- ${[`[${label}](${safeLink(book.id, b.locator)})`, dateOf(b.created_at)].filter(Boolean).join(' · ')}`)
    }
  }

  if (!highlights.length && !bookmarks.length) out.push('', 'No highlights or bookmarks yet.')
  return `${out.join('\n')}\n`
}
