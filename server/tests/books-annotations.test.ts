import { TEST_ROOT } from './setup.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

const { createApp } = await import('../app.ts')
const { db } = await import('../db/client.ts')
const app = createApp({ log: false })

const BASE = '/api/plugins/books'
const json = async (res: Response) => (await res.json()) as any

let n = 0
async function newBook(): Promise<number> {
  const res = await app.request(BASE, {
    method: 'POST',
    body: Buffer.from(`%PDF-1.4\n% annotations ${++n}\n%%EOF\n`),
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': `a${n}.pdf` },
  })
  assert.equal(res.status, 201)
  return (await json(res)).data.book.id
}

const send = (method: string, url: string, body?: unknown) =>
  app.request(`${BASE}${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

const hl = (over: Record<string, unknown> = {}) => ({
  kind: 'highlight',
  locator: 'loc-1',
  text: 'Some passage',
  note: null,
  color: 'yellow',
  style: 'highlight',
  chapter: 'Chapter 1',
  progress: 0.1,
  page: 3,
  ...over,
})

const bm = (over: Record<string, unknown> = {}) => ({
  kind: 'bookmark',
  locator: 'pos-1',
  text: null,
  note: null,
  color: null,
  style: null,
  chapter: null,
  progress: 0.2,
  page: null,
  ...over,
})

test('creates a highlight (201) and a bookmark (201)', async () => {
  const id = await newBook()
  const r1 = await send('POST', `/${id}/annotations`, hl())
  assert.equal(r1.status, 201)
  const h = (await json(r1)).data
  assert.equal(r1.headers.get('content-type')?.includes('json'), true)
  assert.equal(h.book_id, id)
  assert.equal(h.kind, 'highlight')
  assert.equal(h.text, 'Some passage')
  assert.equal(h.color, 'yellow')
  assert.equal(h.page, 3)
  assert.ok(h.created_at && h.updated_at)

  // Bookmark may omit color/style; stored as null.
  const { color: _c, style: _s, ...bare } = bm()
  const r2 = await send('POST', `/${id}/annotations`, bare)
  assert.equal(r2.status, 201)
  const b = (await json(r2)).data
  assert.equal(b.kind, 'bookmark')
  assert.equal(b.color, null)
  assert.equal(b.style, null)
  assert.equal(b.text, null)
})

test('bookmark dedupes by locator (200, same id); highlights do not dedupe', async () => {
  const id = await newBook()
  const first = await send('POST', `/${id}/annotations`, bm())
  assert.equal(first.status, 201)
  const a = (await json(first)).data
  const second = await send('POST', `/${id}/annotations`, bm({ chapter: 'other' }))
  assert.equal(second.status, 200)
  assert.equal((await json(second)).data.id, a.id)
  const other = await send('POST', `/${id}/annotations`, bm({ locator: 'pos-2' }))
  assert.equal(other.status, 201)
  assert.equal((await send('POST', `/${id}/annotations`, hl())).status, 201)
  assert.equal((await send('POST', `/${id}/annotations`, hl())).status, 201)
  // Same locator on another book is independent.
  const id2 = await newBook()
  assert.equal((await send('POST', `/${id2}/annotations`, bm())).status, 201)
})

test('lists ordered by progress, created_at, id', async () => {
  const id = await newBook()
  const mk = async (body: object) => (await json(await send('POST', `/${id}/annotations`, body))).data.id as number
  const late = await mk(hl({ locator: 'a', progress: 0.9 }))
  const tieA = await mk(hl({ locator: 'b', progress: 0.5 }))
  const early = await mk(bm({ locator: 'c', progress: 0.1 }))
  const tieB = await mk(hl({ locator: 'd', progress: 0.5 }))
  const res = await send('GET', `/${id}/annotations`)
  assert.equal(res.status, 200)
  const ids = (await json(res)).data.map((x: any) => x.id)
  assert.deepEqual(ids, [early, tieA, tieB, late])
})

test('patch note, color and style; bumps updated_at', async () => {
  const id = await newBook()
  const h = (await json(await send('POST', `/${id}/annotations`, hl()))).data
  db.prepare("UPDATE plugin_book_annotations SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(h.id)
  const res = await send('PATCH', `/${id}/annotations/${h.id}`, { note: 'hello', color: 'pink', style: 'underline' })
  assert.equal(res.status, 200)
  const p = (await json(res)).data
  assert.equal(p.note, 'hello')
  assert.equal(p.color, 'pink')
  assert.equal(p.style, 'underline')
  assert.notEqual(p.updated_at, '2000-01-01 00:00:00')
  assert.equal(p.text, h.text)
  const cleared = (await json(await send('PATCH', `/${id}/annotations/${h.id}`, { note: null }))).data
  assert.equal(cleared.note, null)
  assert.equal(cleared.color, 'pink')
})

test('patch color/style on a bookmark is 400; note is allowed', async () => {
  const id = await newBook()
  const b = (await json(await send('POST', `/${id}/annotations`, bm()))).data
  assert.equal((await send('PATCH', `/${id}/annotations/${b.id}`, { color: 'blue' })).status, 400)
  assert.equal((await send('PATCH', `/${id}/annotations/${b.id}`, { style: 'strike' })).status, 400)
  const ok = await send('PATCH', `/${id}/annotations/${b.id}`, { note: 'remember' })
  assert.equal(ok.status, 200)
  assert.equal((await json(ok)).data.note, 'remember')
})

test('patch validation is strict', async () => {
  const id = await newBook()
  const h = (await json(await send('POST', `/${id}/annotations`, hl()))).data
  for (const body of [{ locator: 'x' }, { color: 'red' }, { style: 'bold' }, { note: 'x'.repeat(10001) }, { color: null }]) {
    const res = await send('PATCH', `/${id}/annotations/${h.id}`, body)
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40))
    const j = await json(res)
    assert.equal(j.success, false)
    assert.equal(typeof j.error, 'string')
  }
})

test('create validation errors return 400 with a message', async () => {
  const id = await newBook()
  const cases: Array<[string, unknown]> = [
    ['no kind', { locator: 'x', progress: 0 }],
    ['bad kind', hl({ kind: 'note' })],
    ['empty locator', hl({ locator: '' })],
    ['long locator', hl({ locator: 'x'.repeat(4001) })],
    ['hl missing text', hl({ text: undefined })],
    ['hl empty text', hl({ text: '' })],
    ['hl null text', hl({ text: null })],
    ['hl missing color', hl({ color: undefined })],
    ['hl bad color', hl({ color: 'red' })],
    ['hl missing style', hl({ style: undefined })],
    ['hl null style', hl({ style: null })],
    ['long note', hl({ note: 'x'.repeat(10001) })],
    ['long chapter', hl({ chapter: 'x'.repeat(301) })],
    ['progress > 1', hl({ progress: 1.5 })],
    ['progress < 0', hl({ progress: -0.1 })],
    ['page 0', hl({ page: 0 })],
    ['page fraction', hl({ page: 1.5 })],
    ['unknown field', hl({ extra: 1 })],
    ['bookmark with color', bm({ color: 'yellow' })],
    ['bookmark with style', bm({ style: 'underline' })],
  ]
  for (const [label, body] of cases) {
    const res = await send('POST', `/${id}/annotations`, body)
    assert.equal(res.status, 400, label)
    const j = await json(res)
    assert.equal(j.success, false, label)
    assert.ok(j.error, label)
  }
  const bad = await app.request(`${BASE}/${id}/annotations`, { method: 'POST', body: '{nope' })
  assert.equal(bad.status, 400)
  assert.deepEqual((await json(await send('GET', `/${id}/annotations`))).data, [])
})

test('404s: missing book, annotation of another book', async () => {
  const a = await newBook()
  const b = await newBook()
  const h = (await json(await send('POST', `/${a}/annotations`, hl()))).data
  assert.equal((await send('GET', '/99999/annotations')).status, 404)
  assert.equal((await send('POST', '/99999/annotations', hl())).status, 404)
  assert.equal((await send('PATCH', `/99999/annotations/${h.id}`, { note: 'x' })).status, 404)
  assert.equal((await send('DELETE', `/99999/annotations/${h.id}`)).status, 404)
  assert.equal((await send('DELETE', '/99999/annotations?kind=highlight')).status, 404)
  assert.equal((await send('GET', '/abc/annotations')).status, 404)
  // Annotation belongs to book a, not b.
  assert.equal((await send('PATCH', `/${b}/annotations/${h.id}`, { note: 'x' })).status, 404)
  assert.equal((await send('DELETE', `/${b}/annotations/${h.id}`)).status, 404)
  assert.equal((await send('PATCH', `/${a}/annotations/99999`, { note: 'x' })).status, 404)
  assert.equal((await send('DELETE', `/${a}/annotations/99999`)).status, 404)
  assert.equal((await json(await send('GET', `/${a}/annotations`))).data.length, 1)
  assert.deepEqual((await json(await send('GET', `/${b}/annotations`))).data, [])
})

test('deletes one annotation', async () => {
  const id = await newBook()
  const h = (await json(await send('POST', `/${id}/annotations`, hl()))).data
  const res = await send('DELETE', `/${id}/annotations/${h.id}`)
  assert.equal(res.status, 200)
  assert.deepEqual(await json(res), { success: true, data: { id: h.id } })
  assert.equal((await send('DELETE', `/${id}/annotations/${h.id}`)).status, 404)
})

test('clear all by kind', async () => {
  const id = await newBook()
  const other = await newBook()
  await send('POST', `/${id}/annotations`, hl({ locator: 'a' }))
  await send('POST', `/${id}/annotations`, hl({ locator: 'b' }))
  await send('POST', `/${id}/annotations`, bm({ locator: 'c' }))
  await send('POST', `/${other}/annotations`, hl())
  assert.equal((await send('DELETE', `/${id}/annotations`)).status, 400)
  assert.equal((await send('DELETE', `/${id}/annotations?kind=note`)).status, 400)
  const res = await send('DELETE', `/${id}/annotations?kind=highlight`)
  assert.equal(res.status, 200)
  assert.deepEqual((await json(res)).data, { deleted: 2 })
  const left = (await json(await send('GET', `/${id}/annotations`))).data
  assert.deepEqual(left.map((x: any) => x.kind), ['bookmark'])
  assert.deepEqual((await json(await send('DELETE', `/${id}/annotations?kind=highlight`))).data, { deleted: 0 })
  assert.deepEqual((await json(await send('DELETE', `/${id}/annotations?kind=bookmark`))).data, { deleted: 1 })
  assert.equal((await json(await send('GET', `/${other}/annotations`))).data.length, 1)
})

test('deleting a book cascades to its annotations', async () => {
  const id = await newBook()
  const keep = await newBook()
  await send('POST', `/${id}/annotations`, hl())
  await send('POST', `/${id}/annotations`, bm())
  await send('POST', `/${keep}/annotations`, hl())
  const count = (bookId: number) =>
    (db.prepare('SELECT COUNT(*) AS c FROM plugin_book_annotations WHERE book_id = ?').get(bookId) as { c: number }).c
  assert.equal(count(id), 2)
  assert.equal((await send('DELETE', `/${id}`)).status, 200)
  assert.equal(count(id), 0)
  assert.equal(count(keep), 1)
})

test('annotation routes do not shadow /:id and /:id/file (and vice versa)', async () => {
  const id = await newBook()
  const book = await send('GET', `/${id}`)
  assert.equal(book.status, 200)
  assert.equal((await json(book)).data.id, id)
  const file = await send('GET', `/${id}/file`)
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'application/pdf')
  assert.match(await file.text(), /^%PDF/)
  const list = await send('GET', '')
  assert.equal(list.status, 200)
  assert.ok(Array.isArray((await json(list)).data))
  const patched = await send('PATCH', `/${id}`, { status: 'reading' })
  assert.equal(patched.status, 200)
  assert.equal((await json(patched)).data.status, 'reading')
  assert.equal((await send('GET', `/${id}/annotations`)).status, 200)
  assert.ok(existsSync(path.join(TEST_ROOT, 'books', `${id}.pdf`)))
})

test('migration created the table and index', () => {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_book_annotations'").get()
  const i = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='plugin_book_annotations_book'").get()
  assert.ok(t && i)
})
