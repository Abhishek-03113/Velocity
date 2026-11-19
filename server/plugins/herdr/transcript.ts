import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Read-only access to Claude Code's session transcripts (`<config>/projects/<dir>/<id>.jsonl`), the
 * same files Claude Code's /resume picker reads. Velocity opens only the file for the session id herdr
 * reported, and only ever extracts assistant text written after a send. The format is Claude Code's
 * internal one, so parsing is defensive: unknown or malformed lines are skipped.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude')
  return path.join(base, 'projects')
}

export function findTranscript(sessionId: string, projectsDir = claudeProjectsDir()): string | null {
  if (!UUID.test(sessionId)) return null
  let dirs: fs.Dirent[]
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const file = path.join(projectsDir, d.name, `${sessionId}.jsonl`)
    try {
      if (fs.statSync(file).size > 0) return file
    } catch {
      // not in this project folder
    }
  }
  return null
}

interface Entry {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { role?: string; content?: unknown }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('\n')
}

export interface TurnText {
  /** Every top-level assistant text written since the send, joined: where the summary block is searched. */
  all: string
  /** The agent's final message: assistant text after the last user or tool-result entry. */
  final: string
}

/** Assistant text (top level, not sub-agents) written at or after `since`. */
export function assistantTextSince(file: string, since: Date): TurnText {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { all: '', final: '' }
  }
  const all: string[] = []
  let final: string[] = []
  const floor = since.getTime() - 2000
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let e: Entry
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.isSidechain) continue
    const at = e.timestamp ? Date.parse(e.timestamp) : NaN
    if (Number.isFinite(at) && at < floor) continue
    if (e.type === 'user') {
      final = []
      continue
    }
    if (e.type !== 'assistant') continue
    const text = textOf(e.message?.content).trim()
    if (!text) continue
    all.push(text)
    final.push(text)
  }
  return { all: all.join('\n\n'), final: final.join('\n\n') }
}
