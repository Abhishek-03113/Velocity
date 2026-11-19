import { describe, expect, it } from 'vitest'
import { sanitizeNoteHtml } from './sanitizeHtml'

const href = (html: string) => {
  const el = document.createElement('div')
  el.innerHTML = sanitizeNoteHtml(html)
  return el.querySelector('a')?.getAttribute('href') ?? null
}

describe('sanitizeNoteHtml', () => {
  it('keeps velocity: links', () => {
    expect(href('<a href="velocity://book/1?at=x">Go</a>')).toBe('velocity://book/1?at=x')
  })

  it('still strips javascript: and other unknown schemes', () => {
    expect(href('<a href="javascript:alert(1)">x</a>')).toBeNull()
    expect(href('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBeNull()
    expect(href('<a href="vbscript:x">x</a>')).toBeNull()
  })

  it('keeps http(s), mailto and relative links and data images', () => {
    expect(href('<a href="https://example.com/a">x</a>')).toBe('https://example.com/a')
    expect(href('<a href="mailto:a@b.co">x</a>')).toBe('mailto:a@b.co')
    expect(href('<a href="/notes/1">x</a>')).toBe('/notes/1')
    expect(sanitizeNoteHtml('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png')
  })

  it('removes scripts', () => {
    expect(sanitizeNoteHtml('<p>a</p><script>alert(1)</script>')).toBe('<p>a</p>')
  })
})
