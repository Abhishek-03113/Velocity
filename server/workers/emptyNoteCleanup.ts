/**
 * Server-side safety net for empty-note cleanup.
 *
 * The client already prunes empty, unnamed, inactive notes (LRU, keep 5) while it is
 * open. This sweep covers notes nobody has open any more (closed browser, other
 * devices) using only what the server knows:
 *
 *  - A note is a candidate when its content is blank (empty or whitespace-only), its
 *    title is blank or "Untitled", and it has no whiteboard.
 *  - Candidates are ranked by `updated_at` (newest first). The newest `KEEP` are
 *    always kept; the rest are deleted, EXCEPT notes touched within the last
 *    `MIN_AGE_MS` (10 minutes) because a client may still hold them open.
 *  - Whiteboards: if the schema has a `pastes.has_whiteboard` column, or a
 *    `whiteboards` table keyed by note, those notes are protected. If a
 *    `whiteboards` table exists but its key column can't be identified, the sweep
 *    aborts rather than risk deleting a board.
 *
 * Runs on startup and hourly. Disable with EMPTY_NOTE_CLEANUP=off.
 */
import { db } from '../db/client.ts'
import { BLANK_CONTENT_SQL } from '../routes/pastes.ts'
import { requestMarkdownSync } from './markdownSync.ts'

export const KEEP_EMPTY_NOTES = 5
export const MIN_AGE_MS = 10 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

const UNNAMED_SQL = `(title IS NULL OR trim(title) = '' OR trim(title) = 'Untitled')`

export interface SweepOptions {
  keep?: number
  minAgeMs?: number
  now?: number
}

function columns(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
}

/** SQL predicate that is true for notes carrying a whiteboard, or 'unknown' if the schema is unrecognised. */
function whiteboardGuard(): { sql: string } | 'unknown' {
  const parts: string[] = []
  if (columns('pastes').includes('has_whiteboard')) parts.push('COALESCE(has_whiteboard, 0) <> 0')
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'whiteboards'")
    .get()
  if (table) {
    const cols = columns('whiteboards')
    const key = ['paste_id', 'note_id'].find((c) => cols.includes(c))
    if (!key) return 'unknown'
    parts.push(`id IN (SELECT ${key} FROM whiteboards)`)
  }
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '0' }
}

function parseSqliteTimestamp(value: string | null): number {
  if (!value) return 0
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

/** Delete surplus empty notes. Returns the ids removed. */
export function sweepEmptyNotes(opts: SweepOptions = {}): number[] {
  const keep = opts.keep ?? KEEP_EMPTY_NOTES
  const minAge = opts.minAgeMs ?? MIN_AGE_MS
  const now = opts.now ?? Date.now()

  const guard = whiteboardGuard()
  if (guard === 'unknown') {
    console.error(`[${new Date().toISOString()}] empty-note sweep skipped: unrecognised whiteboards schema`)
    return []
  }

  const rows = db
    .prepare(
      `SELECT id, updated_at FROM pastes
       WHERE ${BLANK_CONTENT_SQL} AND ${UNNAMED_SQL} AND NOT ${guard.sql}
       ORDER BY updated_at DESC, id DESC`
    )
    .all() as Array<{ id: number; updated_at: string | null }>

  const doomed = rows
    .slice(keep)
    .filter((r) => now - parseSqliteTimestamp(r.updated_at) >= minAge)
    .map((r) => r.id)
  if (doomed.length === 0) return []

  // Re-check emptiness inside the delete so a racing save can never lose content.
  const del = db.prepare(`DELETE FROM pastes WHERE id = ? AND ${BLANK_CONTENT_SQL} AND ${UNNAMED_SQL}`)
  const removed: number[] = []
  db.transaction(() => {
    for (const id of doomed) if (del.run(id).changes > 0) removed.push(id)
  })()
  // Lets the Markdown export drop any file/asset folder for the deleted notes.
  for (const id of removed) requestMarkdownSync(id)
  return removed
}

export function startEmptyNoteCleanup(): void {
  if (process.env.EMPTY_NOTE_CLEANUP === 'off') return
  const run = () => {
    try {
      const removed = sweepEmptyNotes()
      if (removed.length) {
        console.log(`[${new Date().toISOString()}] empty-note sweep removed ${removed.length} note(s)`)
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] empty-note sweep failure:`, error)
    }
  }
  run()
  setInterval(run, SWEEP_INTERVAL_MS).unref()
}
