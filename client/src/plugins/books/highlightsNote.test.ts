import { marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { highlightsNoteContent, highlightsTitle } from './highlightsNote'
import { highlightsBookIdOf, isBookLinkUrl } from './note'
import { bookLink, parseBookLink, type BookAnnotation } from './types'

let nextId = 1
function ann(over: Partial<BookAnnotation>): BookAnnotation {
  return {
    id: nextId++,
    book_id: 12,
    kind: 'highlight',
    locator: 'loc',
    text: 'Text',
    note: null,
    color: 'yellow',
    style: 'highlight',
    chapter: null,
    progress: 0,
    page: null,
    created_at: '2026-11-19 09:00:00',
    updated_at: '2026-11-19 09:00:00',
    ...over,
  }
}

const epub = { id: 12, title: 'Strange Weather in Tokyo', author: 'Hiromi Kawakami', format: 'epub' as const }
const pdf = { id: 7, title: 'Rust Notes', author: null, format: 'pdf' as const }

describe('highlightsNoteContent', () => {
  it('writes the EPUB note: chapters in reading order, notes, bookmarks, links', () => {
    const list = [
      ann({ locator: 'epubcfi(/6/8!/4/2)', text: 'Later passage.', chapter: 'The Moon and the Batteries', progress: 0.3, color: 'green', style: 'underline', note: 'reminds me of\nsomething', created_at: '2026-11-20 08:00:00', updated_at: '2026-11-20 08:00:00' }),
      ann({ locator: 'epubcfi(/6/4!/4/2)', text: 'His full name was Mr. Harutsuna Matsumoto,\nbut I called him “Sensei.”', chapter: 'The Moon and the Batteries', progress: 0.04 }),
      ann({ locator: 'epubcfi(/6/2)', text: '# not a heading', chapter: null, progress: 0.01, color: 'pink', style: 'squiggle' }),
      ann({ kind: 'bookmark', locator: 'epubcfi(/6/4)', text: null, color: null, style: null, chapter: 'The Moon and the Batteries', progress: 0.04 }),
      ann({ kind: 'bookmark', locator: 'epubcfi(/6/1)', text: null, color: null, style: null, chapter: null, progress: 0.01 }),
    ]
    expect(highlightsNoteContent(epub, list)).toBe(
      [
        '<!-- velocity-book-highlights:12 -->',
        '> **Strange Weather in Tokyo** · Hiromi Kawakami · 3 highlights · 2 bookmarks · updated 20 Nov 2026',
        '',
        '## Untitled section',
        '',
        '> \\# not a heading',
        '>',
        '> 🩷 squiggly · [1%](velocity://book/12?at=epubcfi%28%2F6%2F2%29) · 19 Nov 2026',
        '',
        '## The Moon and the Batteries',
        '',
        '> His full name was Mr. Harutsuna Matsumoto,',
        '> but I called him “Sensei.”',
        '>',
        '> 🟡 [4%](velocity://book/12?at=epubcfi%28%2F6%2F4!%2F4%2F2%29) · 19 Nov 2026',
        '',
        '> Later passage.',
        '>',
        '> 🟢 underline · [30%](velocity://book/12?at=epubcfi%28%2F6%2F8!%2F4%2F2%29) · 20 Nov 2026',
        '',
        '**Note:** reminds me of  ',
        'something',
        '',
        '## Bookmarks',
        '',
        '- [1%](velocity://book/12?at=epubcfi%28%2F6%2F1%29) · 19 Nov 2026',
        '- [The Moon and the Batteries · 4%](velocity://book/12?at=epubcfi%28%2F6%2F4%29) · 19 Nov 2026',
        '',
      ].join('\n'),
    )
  })

  it('writes the PDF note with page numbers and no author', () => {
    const list = [
      ann({ book_id: 7, locator: 'page:12@0.35', text: '> quoted', chapter: 'Ownership', progress: 0.04, page: 12, color: 'blue', style: 'strike' }),
      ann({ book_id: 7, kind: 'bookmark', locator: 'page:3', text: null, color: null, style: null, chapter: null, progress: 0.01, page: 3 }),
    ]
    expect(highlightsNoteContent(pdf, list)).toBe(
      [
        '<!-- velocity-book-highlights:7 -->',
        '> **Rust Notes** · 1 highlight · 1 bookmark · updated 19 Nov 2026',
        '',
        '## Ownership',
        '',
        '> \\> quoted',
        '>',
        '> 🔵 strikethrough · [p. 12 · 4%](velocity://book/7?at=page%3A12%400.35) · 19 Nov 2026',
        '',
        '## Bookmarks',
        '',
        '- [p. 3 · 1%](velocity://book/7?at=page%3A3) · 19 Nov 2026',
        '',
      ].join('\n'),
    )
  })

  it('is deterministic and says so when empty', () => {
    expect(highlightsNoteContent(epub, [])).toBe(highlightsNoteContent(epub, []))
    expect(highlightsNoteContent(epub, [])).toContain('No highlights or bookmarks yet.')
  })

  it('titles the note and carries a marker the plugin can find', () => {
    expect(highlightsTitle(epub)).toBe('Strange Weather in Tokyo — Highlights')
    expect(highlightsBookIdOf(highlightsNoteContent(epub, []))).toBe(12)
    expect(highlightsBookIdOf('<!-- velocity-book:12 -->')).toBeNull()
  })

  it('keeps links parseable even with parentheses in the locator', () => {
    const note = highlightsNoteContent(epub, [ann({ locator: 'epubcfi(/6/4[ch1]!/4/2/1:0)' })])
    const href = /\]\((velocity:[^)\s]+)\)/.exec(note)![1]!
    expect(parseBookLink(href)).toEqual({ bookId: 12, locator: 'epubcfi(/6/4[ch1]!/4/2/1:0)' })
  })
})

describe('rendered links', () => {
  const links = (md: string) => {
    const doc = new DOMParser().parseFromString(marked(md, { async: false, gfm: true }) as string, 'text/html')
    return Array.from(doc.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')])
  }

  it('renders a PDF locator link as an anchor labelled with its place, and it round-trips', () => {
    const locator = 'pdf:{"page":9,"rects":[[0.1174,0.0891,0.1829,0.0671],[0.1,0.2,0.3,0.04]]}'
    const md = highlightsNoteContent(pdf, [ann({ locator, text: 'Page', page: 9, progress: 0.67, chapter: 'Part III' })])
    const found = links(md)
    expect(found).toHaveLength(1)
    expect(found[0][0]).toBe('p. 9 · 67%')
    expect(parseBookLink(found[0][1]!)).toEqual({ bookId: 7, locator })
  })

  it('renders an EPUB CFI link as an anchor too', () => {
    const locator = 'epubcfi(/6/4!/4/2,/1:0,/1:42)'
    const found = links(highlightsNoteContent(epub, [ann({ locator, chapter: 'One', progress: 0.2 })]))
    expect(found).toHaveLength(1)
    expect(parseBookLink(found[0][1]!)).toEqual({ bookId: 12, locator })
  })
})

describe('book links', () => {
  it('round-trips and rejects other URLs', () => {
    expect(parseBookLink(bookLink(5, 'page:9'))).toEqual({ bookId: 5, locator: 'page:9' })
    expect(parseBookLink('velocity://book/5')).toEqual({ bookId: 5, locator: null })
    expect(parseBookLink('velocity://book/abc')).toBeNull()
    expect(parseBookLink('https://example.com/book/5')).toBeNull()
    expect(parseBookLink('velocity://book/5?at=%E0%A4%A')).toBeNull()
  })

  it('matches only velocity://book URLs', () => {
    expect(isBookLinkUrl(new URL('velocity://book/12?at=x'))).toBe(true)
    expect(isBookLinkUrl(new URL('velocity://note/12'))).toBe(false)
    expect(isBookLinkUrl(new URL('https://book/12'))).toBe(false)
  })
})
