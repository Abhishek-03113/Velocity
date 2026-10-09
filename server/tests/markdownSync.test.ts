import { TEST_ROOT } from './setup.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

const { runMigrations } = await import('../db/migrate.ts')
const { db } = await import('../db/client.ts')
const { storeImageBuffer } = await import('../db/assets.ts')
const sync = await import('../workers/markdownSync.ts')
runMigrations()

const docs = path.join(TEST_ROOT, 'docs')
const files = () => (existsSync(docs) ? readdirSync(docs).filter((f) => f.endsWith('.md')).sort() : [])

function insert(title: string, content: string): number {
  return Number(db.prepare('INSERT INTO pastes (title, content) VALUES (?, ?)').run(title, content).lastInsertRowid)
}

function update(id: number, fields: { title?: string; content?: string }) {
  db.prepare(
    `UPDATE pastes SET title = COALESCE(?, title), content = COALESCE(?, content), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(fields.title ?? null, fields.content ?? null, id)
}

test('exports notes, deriving names for untitled notes and skipping empty ones', async () => {
  const a = insert('Plan', '# Plan\nbody')
  const b = insert('Untitled', '# Shopping list\n- milk')
  insert('Untitled', '')
  await sync.syncMarkdowns()
  assert.deepEqual(files(), [`${a} - Plan.md`, `${b} - Shopping list.md`])
  assert.equal(readFileSync(path.join(docs, `${a} - Plan.md`), 'utf8'), '# Plan\nbody')
})

test('rewrites edits made within the same second (dirty ids beat timestamps)', async () => {
  const id = insert('Fast', 'v1')
  await sync.syncMarkdowns()
  // Same updated_at second, but the route marks the id dirty.
  db.prepare('UPDATE pastes SET content = ? WHERE id = ?').run('v2', id)
  sync.requestMarkdownSync(id)
  await new Promise((r) => setTimeout(r, 900))
  await sync.syncMarkdowns()
  assert.equal(readFileSync(path.join(docs, `${id} - Fast.md`), 'utf8'), 'v2')
})

test('renames remove the stale file; deletes remove file and assets', async () => {
  const id = insert('Old name', 'text')
  await sync.syncMarkdowns()
  assert.ok(files().includes(`${id} - Old name.md`))

  update(id, { title: 'New name' })
  sync.requestMarkdownSync(id)
  await sync.syncMarkdowns()
  assert.ok(files().includes(`${id} - New name.md`))
  assert.ok(!files().includes(`${id} - Old name.md`))

  db.prepare('DELETE FROM pastes WHERE id = ?').run(id)
  await sync.syncMarkdowns()
  assert.ok(!files().some((f) => f.startsWith(`${id} - `)))
})

test('unchanged notes are not rewritten', async () => {
  const id = insert('Stable', 'same')
  await sync.syncMarkdowns()
  const file = path.join(docs, `${id} - Stable.md`)
  const before = statSync(file).mtimeMs
  await new Promise((r) => setTimeout(r, 20))
  sync.requestMarkdownSync(id) // dirty but content identical
  await sync.syncMarkdowns()
  assert.equal(statSync(file).mtimeMs, before)
})

test('copies /api/assets images next to the export with relative links', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const asset = storeImageBuffer('image/png', png)
  const id = insert('With image', `Look:\n![dot](/api/assets/${asset.id})`)
  await sync.syncMarkdowns()
  const md = readFileSync(path.join(docs, `${id} - With image.md`), 'utf8')
  assert.equal(md, `Look:\n![dot](assets/${id}/${asset.id}.png)`)
  assert.ok(existsSync(path.join(docs, 'assets', String(id), `${asset.id}.png`)))
})

test('after a restart, adopts existing files and removes orphans', async () => {
  const id = insert('Survivor', 'kept')
  await sync.syncMarkdowns()
  const file = path.join(docs, `${id} - Survivor.md`)
  const before = statSync(file).mtimeMs

  // Orphan from a note deleted while the server was down, plus a stale rename.
  mkdirSync(docs, { recursive: true })
  writeFileSync(path.join(docs, '99999 - Ghost.md'), 'boo')
  writeFileSync(path.join(docs, `${id} - Survivor (old).md`), 'stale')
  sync.resetMarkdownSyncState()
  await new Promise((r) => setTimeout(r, 20))
  await sync.syncMarkdowns()

  assert.ok(!existsSync(path.join(docs, '99999 - Ghost.md')))
  assert.equal(files().filter((f) => f.startsWith(`${id} - `)).length, 1)
  assert.ok(existsSync(file))
  assert.equal(readFileSync(file, 'utf8'), 'kept')
  assert.ok(statSync(file).mtimeMs >= before)
})
