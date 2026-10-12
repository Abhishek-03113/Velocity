/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON envelopes in tests */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localBackend } from './backend'
import { clearLocalMedia, localMediaUrl } from './media'
import * as codec from './codec'
import * as kv from './kv'
import { resetStorageStore, useStorageStore } from '../../store/storageStore'

const { handle } = localBackend()

async function call(method: string, path: string, body?: unknown) {
  const res = await handle(method, path, body === undefined ? '' : JSON.stringify(body))
  const json = (await res.json()) as { success: boolean; data?: any; error?: string }
  return { status: res.status, json }
}

const PNG = 'data:image/png;base64,iVBORw0KGgo='

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  kv.resetUsageCache()
  resetStorageStore()
  clearLocalMedia()
})

describe('notes', () => {
  it('creates, reads, lists and deletes', async () => {
    const created = await call('POST', '/api/pastes', { title: '  Hello  ', content: 'body' })
    expect(created.status).toBe(201)
    expect(created.json.data).toMatchObject({ title: 'Hello', content: 'body', group_id: null })
    const id = created.json.data.id

    expect((await call('GET', `/api/pastes/${id}`)).json.data.content).toBe('body')
    const list = (await call('GET', '/api/pastes')).json.data
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, content_length: 4, is_empty: false, has_whiteboard: 0 })
    expect(list[0]).not.toHaveProperty('content')

    expect((await call('DELETE', `/api/pastes/${id}`)).json.data).toEqual({ id })
    expect((await call('GET', `/api/pastes/${id}`)).status).toBe(404)
    expect((await call('DELETE', `/api/pastes/${id}`)).status).toBe(404)
  })

  it('defaults the title to Untitled and validates ids and groups', async () => {
    expect((await call('POST', '/api/pastes', {})).json.data.title).toBe('Untitled')
    expect((await call('POST', '/api/pastes', { group_id: 99 })).status).toBe(400)
    expect((await call('GET', '/api/pastes/abc')).status).toBe(400)
    expect((await call('GET', '/api/pastes/0')).status).toBe(400)
    expect((await call('GET', '/api/pastes/999')).status).toBe(404)
  })

  it('partial PUT keeps other fields and does not echo content', async () => {
    const group = (await call('POST', '/api/groups', { name: 'Work' })).json.data
    const { id } = (await call('POST', '/api/pastes', { title: 'T', content: 'C' })).json.data

    const put = await call('PUT', `/api/pastes/${id}`, { group_id: group.id })
    expect(put.json.data).toMatchObject({ id, title: 'T', group_id: group.id })
    expect(put.json.data).not.toHaveProperty('content')
    expect((await call('GET', `/api/pastes/${id}`)).json.data.content).toBe('C')

    await call('PUT', `/api/pastes/${id}`, { content: 'new' })
    expect((await call('GET', `/api/pastes/${id}`)).json.data).toMatchObject({ title: 'T', content: 'new', group_id: group.id })

    await call('PUT', `/api/pastes/${id}`, { group_id: null })
    expect((await call('GET', `/api/pastes/${id}`)).json.data.group_id).toBeNull()

    expect((await call('PUT', `/api/pastes/${id}`, {})).status).toBe(400)
    expect((await call('PUT', `/api/pastes/${id}`, { group_id: 999 })).status).toBe(400)
    expect((await call('PUT', '/api/pastes/999', { title: 'x' })).status).toBe(404)
  })

  it('a save writes only that note\'s keys (O(note), never the library)', async () => {
    const a = (await call('POST', '/api/pastes', { content: 'a'.repeat(5000) })).json.data.id
    const b = (await call('POST', '/api/pastes', { content: 'b'.repeat(5000) })).json.data.id
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const get = vi.spyOn(Storage.prototype, 'getItem')
    await call('PUT', `/api/pastes/${a}`, { content: 'changed' })
    const written = set.mock.calls.map((c) => c[0]).sort()
    expect(written).toEqual([`velocity.db.v1.p.${a}.c`, `velocity.db.v1.p.${a}.m`])
    expect(get.mock.calls.some((c) => String(c[0]).includes(`p.${b}.`))).toBe(false)
    // title-only save leaves the body alone
    set.mockClear()
    await call('PUT', `/api/pastes/${a}`, { title: 'renamed' })
    expect(set.mock.calls.map((c) => c[0])).toEqual([`velocity.db.v1.p.${a}.m`])
  })

  it('performs the storage write synchronously inside handle() (pagehide flush)', async () => {
    const { id } = (await call('POST', '/api/pastes', { content: 'x' })).json.data
    void handle('PUT', `/api/pastes/${id}`, JSON.stringify({ content: 'flushed' }))
    // No await yet: the content must already be stored.
    expect(codec.unpack(kv.get(`p.${id}.c`)!)).toBe('flushed')
  })

  it('listing never unpacks bodies', async () => {
    await call('POST', '/api/pastes', { content: 'one' })
    const { id } = (await call('POST', '/api/pastes', { content: 'two' })).json.data
    kv.set(`p.${id}.c`, '?corrupt') // would throw if the list touched bodies
    const spy = vi.spyOn(codec, 'unpack')
    const list = await call('GET', '/api/pastes')
    expect(list.status).toBe(200)
    expect(list.json.data).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()
  })

  it('never reuses ids, even after deletes or a lost counter', async () => {
    const a = (await call('POST', '/api/pastes', {})).json.data.id
    await call('DELETE', `/api/pastes/${a}`)
    const b = (await call('POST', '/api/pastes', {})).json.data.id
    expect(b).toBeGreaterThan(a)
    kv.remove('seq')
    const c = (await call('POST', '/api/pastes', {})).json.data.id
    expect(c).not.toBe(b)
  })

  it('lists newest first', async () => {
    const a = (await call('POST', '/api/pastes', { title: 'a' })).json.data.id
    const b = (await call('POST', '/api/pastes', { title: 'b' })).json.data.id
    expect((await call('GET', '/api/pastes')).json.data.map((r: any) => r.id)).toEqual([b, a])
  })
})

describe('empty notes', () => {
  it('flags blank content and honours only_if_empty', async () => {
    const blank = (await call('POST', '/api/pastes', { content: ' \n\t' })).json.data.id
    const full = (await call('POST', '/api/pastes', { content: 'hi' })).json.data.id
    const named = (await call('POST', '/api/pastes', { title: 'Plan' })).json.data.id
    const rows = Object.fromEntries((await call('GET', '/api/pastes')).json.data.map((r: any) => [r.id, r]))
    expect(rows[blank].is_empty).toBe(true)
    expect(rows[full].is_empty).toBe(false)

    expect((await call('DELETE', `/api/pastes/${full}?only_if_empty=1`)).status).toBe(409)
    expect((await call('DELETE', `/api/pastes/${full}?only_if_empty=1`)).json.error).toBe('Note is not empty')
    expect((await call('DELETE', `/api/pastes/${named}?only_if_empty=1`)).status).toBe(409)
    expect((await call('DELETE', `/api/pastes/${blank}?only_if_empty=1`)).status).toBe(200)
    expect((await call('DELETE', `/api/pastes/${blank}?only_if_empty=1`)).status).toBe(404)
  })

  it('treats a note that gained content as not empty', async () => {
    const { id } = (await call('POST', '/api/pastes', {})).json.data
    await call('PUT', `/api/pastes/${id}`, { content: 'typed' })
    expect((await call('DELETE', `/api/pastes/${id}?only_if_empty=1`)).status).toBe(409)
  })
})

describe('groups', () => {
  it('creates sorted, rejects duplicates, renames', async () => {
    const z = (await call('POST', '/api/groups', { name: 'Zed' })).json.data
    await call('POST', '/api/groups', { name: ' Alpha ' })
    expect((await call('GET', '/api/groups')).json.data.map((g: any) => g.name)).toEqual(['Alpha', 'Zed'])
    expect((await call('POST', '/api/groups', { name: 'Zed' })).status).toBe(409)
    expect((await call('POST', '/api/groups', { name: '  ' })).status).toBe(400)
    expect((await call('PUT', `/api/groups/${z.id}`, { name: 'Alpha' })).status).toBe(409)
    expect((await call('PUT', `/api/groups/${z.id}`, { name: 'Omega' })).json.data.name).toBe('Omega')
    expect((await call('PUT', '/api/groups/99', { name: 'x' })).status).toBe(404)
  })

  it('deleting a group unfiles its notes without deleting them', async () => {
    const g = (await call('POST', '/api/groups', { name: 'G' })).json.data
    const { id } = (await call('POST', '/api/pastes', { title: 'n', group_id: g.id })).json.data
    expect((await call('DELETE', `/api/groups/${g.id}`)).status).toBe(200)
    expect((await call('GET', `/api/pastes/${id}`)).json.data.group_id).toBeNull()
    expect((await call('DELETE', `/api/groups/${g.id}`)).status).toBe(404)
  })
})

describe('whiteboards', () => {
  const scene = { elements: [{ id: 'a' }], appState: {}, files: {} }

  it('404 until saved, then round-trips and shows in the list', async () => {
    const { id } = (await call('POST', '/api/pastes', {})).json.data
    expect((await call('GET', `/api/pastes/${id}/whiteboard`)).status).toBe(404)
    expect((await call('PUT', `/api/pastes/${id}/whiteboard`, { scene })).status).toBe(200)
    const got = (await call('GET', `/api/pastes/${id}/whiteboard`)).json.data
    expect(got.scene).toEqual(scene)
    expect(typeof got.updated_at).toBe('string')
    expect((await call('GET', '/api/pastes')).json.data[0].has_whiteboard).toBe(1)
  })

  it('validates, 404s for unknown notes, and deletes', async () => {
    const { id } = (await call('POST', '/api/pastes', {})).json.data
    expect((await call('PUT', `/api/pastes/${id}/whiteboard`, { scene: {} })).status).toBe(400)
    expect((await handle('PUT', `/api/pastes/${id}/whiteboard`, 'not json')).status).toBe(400)
    expect((await call('PUT', '/api/pastes/999/whiteboard', { scene })).status).toBe(404)
    await call('PUT', `/api/pastes/${id}/whiteboard`, { scene })
    expect((await call('DELETE', `/api/pastes/${id}/whiteboard`)).status).toBe(200)
    expect((await call('DELETE', `/api/pastes/${id}/whiteboard`)).status).toBe(404)
  })

  it('rejects scenes over 10 MB with 413', async () => {
    const { id } = (await call('POST', '/api/pastes', {})).json.data
    const big = { scene: { elements: [], blob: 'x'.repeat(10 * 1024 * 1024 + 2048) } }
    expect((await call('PUT', `/api/pastes/${id}/whiteboard`, big)).status).toBe(413)
  })

  it('deleting a note cascades to its board and content keys', async () => {
    const { id } = (await call('POST', '/api/pastes', { content: 'c' })).json.data
    await call('PUT', `/api/pastes/${id}/whiteboard`, { scene })
    await call('DELETE', `/api/pastes/${id}`)
    expect(kv.keys(`p.${id}.`)).toEqual([])
    expect(kv.keys(`w.${id}`)).toEqual([])
  })
})

describe('assets', () => {
  it('stores image data URLs, dedupes by hash, rejects bad input', async () => {
    const a = await call('POST', '/api/assets', { data_url: PNG })
    expect(a.status).toBe(201)
    expect(a.json.data).toMatchObject({ mime_type: 'image/png', ext: 'png', url: `/api/assets/${a.json.data.id}` })
    const b = await call('POST', '/api/assets', { data_url: PNG })
    expect(b.json.data.id).toBe(a.json.data.id)
    expect((await call('POST', '/api/assets', { data_url: 'data:text/plain;base64,aGk=' })).status).toBe(400)
    expect((await call('POST', '/api/assets', {})).status).toBe(400)
    const huge = `data:image/png;base64,${'A'.repeat(Math.ceil(((5 * 1024 * 1024 + 10) * 4) / 3))}`
    expect((await call('POST', '/api/assets', { data_url: huge })).status).toBe(413)
  })

  it('resolves media to one cached blob: URL per asset and passes unknown ids through', async () => {
    const create = vi.fn(() => 'blob:mock-1')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const { id } = (await call('POST', '/api/assets', { data_url: PNG })).json.data
    expect(localMediaUrl(`/api/assets/${id}`)).toBe('blob:mock-1')
    expect(localMediaUrl(`/api/assets/${id}`)).toBe('blob:mock-1')
    expect(create).toHaveBeenCalledTimes(1)
    expect(localMediaUrl('/api/assets/999')).toBe('/api/assets/999')
    expect(localMediaUrl('/other')).toBe('/other')
    clearLocalMedia()
    expect(revoke).toHaveBeenCalledWith('blob:mock-1')
    delete (URL as any).createObjectURL
    delete (URL as any).revokeObjectURL
  })
})

describe('misc routes and storage errors', () => {
  it('plugins and unknown routes 404', async () => {
    const p = await call('GET', '/api/plugins/blog-reader/fetch?url=x')
    expect(p.status).toBe(404)
    expect(p.json.error).toBe('Not available in the browser-only version')
    expect((await call('GET', '/api/nope')).status).toBe(404)
  })

  it('quota errors become 507 with the full flag, and nothing half-written', async () => {
    const { id } = (await call('POST', '/api/pastes', { content: 'old' })).json.data
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.endsWith('.c')) throw Object.assign(new Error('q'), { name: 'QuotaExceededError', code: 22 })
      return real.call(this, k, v)
    })
    const res = await call('PUT', `/api/pastes/${id}`, { content: 'new' })
    expect(res.status).toBe(507)
    expect(res.json.error).toBe('Browser storage is full')
    expect(useStorageStore.getState().full).toBe(true)
    vi.restoreAllMocks()
    expect((await call('GET', `/api/pastes/${id}`)).json.data.content).toBe('old')
  })

  it('rolls meta/content back together when the second write fails', async () => {
    const { id } = (await call('POST', '/api/pastes', { content: 'old' })).json.data
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.endsWith('.m')) throw Object.assign(new Error('q'), { name: 'QuotaExceededError' })
      return real.call(this, k, v)
    })
    expect((await call('PUT', `/api/pastes/${id}`, { content: 'brand new content' })).status).toBe(507)
    vi.restoreAllMocks()
    expect((await call('GET', `/api/pastes/${id}`)).json.data.content).toBe('old')
  })
})
