import { describe, expect, it } from 'vitest'
import { bookIdOf, bookNoteContent, findBookNote, formatAddedDate } from './note'

const book = { id: 12, author: 'Martin Kleppmann', format: 'epub' as const }

describe('book note', () => {
  it('builds the note from the spec', () => {
    expect(bookNoteContent(book, new Date(2026, 10, 18))).toBe(
      '<!-- velocity-book:12 -->\n> **Martin Kleppmann** · EPUB · added 18 Nov 2026\n\n## Notes\n\n',
    )
  })

  it('omits the author segment when there is none', () => {
    const text = bookNoteContent({ id: 3, author: null, format: 'pdf' }, new Date(2026, 8, 1))
    expect(text).toContain('\n> PDF · added 1 Sep 2026\n')
    expect(bookNoteContent({ id: 3, author: '  ', format: 'pdf' }, new Date(2026, 8, 1))).toBe(text)
  })

  it('formats dates as d MMM yyyy', () => {
    expect(formatAddedDate(new Date(2027, 0, 5))).toBe('5 Jan 2027')
    expect(formatAddedDate(new Date(2026, 8, 30))).toBe('30 Sep 2026')
  })

  it('reads the book id from the marker only at the start', () => {
    expect(bookIdOf(bookNoteContent(book))).toBe(12)
    expect(bookIdOf('<!-- velocity-book:7 -->')).toBe(7)
    expect(bookIdOf('hello\n<!-- velocity-book:7 -->')).toBeNull()
    expect(bookIdOf('<!-- velocity-book:x -->')).toBeNull()
    expect(bookIdOf('')).toBeNull()
    expect(bookIdOf(undefined)).toBeNull()
  })

  it('finds the note for a book, falling back to cached content', () => {
    const notes = [
      { id: 1, content: 'plain' },
      { id: 2, content: undefined },
      { id: 3, content: '<!-- velocity-book:5 -->\nmine' },
    ]
    expect(findBookNote(5, notes)).toBe(3)
    expect(findBookNote(9, notes)).toBeNull()
    expect(findBookNote(9, notes, (id) => (id === 2 ? '<!-- velocity-book:9 -->' : undefined))).toBe(2)
  })
})
