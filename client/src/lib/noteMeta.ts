import type { Paste } from '../types'

export const UNTITLED = 'Untitled'
export const NEW_NOTE_LABEL = 'New Note'

/** Titles the user never set explicitly (legacy "Untitled" or blank). */
export function hasExplicitTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim()
  return t.length > 0 && t !== UNTITLED
}

/** Strip markdown syntax from a single line so it reads as plain text. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*)[*_]/g, '$1$2')
    .trim()
}

/** First meaningful line of content, used as an automatic title (Apple Notes style). */
export function derivedTitle(content: string | undefined): string {
  if (!content) return ''
  let start = 0
  // Only scan the head of the note — titles live at the top, and notes can be huge.
  const head = content.length > 4000 ? content.slice(0, 4000) : content
  while (start <= head.length) {
    const end = head.indexOf('\n', start)
    const line = head.slice(start, end === -1 ? undefined : end)
    if (!/^\s*(```|---|\*\*\*)/.test(line)) {
      const text = plainLine(line)
      if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text
    }
    if (end === -1) break
    start = end + 1
  }
  return ''
}

export function displayTitle(
  paste: Pick<Paste, 'title' | 'content'> | null | undefined,
  fallbackContent?: string,
): string {
  if (!paste) return NEW_NOTE_LABEL
  if (hasExplicitTitle(paste.title)) return paste.title.trim()
  return derivedTitle(paste.content ?? fallbackContent) || NEW_NOTE_LABEL
}

/** Short body preview: skips the line used as the title. */
export function snippet(content: string | undefined, title: string, max = 120): string {
  if (!content) return ''
  const head = content.length > 2000 ? content.slice(0, 2000) : content
  const out: string[] = []
  let length = 0
  let skippedTitle = false
  for (const raw of head.split('\n')) {
    if (/^\s*(```|---|\*\*\*)/.test(raw)) continue
    const text = plainLine(raw)
    if (!text) continue
    if (!skippedTitle && (text === title || title.startsWith(text.slice(0, 40)))) {
      skippedTitle = true
      continue
    }
    skippedTitle = true
    out.push(text)
    length += text.length + 1
    if (length >= max) break
  }
  const joined = out.join(' ')
  return joined.length > max ? `${joined.slice(0, max).trimEnd()}…` : joined
}

/** SQLite CURRENT_TIMESTAMP is UTC without a zone marker. */
export function parseTimestamp(value: string | undefined): number {
  if (!value) return 0
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullDateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

/** Apple Notes-style relative stamp: "Just now", "10:42 AM", "Yesterday", "Monday", "Mar 3". */
export function relativeTime(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const diff = now - ms
  if (diff < 60_000) return 'Just now'
  const date = new Date(ms)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ms >= startOfToday) return timeFormat.format(date)
  if (ms >= startOfToday - 86_400_000) return 'Yesterday'
  if (ms >= startOfToday - 6 * 86_400_000) return weekdayFormat.format(date)
  if (date.getFullYear() === today.getFullYear()) return dateFormat.format(date)
  return fullDateFormat.format(date)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function countWords(text: string): number {
  let count = 0
  let inWord = false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const space = code === 32 || code === 10 || code === 9 || code === 13
    if (space) inWord = false
    else if (!inWord) {
      inWord = true
      count++
    }
  }
  return count
}
