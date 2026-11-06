/**
 * What a send contains. A note is split into paragraphs (blank-line separated, fenced code kept
 * whole). Velocity remembers a fingerprint of each paragraph it sent, never the text, so a follow-up
 * sends only paragraphs it hasn't sent before, and editing an already-sent paragraph doesn't resend
 * it. Outcome sections (summaries added to the note) are never sent back.
 */

export const OUTCOME_PREFIX = '### Outcome · '

/** Split Markdown into paragraphs, keeping fenced code blocks whole and dropping Outcome sections. */
export function splitParagraphs(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let current: string[] = []
  let fence: string | null = null
  let inOutcome = false

  const flush = () => {
    const text = current.join('\n').trim()
    if (text && !inOutcome) out.push(text)
    current = []
  }

  for (const line of lines) {
    if (fence) {
      current.push(line)
      if (line.trim().startsWith(fence)) {
        fence = null
        flush()
      }
      continue
    }
    const heading = /^(#{1,6})\s/.exec(line)
    if (heading) {
      flush()
      if (line.startsWith(OUTCOME_PREFIX)) {
        inOutcome = true
        continue
      }
      // A heading at level 3 or above ends an Outcome section.
      if (heading[1]!.length <= 3) inOutcome = false
    }
    const open = /^\s*(```+|~~~+)/.exec(line)
    if (open) {
      flush()
      fence = open[1]!
      current.push(line)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    current.push(line)
    if (heading) flush()
  }
  flush()
  return out
}

/** A stable fingerprint of a paragraph's text (whitespace-insensitive). cyrb53, as hex. */
export function fingerprint(paragraph: string): string {
  const str = paragraph.replace(/\s+/g, ' ').trim()
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

export interface Outgoing {
  text: string
  hashes: string[]
  paragraphs: number
}

/**
 * The text of the next send. First send to an agent: the title and every paragraph. After that:
 * only paragraphs whose fingerprint isn't in `sent`. A non-empty selection is sent as it is.
 */
export function nextSend(opts: { title: string; markdown: string; sent: Set<string>; first: boolean; selection?: string }): Outgoing | null {
  if (opts.selection?.trim()) return { text: opts.selection.trim(), hashes: [], paragraphs: 1 }
  const paragraphs = splitParagraphs(opts.markdown)
  const pending = opts.first ? paragraphs : paragraphs.filter((p) => !opts.sent.has(fingerprint(p)))
  if (!pending.length) return null
  const body = pending.join('\n\n')
  const text = opts.first && opts.title.trim() ? `${opts.title.trim()}\n\n${body}` : body
  return { text, hashes: pending.map(fingerprint), paragraphs: pending.length }
}

/** The Outcome section added to a note: a heading, then the summary as the agent wrote it. */
export function outcomeSection(agent: string, at: Date, summary: string, finalMessage: boolean): string {
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return `${OUTCOME_PREFIX}${agent} · ${time}${finalMessage ? ' (final message)' : ''}\n\n${summary.trim()}\n`
}
