import { randomBytes } from 'node:crypto'

/**
 * The summary contract. Each send ends with an instruction asking the agent to finish with a
 * summary between marker lines carrying an id unique to the turn. Velocity keeps that block,
 * whole: no length limit. The instruction itself names both markers inline in one sentence, so a
 * screen read that still shows the prompt never mistakes the instruction for a summary (the parser
 * only accepts markers that sit alone on their own lines).
 */

export function newSummaryId(): string {
  return randomBytes(5).toString('hex')
}

export function summaryInstruction(id: string): string {
  return [
    'When you finish, end your reply with a summary of what you implemented: what changed and why,',
    'files touched, tests run, and anything left to do. Write the opening marker',
    `<velocity-summary id="${id}"> alone on a line, then the summary in Markdown, then the closing`,
    'marker </velocity-summary> alone on a line.',
  ].join(' ')
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The last block with this id in `text`, trimmed, or null. Markers must each sit on their own line. */
export function findSummaryBlock(text: string, id: string): string | null {
  const re = new RegExp(
    `^[ \\t>]*<velocity-summary id="${escapeRe(id)}">[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t>]*</velocity-summary>[ \\t]*$`,
    'gm',
  )
  let last: string | null = null
  for (const m of text.matchAll(re)) last = m[1] ?? ''
  if (last === null) return null
  return dedent(last).trim()
}

/** Screen text often carries a constant left gutter (TUI padding); strip the common indent. */
export function dedent(text: string): string {
  const lines = text.split(/\r?\n/)
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length)
  const min = indents.length ? Math.min(...indents) : 0
  return min ? lines.map((l) => l.slice(min)).join('\n') : text
}

export type SummarySource = 'transcript' | 'screen' | 'final-message' | 'none'

export interface SummaryResult {
  summary: string | null
  source: SummarySource
}
