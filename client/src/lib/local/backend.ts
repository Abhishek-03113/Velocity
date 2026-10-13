/**
 * In-browser stand-in for the Hono server (browser-only runtime).
 *
 * `handle(method, path, bodyText)` mirrors server/routes/*.ts: same paths, JSON envelope
 * `{ success, data?, error? }` and status codes. It is reached only through lib/transport.ts.
 *
 * Contract for the exit-flush path: everything up to the storage write is synchronous. The only
 * `await` in this file is asset hashing (crypto.subtle), so a note PUT fired from `pagehide`
 * has already written to localStorage by the time `handle()` returns its promise.
 */
import * as db from './db'
import { StorageFullError } from './kv'
import { decodeDataUrl } from './media'

/** Excalidraw scenes embed images as data URLs, so the cap is generous (same as the server). */
const MAX_SCENE_BYTES = 10 * 1024 * 1024
/** Decoded image cap (same as the server). */
const MAX_ASSET_BYTES = 5 * 1024 * 1024

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

interface Reply {
  status: number
  body: unknown
}

const ok = (data: unknown, status = 200): Reply => ({ status, body: { success: true, data } })
const fail = (status: number, error: string): Reply => ({ status, body: { success: false, error } })

/** Positive-integer id from a path segment, or null (server: `z.coerce.number().int().positive()`). */
function parseId(s: string | undefined): number | null {
  if (s === undefined || !/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validate an optional nullable group id the way the server's zod schema does. Returns an error message or null. */
function checkGroupId(body: Record<string, unknown>): string | null {
  if (!('group_id' in body) || body.group_id === undefined || body.group_id === null) return null
  const g = body.group_id
  if (typeof g !== 'number' || !Number.isInteger(g) || g <= 0) return 'Invalid payload'
  return db.groupExists(g) ? null : 'Group not found'
}

// --- notes --------------------------------------------------------------------------------

function listPastes(): Reply {
  // Metadata only — bodies are fetched lazily per note, exactly like the server.
  const rows = db.listPasteMetas().map((m) => ({
    id: m.id,
    title: m.title,
    group_id: m.group_id,
    updated_at: m.updated_at,
    content_length: m.content_length,
    is_empty: m.is_empty,
    has_whiteboard: m.has_whiteboard,
  }))
  return ok(rows)
}

function createPaste(raw: string): Reply {
  const body = parseJson(raw)
  if (!isObject(body)) return fail(400, 'Invalid payload')
  if (body.title !== undefined && typeof body.title !== 'string') return fail(400, 'Invalid payload')
  if (body.content !== undefined && typeof body.content !== 'string') return fail(400, 'Invalid payload')
  const groupError = checkGroupId(body)
  if (groupError) return fail(400, groupError)

  const title = (typeof body.title === 'string' ? body.title.trim() : '') || 'Untitled'
  const content = typeof body.content === 'string' ? body.content : ''
  const groupId = typeof body.group_id === 'number' ? body.group_id : null
  const meta = db.createPaste({ title, content, group_id: groupId })
  return ok(
    { id: meta.id, title: meta.title, content, group_id: meta.group_id, created_at: meta.created_at, updated_at: meta.updated_at },
    201,
  )
}

function getPaste(id: number): Reply {
  const meta = db.getPasteMeta(id)
  if (!meta) return fail(404, 'Not found')
  return ok({
    id: meta.id,
    title: meta.title,
    content: db.getPasteContent(id),
    group_id: meta.group_id,
    created_at: meta.created_at,
    updated_at: meta.updated_at,
  })
}

function updatePaste(id: number, raw: string): Reply {
  const body = parseJson(raw)
  if (!isObject(body)) return fail(400, 'Invalid payload')
  if (body.title !== undefined && typeof body.title !== 'string') return fail(400, 'Invalid payload')
  if (body.content !== undefined && typeof body.content !== 'string') return fail(400, 'Invalid payload')
  const keys = ['title', 'content', 'group_id'].filter((k) => k in body && body[k] !== undefined)
  if (keys.length === 0) return fail(400, 'At least one field is required')
  if (!db.getPasteMeta(id)) return fail(404, 'Not found')
  const groupError = checkGroupId(body)
  if (groupError) return fail(400, groupError)

  const meta = db.updatePaste(id, {
    title: body.title as string | undefined,
    content: body.content as string | undefined,
    ...('group_id' in body ? { group_id: (body.group_id as number | null | undefined) ?? null } : {}),
  })
  if (!meta) return fail(404, 'Not found')
  // Autosave sends the body on every save — don't echo it back.
  return ok({ id: meta.id, title: meta.title, group_id: meta.group_id, created_at: meta.created_at, updated_at: meta.updated_at })
}

function deletePaste(id: number, query: URLSearchParams): Reply {
  if (query.get('only_if_empty') === '1') {
    // Automatic cleanup: refuse to delete a note that has gained content or a title.
    const meta = db.getPasteMeta(id)
    if (!meta) return fail(404, 'Not found')
    const t = (meta.title ?? '').trim()
    if (!meta.is_empty || (t !== '' && t !== 'Untitled')) return fail(409, 'Note is not empty')
  }
  if (!db.deletePaste(id)) return fail(404, 'Not found')
  return ok({ id })
}

// --- groups -------------------------------------------------------------------------------

function groupName(raw: string): { name: string } | { error: string } {
  const body = parseJson(raw)
  if (!isObject(body) || typeof body.name !== 'string') return { error: 'Invalid payload' }
  const name = body.name.trim()
  return name ? { name } : { error: 'name is required' }
}

function listGroups(): Reply {
  // Server: ORDER BY name ASC.
  return ok([...db.listGroups()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
}

function createGroup(raw: string): Reply {
  const parsed = groupName(raw)
  if ('error' in parsed) return fail(400, parsed.error)
  const group = db.createGroup(parsed.name)
  return group === 'duplicate' ? fail(409, 'Group name already exists') : ok(group, 201)
}

function renameGroup(id: number, raw: string): Reply {
  const parsed = groupName(raw)
  if ('error' in parsed) return fail(400, parsed.error)
  const group = db.renameGroup(id, parsed.name)
  if (group === null) return fail(404, 'Not found')
  return group === 'duplicate' ? fail(409, 'Group name already exists') : ok(group)
}

function deleteGroup(id: number): Reply {
  return db.deleteGroup(id) ? ok({ id }) : fail(404, 'Not found')
}

// --- whiteboards --------------------------------------------------------------------------

function getBoard(id: number): Reply {
  const board = db.getBoard(id)
  return board ? ok(board) : fail(404, 'Not found')
}

function putBoard(id: number, raw: string): Reply {
  // Char length is a lower bound on bytes; cheap pre-check before parsing a huge body.
  if (raw.length > MAX_SCENE_BYTES + 1024) return fail(413, 'Whiteboard too large')
  const body = parseJson(raw)
  if (body === null) return fail(400, 'Invalid JSON')
  const scene = isObject(body) ? body.scene : undefined
  if (!isObject(scene) || !Array.isArray(scene.elements)) {
    return fail(400, 'scene must be an object with an elements array')
  }
  const serialized = JSON.stringify(scene)
  if (db.utf8Length(serialized) > MAX_SCENE_BYTES) return fail(413, 'Whiteboard too large')
  if (!db.getPasteMeta(id)) return fail(404, 'Not found')
  db.putBoard(id, serialized)
  return ok({ id })
}

function deleteBoard(id: number): Reply {
  return db.deleteBoard(id) ? ok({ id }) : fail(404, 'Not found')
}

// --- assets -------------------------------------------------------------------------------

/** Lowercase hex SHA-256 via WebCrypto; a cheap non-crypto fallback if `subtle` is missing (insecure context). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // cyrb53 — dedupe only needs a stable fingerprint here.
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i]!, 2654435761)
    h2 = Math.imul(h2 ^ bytes[i]!, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `x${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}${bytes.length.toString(16)}`
}

const publicAsset = (a: db.AssetMeta) => ({
  id: a.id,
  mime_type: a.mime_type,
  ext: a.ext,
  byte_size: a.byte_size,
  sha256: a.sha256,
  url: `/api/assets/${a.id}`,
  created_at: a.created_at,
})

async function createAsset(raw: string): Promise<Reply> {
  const body = parseJson(raw)
  if (!isObject(body) || typeof body.data_url !== 'string' || !body.data_url) return fail(400, 'Invalid payload')
  const dataUrl = body.data_url.trim()
  const decoded = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(dataUrl) ? decodeDataUrl(dataUrl) : null
  const ext = decoded ? MIME_EXT[decoded.mime.toLowerCase()] : undefined
  if (!decoded || !ext || decoded.bytes.length === 0) return fail(400, 'Invalid or unsupported image data URL')
  if (decoded.bytes.length > MAX_ASSET_BYTES) return fail(413, 'Image exceeds 5MB limit')

  const sha256 = await sha256Hex(decoded.bytes)
  const existing = db.findAssetBySha(sha256)
  if (existing) return ok(publicAsset(existing), 201)
  const meta = db.createAsset(
    { mime_type: decoded.mime, ext, byte_size: decoded.bytes.length, sha256 },
    dataUrl.replace(/\s+/g, ''),
  )
  return ok(publicAsset(meta), 201)
}

// --- router -------------------------------------------------------------------------------

function route(method: string, path: string, body: string): Reply | Promise<Reply> {
  const url = new URL(path, 'http://local')
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'pastes', '1', 'whiteboard']
  if (parts[0] !== 'api') return fail(404, 'Not found')
  const [, resource, idPart, sub] = parts

  if (resource === 'plugins') return fail(404, 'Not available in the browser-only version')

  if (resource === 'pastes') {
    if (parts.length === 2) {
      if (method === 'GET') return listPastes()
      if (method === 'POST') return createPaste(body)
    } else if (parts.length === 3 || (parts.length === 4 && sub === 'whiteboard')) {
      const id = parseId(idPart)
      if (id === null) return fail(400, 'Invalid id')
      if (parts.length === 4) {
        if (method === 'GET') return getBoard(id)
        if (method === 'PUT') return putBoard(id, body)
        if (method === 'DELETE') return deleteBoard(id)
      } else {
        if (method === 'GET') return getPaste(id)
        if (method === 'PUT') return updatePaste(id, body)
        if (method === 'DELETE') return deletePaste(id, url.searchParams)
      }
    }
  } else if (resource === 'groups') {
    if (parts.length === 2) {
      if (method === 'GET') return listGroups()
      if (method === 'POST') return createGroup(body)
    } else if (parts.length === 3) {
      const id = parseId(idPart)
      if (id === null) return fail(400, 'Invalid id')
      if (method === 'PUT') return renameGroup(id, body)
      if (method === 'DELETE') return deleteGroup(id)
    }
  } else if (resource === 'assets') {
    if (parts.length === 2 && method === 'POST') return createAsset(body)
    // GET /api/assets/:id is not served here: <img> srcs are rewritten to blob: URLs (media.ts).
  }
  return fail(404, 'Not found')
}

/**
 * Minimal `Response` stand-in whose body reads resolve immediately. A real `Response` reads its body
 * through a stream that takes extra event-loop tasks; during that gap a reload could fire `pagehide`
 * before the client has swapped a temp id for the real one (e.g. a note moved into a new folder),
 * and that change would be lost. With this, the whole create → remap chain finishes in microtasks of
 * the task that made the request.
 */
function localResponse(reply: Reply): Response {
  const text = JSON.stringify(reply.body)
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () => Promise.resolve(JSON.parse(text) as unknown),
    text: () => Promise.resolve(text),
  } as unknown as Response
}

function failureFor(err: unknown): Reply {
  return err instanceof StorageFullError
    ? fail(507, 'Browser storage is full')
    : fail(500, err instanceof Error ? err.message : 'Local storage error')
}

/** Run a request against the local database. Storage writes happen synchronously inside this call. */
function handle(method: string, path: string, body = ''): Promise<Response> {
  let result: Reply | Promise<Reply>
  try {
    result = route(method.toUpperCase(), path, body)
  } catch (err) {
    return Promise.resolve(localResponse(failureFor(err)))
  }
  // Only asset uploads are async (hashing); everything else resolves without an extra hop.
  if (result instanceof Promise) return result.then(localResponse, (err: unknown) => localResponse(failureFor(err)))
  return Promise.resolve(localResponse(result))
}

const backend = { handle }

export function localBackend(): { handle: typeof handle } {
  return backend
}
