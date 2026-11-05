import type Database from 'better-sqlite3'
import { db } from '../../db/client.ts'
import type { SummarySource } from './summary.ts'

/**
 * Conversations are one note shared with one agent pane; turns are its sends. Velocity keeps only
 * fingerprints of the paragraphs it sent and the agent's summary, never the prompt or transcript.
 */
export function migrate(database: Database.Database = db) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS plugin_herdr_conversations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      paste_id         INTEGER REFERENCES pastes(id) ON DELETE SET NULL,
      note_title       TEXT NOT NULL,
      pane_id          TEXT NOT NULL,
      agent_name       TEXT,
      agent_kind       TEXT,
      agent_session_id TEXT,
      agent_cwd        TEXT,
      seen             INTEGER NOT NULL DEFAULT 1,
      archived         INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_herdr_turns (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id  INTEGER NOT NULL REFERENCES plugin_herdr_conversations(id) ON DELETE CASCADE,
      summary_id       TEXT NOT NULL,
      ask_summary      INTEGER NOT NULL DEFAULT 1,
      sent_hashes      TEXT NOT NULL DEFAULT '[]',
      attachments      TEXT NOT NULL DEFAULT '[]',
      attachments_note TEXT,
      status           TEXT NOT NULL,
      start_seq        INTEGER,
      summary          TEXT,
      summary_source   TEXT,
      error            TEXT,
      sent_at          TEXT NOT NULL,
      started_at       TEXT,
      finished_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS plugin_herdr_turns_conversation ON plugin_herdr_turns(conversation_id);
  `)
}

export type TurnStatus = 'sending' | 'working' | 'blocked' | 'done' | 'unconfirmed' | 'failed'
export const ACTIVE: TurnStatus[] = ['sending', 'working', 'blocked']

export interface ConversationRow {
  id: number
  paste_id: number | null
  note_title: string
  pane_id: string
  agent_name: string | null
  agent_kind: string | null
  agent_session_id: string | null
  agent_cwd: string | null
  seen: number
  archived: number
  created_at: string
  updated_at: string
}

export interface TurnRow {
  id: number
  conversation_id: number
  summary_id: string
  ask_summary: number
  sent_hashes: string
  attachments: string
  attachments_note: string | null
  status: TurnStatus
  start_seq: number | null
  summary: string | null
  summary_source: SummarySource | null
  error: string | null
  sent_at: string
  started_at: string | null
  finished_at: string | null
}

const now = () => new Date().toISOString()

export function findOpenConversation(pasteId: number, paneId: string): ConversationRow | undefined {
  return db
    .prepare('SELECT * FROM plugin_herdr_conversations WHERE paste_id = ? AND pane_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1')
    .get(pasteId, paneId) as ConversationRow | undefined
}

export function createConversation(input: { pasteId: number; title: string; paneId: string; name?: string | null; kind?: string | null; sessionId?: string | null; cwd?: string | null }): ConversationRow {
  const at = now()
  const r = db
    .prepare(
      `INSERT INTO plugin_herdr_conversations (paste_id, note_title, pane_id, agent_name, agent_kind, agent_session_id, agent_cwd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.pasteId, input.title, input.paneId, input.name ?? null, input.kind ?? null, input.sessionId ?? null, input.cwd ?? null, at, at)
  return getConversation(Number(r.lastInsertRowid))!
}

export function updateConversation(id: number, patch: Partial<Pick<ConversationRow, 'note_title' | 'agent_name' | 'agent_kind' | 'agent_session_id' | 'agent_cwd' | 'seen' | 'archived'>>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[]
  if (!keys.length) return
  db.prepare(`UPDATE plugin_herdr_conversations SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`).run({ ...patch, id, updated_at: now() })
}

export function getConversation(id: number): ConversationRow | undefined {
  return db.prepare('SELECT * FROM plugin_herdr_conversations WHERE id = ?').get(id) as ConversationRow | undefined
}

export function createTurn(input: { conversationId: number; summaryId: string; askSummary: boolean; hashes: string[]; startSeq?: number | null }): TurnRow {
  const r = db
    .prepare(
      `INSERT INTO plugin_herdr_turns (conversation_id, summary_id, ask_summary, sent_hashes, status, start_seq, sent_at)
       VALUES (?, ?, ?, ?, 'sending', ?, ?)`,
    )
    .run(input.conversationId, input.summaryId, input.askSummary ? 1 : 0, JSON.stringify(input.hashes), input.startSeq ?? null, now())
  return getTurn(Number(r.lastInsertRowid))!
}

export function getTurn(id: number): TurnRow | undefined {
  return db.prepare('SELECT * FROM plugin_herdr_turns WHERE id = ?').get(id) as TurnRow | undefined
}

export function updateTurn(id: number, patch: Partial<Omit<TurnRow, 'id' | 'conversation_id' | 'summary_id' | 'sent_at'>>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[]
  if (!keys.length) return
  db.prepare(`UPDATE plugin_herdr_turns SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id })
  const turn = getTurn(id)
  if (turn) db.prepare('UPDATE plugin_herdr_conversations SET updated_at = ? WHERE id = ?').run(now(), turn.conversation_id)
}

export function activeTurns(): TurnRow[] {
  return db.prepare(`SELECT * FROM plugin_herdr_turns WHERE status IN ('sending', 'working', 'blocked')`).all() as TurnRow[]
}

export interface ConversationView {
  id: number
  noteId: number | null
  noteTitle: string
  paneId: string
  agentName: string | null
  agentKind: string | null
  agentCwd: string | null
  seen: boolean
  updatedAt: string
  turns: Array<{
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
  }>
}

function parseList<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function viewConversation(c: ConversationRow): ConversationView {
  const turns = db.prepare('SELECT * FROM plugin_herdr_turns WHERE conversation_id = ? ORDER BY id').all(c.id) as TurnRow[]
  return {
    id: c.id,
    noteId: c.paste_id,
    noteTitle: c.note_title,
    paneId: c.pane_id,
    agentName: c.agent_name,
    agentKind: c.agent_kind,
    agentCwd: c.agent_cwd,
    seen: !!c.seen,
    updatedAt: c.updated_at,
    turns: turns.map((t) => ({
      id: t.id,
      status: t.status,
      sentAt: t.sent_at,
      startedAt: t.started_at,
      finishedAt: t.finished_at,
      sentHashes: parseList<string>(t.sent_hashes),
      attachments: parseList<{ kind: string; label: string }>(t.attachments),
      attachmentsNote: t.attachments_note,
      askSummary: !!t.ask_summary,
      summary: t.summary,
      summarySource: t.summary_source,
      error: t.error,
    })),
  }
}

export function listConversations(): ConversationView[] {
  const rows = db.prepare('SELECT * FROM plugin_herdr_conversations WHERE archived = 0 ORDER BY updated_at DESC').all() as ConversationRow[]
  return rows.map(viewConversation)
}

export function archiveSeen(): number {
  return db
    .prepare(
      `UPDATE plugin_herdr_conversations SET archived = 1
       WHERE archived = 0 AND seen = 1 AND id IN (
         SELECT conversation_id FROM plugin_herdr_turns t
         WHERE t.id = (SELECT MAX(id) FROM plugin_herdr_turns WHERE conversation_id = t.conversation_id)
           AND t.status IN ('done', 'failed')
       )`,
    )
    .run().changes
}
