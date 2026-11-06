import { describe, expect, it } from 'vitest'
import { base64ToBytes, exportName, isLatexSource, newDocumentTemplate, standaloneSource } from './document'

describe('latex documents', () => {
  it('detects full documents', () => {
    expect(isLatexSource('\\documentclass{article}\n')).toBe(true)
    expect(isLatexSource('Some \\begin{document} text')).toBe(true)
    expect(isLatexSource('# Markdown with $x$')).toBe(false)
  })

  it('leaves full documents unchanged', () => {
    const doc = newDocumentTemplate('T', 'A')
    expect(standaloneSource(doc)).toEqual({ source: doc, lineOffset: 0, wrapped: false })
  })

  it('wraps fragments in a preamble and reports the line offset', () => {
    const { source, lineOffset, wrapped } = standaloneSource('Line one\n\\begin{theorem}x\\end{theorem}')
    expect(wrapped).toBe(true)
    const lines = source.split('\n')
    expect(lines[0]).toBe('\\documentclass[11pt]{article}')
    expect(lines[lineOffset]).toBe('Line one')
    expect(lines[lineOffset - 1]).toBe('\\begin{document}')
    expect(source).toContain('\\newtheorem{theorem}{Theorem}')
    expect(source).not.toContain('\\newtheorem{lemma}')
    expect(source.trimEnd().endsWith('\\end{document}')).toBe(true)
  })

  it('does not redefine theorems a fragment defines itself', () => {
    expect(standaloneSource('\\newtheorem{theorem}{Satz}\\begin{theorem}x\\end{theorem}').source.match(/\\newtheorem/g)).toHaveLength(1)
  })

  it('makes safe file names', () => {
    expect(exportName('My Paper: Draft #2', 'tex')).toBe('My-Paper-Draft-2.tex')
    expect(exportName('Über / naïve', 'pdf')).toBe('Uber-naive.pdf')
    expect(exportName('../..', 'pdf')).toBe('document.pdf')
    expect(exportName('', 'tex')).toBe('document.tex')
  })

  it('decodes base64 PDFs', () => {
    expect(Array.from(base64ToBytes(btoa('%PDF')))).toEqual([37, 80, 68, 70])
  })
})
