import { describe, expect, it } from 'vitest'
import type { Article } from './extract'
import { buildNote, sourceUrlOf } from './note'

const article: Article = {
  title: 'Why Local-First Wins',
  byline: 'Ada Lovelace',
  siteName: 'Example Engineering',
  published: '2026-03-04',
  excerpt: null,
  url: 'https://eng.example.com/posts/why',
  markdown: 'Body paragraph.\n\n- item',
  images: [],
  wordCount: 1150,
}
const saved = new Date(2026, 9, 12, 10, 0, 0) // local 12 Oct 2026

describe('buildNote', () => {
  it('builds the header, rule and body', () => {
    expect(buildNote(article, saved)).toEqual({
      title: 'Why Local-First Wins',
      content:
        '# Why Local-First Wins\n\n' +
        '> [Example Engineering](https://eng.example.com/posts/why) · Ada Lovelace · 4 Mar 2026\n' +
        '> Saved 2026-10-12 · 5 min read\n\n' +
        '---\n\n' +
        'Body paragraph.\n\n- item\n',
    })
  })

  it('omits missing parts and rounds read time up to at least 1 minute', () => {
    const { content } = buildNote({ ...article, byline: null, published: null, wordCount: 12 }, saved)
    expect(content).toContain('> [Example Engineering](https://eng.example.com/posts/why)\n> Saved 2026-10-12 · 1 min read')
  })

  it('falls back to a bare URL without a site name and to a safe title', () => {
    const { title, content } = buildNote({ ...article, siteName: null, title: '  ' }, saved)
    expect(title).toBe('Untitled')
    expect(content).toContain('> <https://eng.example.com/posts/why> · Ada Lovelace')
  })

  it('omits the body section for empty articles', () => {
    expect(buildNote({ ...article, markdown: '' }, saved).content.endsWith('---\n')).toBe(true)
  })
})

describe('sourceUrlOf', () => {
  it('round-trips the URL', () => {
    expect(sourceUrlOf(buildNote(article, saved).content)).toBe(article.url)
  })

  it('round-trips awkward site names and URLs', () => {
    const a = { ...article, siteName: 'A [odd] site', url: 'https://x.dev/a_(b)?q=1 2' }
    expect(sourceUrlOf(buildNote(a, saved).content)).toBe('https://x.dev/a_(b)?q=1%202')
    expect(sourceUrlOf(buildNote({ ...a, siteName: null }, saved).content)).toBe('https://x.dev/a_(b)?q=1%202')
  })

  it('returns null for ordinary notes and body links', () => {
    expect(sourceUrlOf('')).toBeNull()
    expect(sourceUrlOf('# Notes\n\n> [a](https://x.dev)\n\ntext')).toBeNull()
    expect(sourceUrlOf('# T\n\n---\n\n> [a](https://x.dev)\n> Saved 2026-01-01 · 1 min read')).toBeNull()
  })
})
