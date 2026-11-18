import { describe, expect, it } from 'vitest'
import { quoteMarkdown } from './quote'

describe('quoteMarkdown', () => {
  it('formats an EPUB quote with chapter and percent', () => {
    expect(quoteMarkdown({ text: 'A  single\n line  of text.', where: 'Chapter 3', format: 'epub', progress: 0.424 })).toBe(
      '> A single line of text.\n>\n> — *Chapter 3* · 42%\n',
    )
  })

  it('keeps paragraph breaks as > lines', () => {
    expect(quoteMarkdown({ text: 'First para\nstill first.\n\n\nSecond para.', where: 'Intro', format: 'epub', progress: 0 })).toBe(
      '> First para still first.\n>\n> Second para.\n>\n> — *Intro* · 0%\n',
    )
  })

  it('formats a PDF quote with the page', () => {
    expect(quoteMarkdown({ text: 'Hello', where: 'p. 12', format: 'pdf', progress: 0.5 })).toBe('> Hello\n>\n> — p. 12\n')
  })

  it('drops the chapter when unknown and escapes emphasis characters', () => {
    expect(quoteMarkdown({ text: 'x', where: '', format: 'epub', progress: 0.5 })).toBe('> x\n>\n> — 50%\n')
    expect(quoteMarkdown({ text: 'x', where: 'a*b_c', format: 'epub', progress: 1 })).toContain('*a\\*b\\_c*')
  })
})
