/**
 * Turns an extracted Article into a Velocity note, and reads the source URL
 * back out of such a note (used for de-duplication and refresh).
 */
import type { Article } from './extract'

const WORDS_PER_MINUTE = 230
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-12` → `12 Oct 2026`. Returns null for anything that isn't a plain ISO date. */
function formatDate(iso: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : null
}

/** Local calendar day, so "Saved" matches what the reader sees on their own clock. */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Link text may not contain unescaped brackets; a destination may not contain spaces or parens. */
const linkLabel = (s: string) => s.replace(/[[\]]/g, '\\$&')
const linkUrl = (s: string) => s.replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')

export function buildNote(a: Article, savedAt: Date = new Date()): { title: string; content: string } {
  const title = a.title.trim() || 'Untitled'
  const minutes = Math.max(1, Math.round(a.wordCount / WORDS_PER_MINUTE))

  const source = a.siteName ? `[${linkLabel(a.siteName)}](${linkUrl(a.url)})` : `<${linkUrl(a.url)}>`
  const line1 = [source, a.byline, formatDate(a.published)].filter(Boolean).join(' · ')
  const line2 = `Saved ${localDay(savedAt)} · ${minutes} min read`

  const content = [`# ${title}`, `> ${line1}\n> ${line2}`, '---', a.markdown.trim()]
    .filter((part, i) => i < 3 || part)
    .join('\n\n')
  return { title, content: `${content}\n` }
}

/**
 * The article URL recorded in a note's header, or null for ordinary notes.
 * Only the header (before the first `---`) is inspected so body links are never mistaken for the source.
 */
export function sourceUrlOf(content: string): string | null {
  const rule = content.search(/^---\s*$/m)
  const head = content.slice(0, rule >= 0 ? rule : 600)
  const quote = head
    .split('\n')
    .filter((l) => l.startsWith('>'))
    .join('\n')
  if (!/^> .*\n?> Saved \d{4}-\d{2}-\d{2}/m.test(quote)) return null
  const first = quote.split('\n')[0]
  const link = /^>\s*\[(?:\\.|[^\]\\])*\]\(([^)\s]+)\)/.exec(first) ?? /^>\s*<(https?:\/\/[^>\s]+)>/.exec(first)
  if (!link) return null
  const url = link[1].replace(/%28/g, '(').replace(/%29/g, ')')
  return /^https?:\/\//i.test(url) ? url : null
}
