import './setup.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { runMigrations } = await import('../db/migrate.ts')
const { createApp } = await import('../app.ts')
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

test('paste CRUD uses the response envelope', async () => {
  const created = await call('POST', '/api/pastes', { title: 'Hello', content: '# Hi' })
  assert.equal(created.status, 201)
  assert.equal(created.json.success, true)
  const id = created.json.data.id as number

  const list = await call('GET', '/api/pastes')
  assert.ok(list.json.data.some((p: { id: number }) => p.id === id))
  assert.equal('content' in list.json.data[0], false, 'list stays metadata-only')

  const got = await call('GET', `/api/pastes/${id}`)
  assert.equal(got.json.data.content, '# Hi')

  const updated = await call('PUT', `/api/pastes/${id}`, { content: 'changed' })
  assert.equal(updated.status, 200)
  assert.equal('content' in updated.json.data, false, 'autosave responses do not echo the body')
  assert.equal((await call('GET', `/api/pastes/${id}`)).json.data.content, 'changed')

  // Partial update keeps other fields
  await call('PUT', `/api/pastes/${id}`, { title: 'Renamed' })
  const after = (await call('GET', `/api/pastes/${id}`)).json.data
  assert.equal(after.title, 'Renamed')
  assert.equal(after.content, 'changed')

  const deleted = await call('DELETE', `/api/pastes/${id}`)
  assert.equal(deleted.json.success, true)
  assert.equal((await call('GET', `/api/pastes/${id}`)).status, 404)
})

test('validation rejects bad input', async () => {
  assert.equal((await call('PUT', '/api/pastes/abc', { title: 'x' })).status, 400)
  assert.equal((await call('PUT', '/api/pastes/1', {})).status, 400)
  assert.equal((await call('POST', '/api/pastes', { group_id: -1 })).status, 400)
  assert.equal((await call('POST', '/api/pastes', { group_id: 99999 })).status, 400)
  assert.equal((await call('POST', '/api/groups', { name: '  ' })).status, 400)
})

test('group CRUD; deleting a group unfiles its notes', async () => {
  const group = (await call('POST', '/api/groups', { name: 'Work' })).json.data
  assert.equal((await call('POST', '/api/groups', { name: 'Work' })).status, 409)
  const renamed = await call('PUT', `/api/groups/${group.id}`, { name: 'Projects' })
  assert.equal(renamed.json.data.name, 'Projects')

  const paste = (await call('POST', '/api/pastes', { title: 'In group', group_id: group.id })).json.data
  await call('DELETE', `/api/groups/${group.id}`)
  const after = (await call('GET', `/api/pastes/${paste.id}`)).json.data
  assert.equal(after.group_id, null)
  assert.equal(after.title, 'In group', 'notes are never cascade-deleted')
})

test('large note bodies are gzip-compressed', async () => {
  const content = 'lorem ipsum '.repeat(5000)
  const id = (await call('POST', '/api/pastes', { title: 'Big', content })).json.data.id
  const res = await app.request(`/api/pastes/${id}`, { headers: { 'Accept-Encoding': 'gzip' } })
  assert.equal(res.headers.get('content-encoding'), 'gzip')
})
