import './setup.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { runMigrations } = await import('../db/migrate.ts')
const { createApp } = await import('../app.ts')
const { db } = await import('../db/client.ts')
const { sweepEmptyNotes } = await import('../workers/emptyNoteCleanup.ts')
runMigrations()
const app = createApp({ log: false })

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; error?: string } }
}

const NOW = Date.parse('2030-01-01T12:00:00Z')
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString().replace('T', ' ').slice(0, 19)

function insert(title: string, content: string | null, minutesAgo: number): number {
  const r = db
    .prepare('INSERT INTO pastes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(title, content, iso(minutesAgo), iso(minutesAgo))
  return Number(r.lastInsertRowid)
}

const exists = (id: number) => Boolean(db.prepare('SELECT 1 FROM pastes WHERE id = ?').get(id))

test('list rows expose content_length and is_empty without the body', async () => {
  const empty = (await call('POST', '/api/pastes', {})).json.data.id as number
  const blank = (await call('POST', '/api/pastes', { content: ' \n\t ' })).json.data.id as number
  const full = (await call('POST', '/api/pastes', { content: 'héllo' })).json.data.id as number
  const rows = (await call('GET', '/api/pastes')).json.data as Array<Record<string, any>>
  const by = (id: number) => rows.find((r) => r.id === id)!
  assert.equal(by(empty).is_empty, true)
  assert.equal(by(empty).content_length, 0)
  assert.equal(by(blank).is_empty, true)
  assert.equal(by(blank).content_length, 4)
  assert.equal(by(full).is_empty, false)
  assert.equal(by(full).content_length, 6, 'byte length')
  assert.equal('content' in by(full), false)
  for (const id of [empty, blank, full]) await call('DELETE', `/api/pastes/${id}`)
})

test('DELETE ?only_if_empty=1 refuses notes with content or a title', async () => {
  const full = (await call('POST', '/api/pastes', { content: 'keep me' })).json.data.id as number
  const titled = (await call('POST', '/api/pastes', { title: 'Named' })).json.data.id as number
  const empty = (await call('POST', '/api/pastes', {})).json.data.id as number
  assert.equal((await call('DELETE', `/api/pastes/${full}?only_if_empty=1`)).status, 409)
  assert.equal((await call('DELETE', `/api/pastes/${titled}?only_if_empty=1`)).status, 409)
  assert.equal((await call('DELETE', `/api/pastes/${empty}?only_if_empty=1`)).status, 200)
  assert.equal((await call('DELETE', `/api/pastes/${empty}?only_if_empty=1`)).status, 404)
  assert.ok(exists(full) && exists(titled))
  await call('DELETE', `/api/pastes/${full}`)
  await call('DELETE', `/api/pastes/${titled}`)
})

test('sweep keeps the newest 5 empty notes, spares recent, titled and non-empty ones', () => {
  db.exec('DELETE FROM pastes')
  const empties = [60, 70, 80, 90, 100, 110, 120, 130].map((m) => insert('Untitled', m % 20 ? '' : '  \n', m))
  const recentEmpty = insert('', null, 2) // within 10 minutes: protected, but counts toward the newest 5
  const titled = insert('Shopping', '', 500)
  const withContent = insert('Untitled', 'x', 500)

  const removed = sweepEmptyNotes({ now: NOW })
  // Newest five (by updated_at): recentEmpty, 60, 70, 80, 90 minutes -> kept.
  assert.deepEqual(new Set(removed), new Set(empties.slice(4)))
  for (const id of [recentEmpty, titled, withContent, ...empties.slice(0, 4)]) assert.ok(exists(id), `id ${id}`)

  // Idempotent.
  assert.deepEqual(sweepEmptyNotes({ now: NOW }), [])
})

test('sweep never deletes notes updated within the last 10 minutes', () => {
  db.exec('DELETE FROM pastes')
  const ids = Array.from({ length: 9 }, (_, i) => insert('Untitled', '', i)) // 0..8 minutes ago
  assert.deepEqual(sweepEmptyNotes({ now: NOW }), [])
  for (const id of ids) assert.ok(exists(id))
})

test('sweep protects notes that have a whiteboard', () => {
  db.exec('DELETE FROM pastes')
  db.exec('CREATE TABLE IF NOT EXISTS whiteboards (paste_id INTEGER PRIMARY KEY, scene TEXT)')
  const ids = Array.from({ length: 8 }, (_, i) => insert('Untitled', '', 60 + i))
  const boarded = ids[7]!
  db.prepare('INSERT INTO whiteboards (paste_id, scene) VALUES (?, ?)').run(boarded, '{}')
  const removed = sweepEmptyNotes({ now: NOW })
  assert.ok(exists(boarded))
  // 7 candidates remain after excluding the board; newest 5 kept, 2 removed.
  assert.deepEqual(new Set(removed), new Set([ids[5], ids[6]]))
  db.exec('DROP TABLE whiteboards')
})
