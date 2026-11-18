import { describe, expect, it } from 'vitest'
import { bookIdOf, bookNoteContent, findBookNote, fileTitle, formatAddedDate, lookupBookNote, needsMetadata } from './note'

describe('metadata repair', () => {
  const book = { id: 1, title: 'sample', file_name: 'sample.epub', cover_url: null }
  const none = new Set<number>()

  it('derives the server default title from the file name', () => {
    expect(fileTitle('My Book.PDF')).toBe('My Book')
    expect(fileTitle('.epub')).toBe('Untitled book')
    expect(fileTitle(`${'x'.repeat(400)}.pdf`)).toHaveLength(300)
  })

  it('flags books still titled from the file and without a cover', () => {
    expect(needsMetadata(book, none)).toBe(true)
  })

  it('leaves books with a cover, a real title, or already checked alone', () => {
    expect(needsMetadata({ ...book, cover_url: '/api/assets/3' }, none)).toBe(false)
    expect(needsMetadata({ ...book, title: 'The Velocity Sampler' }, none)).toBe(false)
    expect(needsMetadata(book, new Set([1]))).toBe(false)
  })
})

describe('lookupBookNote', () => {
  const marker = '<!-- velocity-book:5 -->\n'
  it('finds a note from loaded or cached content', () => {
    const notes = [
      { id: 1, group_id: 2, content: marker },
      { id: 2, group_id: 2, content: undefined },
    ]
    expect(lookupBookNote(5, notes, 2)).toEqual({ status: 'found', id: 1 })
    const cached = (id: number) => (id === 3 ? '<!-- velocity-book:6 -->' : undefined)
    expect(lookupBookNote(6, [{ id: 3, group_id: 2, content: undefined }], 2, cached)).toEqual({ status: 'found', id: 3 })
  })

  it('is pending, not missing, while Books-folder notes are still unloaded', () => {
    const notes = [
      { id: 1, group_id: 2, content: 'plain' },
      { id: 2, group_id: 2, content: undefined },
      { id: 3, group_id: 9, content: undefined },
      { id: -4, group_id: 2, content: undefined },
    ]
    expect(lookupBookNote(5, notes, 2)).toEqual({ status: 'pending', candidates: [2] })
  })

  it('is missing once every candidate is known', () => {
    const notes = [
      { id: 1, group_id: 2, content: 'plain' },
      { id: 2, group_id: 2, content: undefined },
    ]
    expect(lookupBookNote(5, notes, 2, () => 'cached')).toEqual({ status: 'missing' })
    expect(lookupBookNote(5, notes, null)).toEqual({ status: 'missing' })
  })
})

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
