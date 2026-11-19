/** Markdown for a passage quoted from a book into its note (spec §3 "Selecting text"). */
import type { BookFormat } from './reader/types'

export interface QuoteInput {
  text: string
  /** Chapter name (EPUB) or 'p. 12' (PDF). */
  where: string
  format: BookFormat
  /** 0..1 through the book. */
  progress: number
}

const escapeInline = (s: string) => s.replace(/([\\*_`])/g, '\\$1')

/** Paragraphs of the passage with whitespace normalised; blank lines in the source become paragraph breaks. */
export function passageParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t\u00a0]*\n/)
    .map((p) => p.replace(/[\s\u00a0]+/g, ' ').trim())
    .filter(Boolean)
}

export function quoteMarkdown({ text, where, format, progress }: QuoteInput): string {
  const paragraphs = passageParagraphs(text)
  const body = paragraphs.map((p) => `> ${p}`).join('\n>\n')
  const place = where.trim()
  let source: string
  if (format === 'pdf') {
    source = place ? `— ${escapeInline(place)}` : ''
  } else {
    const pct = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`
    source = place ? `— *${escapeInline(place)}* · ${pct}` : `— ${pct}`
  }
  return source ? `${body}\n>\n> ${source}\n` : `${body}\n`
}
