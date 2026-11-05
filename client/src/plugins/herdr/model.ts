import type { BadgeTone } from '../types'

/** Shapes returned by the server plugin (server/plugins/herdr). */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'

export interface Agent {
  paneId: string
  name: string | null
  kind: string | null
  title: string | null
  status: AgentStatus
  cwd: string | null
  hasSession: boolean
}

export type TurnStatus = 'sending' | 'working' | 'blocked' | 'done' | 'unconfirmed' | 'failed'
export type SummarySource = 'transcript' | 'screen' | 'final-message' | 'none'

export interface Turn {
  id: number
  status: TurnStatus
  sentAt: string
  startedAt: string | null
  finishedAt: string | null
  sentHashes: string[]
  attachments: Array<{ kind: string; label: string }>
  attachmentsNote: string | null
  askSummary: boolean
  summary: string | null
  summarySource: SummarySource | null
  error: string | null
}

export interface Conversation {
  id: number
  noteId: number | null
  noteTitle: string
  paneId: string
  agentName: string | null
  agentKind: string | null
  agentCwd: string | null
  seen: boolean
  updatedAt: string
  turns: Turn[]
}

export type HerdrEvent =
  | { type: 'agents'; agents: Agent[] }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'connection'; ok: boolean; error?: string }

export type ColumnId = 'shared' | 'working' | 'blockers' | 'completed'

export const COLUMNS: Array<{ id: ColumnId; name: string; tone: BadgeTone; hint: string }> = [
  { id: 'shared', name: 'Shared', tone: 'blue', hint: 'Sent to an agent, not started yet.' },
  { id: 'working', name: 'Working', tone: 'orange', hint: 'The agent is on it.' },
  { id: 'blockers', name: 'Blockers', tone: 'red', hint: 'Waiting for an approval or an answer in herdr.' },
  { id: 'completed', name: 'Completed', tone: 'green', hint: 'Summary ready. Blue dot: not read yet.' },
]

export const lastTurn = (c: Conversation): Turn | undefined => c.turns[c.turns.length - 1]

/** Which column a conversation sits in: its latest turn, with herdr's live state for the agent. */
export function columnOf(c: Conversation, agent?: Agent): ColumnId {
  const t = lastTurn(c)
  if (!t) return 'shared'
  switch (t.status) {
    case 'sending':
    case 'unconfirmed':
      return 'shared'
    case 'working':
      return agent?.status === 'blocked' ? 'blockers' : 'working'
    case 'blocked':
      return 'blockers'
    default:
      return 'completed'
  }
}

export function agentLabel(a: { name: string | null; paneId: string } | undefined, fallbackPane?: string): string {
  if (!a) return fallbackPane ?? 'agent'
  return a.name || a.paneId
}

const KIND_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  copilot: 'Copilot CLI',
  cursor: 'Cursor Agent',
  gemini: 'Gemini CLI',
  pi: 'Pi',
  droid: 'Droid',
  amp: 'Amp',
}

export function kindName(kind: string | null): string {
  if (!kind) return 'Agent'
  return KIND_NAMES[kind] ?? kind
}

export const AGENT_CHIP: Record<AgentStatus, { label: string; tone: BadgeTone }> = {
  idle: { label: 'Ready', tone: 'green' },
  done: { label: 'Done', tone: 'green' },
  working: { label: 'Working', tone: 'orange' },
  unknown: { label: 'Unknown', tone: 'gray' },
  blocked: { label: 'Needs you', tone: 'red' },
}

/** The note's badge in the sidebar list, from its most recent conversation. */
export function badgeFor(c: Conversation, agent?: Agent): { label: string; tone: BadgeTone } {
  const t = lastTurn(c)
  if (t?.status === 'failed') return { label: 'Didn’t finish', tone: 'red' }
  if (t?.status === 'unconfirmed') return { label: 'Check agent', tone: 'gray' }
  switch (columnOf(c, agent)) {
    case 'shared':
      return { label: 'Shared', tone: 'blue' }
    case 'working':
      return { label: 'Working', tone: 'orange' }
    case 'blockers':
      return { label: 'Needs you', tone: 'red' }
    default:
      return c.seen ? { label: 'Summary', tone: 'green' } : { label: 'New summary', tone: 'green' }
  }
}

export function clock(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === today.toDateString() ? hm : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hm}`
}

export function duration(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return ''
  const s = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${m} min`
}
