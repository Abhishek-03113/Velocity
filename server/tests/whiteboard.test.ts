import './setup.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { runMigrations } = await import('../db/migrate.ts')
const { createApp } = await import('../app.ts')
const { db } = await import('../db/client.ts')
runMigrations()
const app = createApp({ log: false })

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, res, json: (await res.json()) as { success: boolean; data?: any; error?: string } }
}

test('whiteboard CRUD with the response envelope', async () => {
  const id = (await call('POST', '/api/pastes', { title: 'Board note' })).json.data.id as number
  assert.equal((await call('GET', `/api/pastes/${id}/whiteboard`)).status, 404)

  const scene = { elements: [{ id: 'a', type: 'rectangle' }], appState: { zoom: 1 }, files: { f: { dataURL: 'x' } } }
  const put = await call('PUT', `/api/pastes/${id}/whiteboard`, { scene })
  assert.equal(put.status, 200)
  assert.equal(put.json.success, true)
  const got = await call('GET', `/api/pastes/${id}/whiteboard`)
  assert.deepEqual(got.json.data.scene, scene)

  // Overwrite replaces the scene.
  await call('PUT', `/api/pastes/${id}/whiteboard`, { scene: { elements: [] } })
  assert.deepEqual((await call('GET', `/api/pastes/${id}/whiteboard`)).json.data.scene, { elements: [] })

  assert.equal((await call('DELETE', `/api/pastes/${id}/whiteboard`)).status, 200)
  assert.equal((await call('DELETE', `/api/pastes/${id}/whiteboard`)).status, 404)
  assert.equal((await call('GET', `/api/pastes/${id}/whiteboard`)).status, 404)
})

test('whiteboard validation and size cap', async () => {
  const id = (await call('POST', '/api/pastes', { title: 'Validation' })).json.data.id as number
  const url = `/api/pastes/${id}/whiteboard`
  assert.equal((await call('PUT', url, {})).status, 400)
  assert.equal((await call('PUT', url, { scene: [] })).status, 400)
  assert.equal((await call('PUT', url, { scene: { elements: 'no' } })).status, 400)
  assert.equal((await call('PUT', url, { scene: { appState: {} } })).status, 400)
  assert.equal((await call('PUT', '/api/pastes/abc/whiteboard', { scene: { elements: [] } })).status, 400)
  assert.equal((await call('PUT', '/api/pastes/999999/whiteboard', { scene: { elements: [] } })).status, 404)

  const bad = await app.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{nope' })
  assert.equal(bad.status, 400)

  const huge = { scene: { elements: [], blob: 'x'.repeat(10 * 1024 * 1024 + 10) } }
  assert.equal((await call('PUT', url, huge)).status, 413)
  assert.equal((await call('GET', url)).status, 404, 'rejected writes store nothing')
})

test('list rows carry has_whiteboard', async () => {
  const id = (await call('POST', '/api/pastes', { title: 'Flagged' })).json.data.id as number
  const flag = async () =>
    (await call('GET', '/api/pastes')).json.data.find((p: { id: number }) => p.id === id).has_whiteboard
  assert.equal(await flag(), 0)
  await call('PUT', `/api/pastes/${id}/whiteboard`, { scene: { elements: [] } })
  assert.equal(await flag(), 1)
  await call('DELETE', `/api/pastes/${id}/whiteboard`)
  assert.equal(await flag(), 0)
})

test('deleting a note cascades to its whiteboard', async () => {
  const id = (await call('POST', '/api/pastes', { title: 'Cascade' })).json.data.id as number
  await call('PUT', `/api/pastes/${id}/whiteboard`, { scene: { elements: [] } })
  const count = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM whiteboards WHERE paste_id = ?').get(id) as { n: number }).n
  assert.equal(count(), 1)
  await call('DELETE', `/api/pastes/${id}`)
  assert.equal(count(), 0)
})

test('whiteboard responses stay gzip-compressed and CORS-enabled', async () => {
  const id = (await call('POST', '/api/pastes', { title: 'Headers' })).json.data.id as number
  const elements = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, type: 'rectangle', x: i, y: i }))
  await call('PUT', `/api/pastes/${id}/whiteboard`, { scene: { elements } })
  const res = await app.request(`/api/pastes/${id}/whiteboard`, {
    headers: { 'Accept-Encoding': 'gzip', Origin: 'http://localhost:5173' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-encoding'), 'gzip')
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173')
})
