import { describe, expect, it } from 'vitest'
import { extractArticle, largestCandidate } from './extract'
import { MEDIUM_HTML, TINY_HTML, WORDPRESS_HTML } from './fixtures'

const WP_URL = 'https://eng.example.com/2026/03/why-local-first-wins/'

describe('extractArticle: WordPress-style post', () => {
  const a = extractArticle(WORDPRESS_HTML, WP_URL)

  it('reads metadata', () => {
    expect(a.title).toBe('Why Local-First Wins')
    expect(a.byline).toBe('Ada Lovelace')
    expect(a.siteName).toBe('Example Engineering')
    expect(a.published).toBe('2026-03-04')
    expect(a.excerpt).toContain('apps that never wait')
    expect(a.url).toBe(WP_URL)
    expect(a.wordCount).toBeGreaterThan(100)
  })

  it('keeps the article and drops page chrome', () => {
    expect(a.markdown).toContain('Sentence number 1 explains')
    for (const noise of ['cookies', 'Archive', 'Recent Posts', 'Share this', 'All rights reserved', 'dataLayer', 'Other post one']) {
      expect(a.markdown).not.toContain(noise)
    }
  })

  it('does not repeat the title as a leading h1', () => {
    expect(a.markdown.startsWith('# ')).toBe(false)
    expect(a.markdown).not.toContain('# Why Local-First Wins')
  })

  it('resolves links and promotes lazy images and srcset', () => {
    expect(a.markdown).toContain('[CRDT primer](https://eng.example.com/posts/crdt-intro)')
    expect(a.markdown).toContain('[the original essay](https://martin.example/local-first)')
    expect(a.markdown).toContain('![Sync diagram](https://eng.example.com/wp-content/uploads/2026/03/diagram.png)')
    expect(a.markdown).toContain('*The client is the source of truth.*')
    // srcset-only image: the largest candidate wins.
    expect(a.markdown).toContain('![Hero](https://eng.example.com/img/hero-1600.jpg)')
    expect(a.images).toEqual([
      'https://eng.example.com/wp-content/uploads/2026/03/diagram.png',
      'https://eng.example.com/img/hero-1600.jpg',
    ])
  })

  it('drops tracking pixels', () => {
    expect(a.markdown).not.toContain('pixel.gif')
  })

  it('renders headings, nested lists, code, tables and quotes', () => {
    expect(a.markdown).toContain('## Why it matters')
    expect(a.markdown).not.toContain('anchorjs')
    expect(a.markdown).toContain('- Instant interactions\n  - No spinners\n  - No toasts\n- Offline by default')
    expect(a.markdown).toContain('```javascript\nfunction save(note) {\n  queue.push(note)   // never await the network\n}\n```')
    expect(a.markdown).toContain('| Approach | Latency |\n| --- | --- |\n| Server first | ~200 ms |\n| Local first | < 1 ms |')
    expect(a.markdown).toContain('> Backend stores. Frontend thinks.')
  })

  it('has no triple newlines', () => {
    expect(a.markdown).not.toMatch(/\n{3,}/)
  })

  it('omits images when asked', () => {
    const b = extractArticle(WORDPRESS_HTML, WP_URL, { images: false })
    expect(b.images).toEqual([])
    expect(b.markdown).not.toContain('![')
    expect(b.markdown).toContain('*The client is the source of truth.*')
  })
})

describe('extractArticle: Medium-style post', () => {
  const a = extractArticle(MEDIUM_HTML, 'https://medium.com/@grace/notes-on-notes-abc123')

  it('falls back to hostname, JSON-LD date and author, and strips the title suffix', () => {
    expect(a.title).toBe('Notes on Notes')
    expect(a.siteName).toBe('medium.com')
    expect(a.published).toBe('2025-11-02')
    expect(a.byline).toBe('Grace Hopper')
  })

  it('handles figure/picture, inline-formatted headings, pre with br and ordered lists', () => {
    expect(a.markdown).toContain('## First, capture')
    expect(a.markdown).toContain('![A desk](https://medium.com/max/700/cap.jpg)\n\n*My desk, 2025.*')
    expect(a.markdown).toContain('```\n$ npm run dev\n> ready on :3000\n```')
    expect(a.markdown).toContain('2. Second step\n3. Third step')
  })
})

describe('extractArticle: edge cases', () => {
  it('falls back to <article> for very short pages and strips "| Site" title suffixes', () => {
    const a = extractArticle(TINY_HTML, 'https://tiny.example.org/short')
    expect(a.title).toBe('Short')
    expect(a.markdown).toBe('Just a few words.\n\nSecond **line**.')
    expect(a.byline).toBeNull()
    expect(a.published).toBeNull()
    expect(a.wordCount).toBe(6)
  })

  it('never throws on garbage and still returns a title', () => {
    const a = extractArticle('not html at all', 'https://example.com/x')
    expect(a.title).toBe('example.com')
    expect(a.markdown).toBe('not html at all')
  })

  it('respects an existing <base href>', () => {
    const html = `<html><head><base href="https://cdn.example.net/assets/"><title>T</title></head>
      <body><article><p>${'word '.repeat(150)}</p><img src="pic.png" alt="p"></article></body></html>`
    expect(extractArticle(html, 'https://example.com/post').markdown).toContain('![p](https://cdn.example.net/assets/pic.png)')
  })
})

describe('largestCandidate', () => {
  it('picks by width, then density', () => {
    expect(largestCandidate('a.jpg 300w, b.jpg 1200w, c.jpg 600w')).toBe('b.jpg')
    expect(largestCandidate('a.jpg 1x, b.jpg 2x')).toBe('b.jpg')
    expect(largestCandidate('https://cdn/x.jpg?w=1,h=2 300w, https://cdn/y.jpg 900w')).toBe('https://cdn/y.jpg')
    expect(largestCandidate('')).toBeNull()
  })
})
