/**
 * In-browser "database" on top of kv.ts. Mirrors the SQLite schema, but one key per record so a
 * note save touches only that note's keys (never the whole library):
 *
 *   seq          next-id counter (monotonic, shared by notes/groups/assets; ids are never reused)
 *   p.<id>.m     note meta JSON  { id, title, group_id, created_at, updated_at, content_length, is_empty }
 *   p.<id>.c     note content, packed (codec.ts)
 *   g            JSON array of groups { id, name, created_at }  (small, single key)
 *   w.<id>       whiteboard, packed JSON { scene, updated_at }
 *   a.<id>       asset data URL, stored raw (base64 doesn't compress)
 *   a.<id>.m     asset meta { id, mime_type, ext, byte_size, sha256, created_at }
 *   a.idx        JSON map sha256 -> asset id (dedupe)
 *
 * Listing notes enumerates the `.m` keys once and never decompresses a body.
 * Multi-key writes roll back on failure so a full disk can't leave meta and content disagreeing.
 */
import { pack, unpack } from './codec'
import * as kv from './kv'
import { forgetLocalMedia } from './media'

export interface PasteMeta {
  id: number
  title: string | null
  group_id: number | null
  created_at: string
  updated_at: string
  content_length: number
  is_empty: boolean
}

export interface GroupRow {
  id: number
  name: string
  created_at: string
}

export interface AssetMeta {
  id: number
  mime_type: string
  ext: string
  byte_size: number
  sha256: string
  created_at: string
}

/** Server-format UTC timestamp (`YYYY-MM-DD HH:MM:SS`, what SQLite's CURRENT_TIMESTAMP gives). */
export function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/** UTF-8 byte length without allocating a copy of the string. */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

/** Same rule as the server's BLANK_CONTENT_SQL: empty, or only space/tab/CR/LF within 4096 bytes. */
function isBlank(content: string, byteLength: number): boolean {
  if (byteLength === 0) return true
  return byteLength <= 4096 && /^[ \t\r\n]*$/.test(content)
}

function readJson<T>(key: string): T | null {
  const raw = kv.get(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Apply several writes; if one fails, restore the earlier ones (restoring never needs more space). */
function writeAll(writes: Array<[key: string, value: string]>): void {
  const done: Array<[string, string | null]> = []
  try {
    for (const [key, value] of writes) {
      const old = kv.get(key)
      kv.set(key, value)
      done.push([key, old])
    }
  } catch (err) {
    for (const [key, old] of done.reverse()) {
      try {
        if (old === null) kv.remove(key)
        else kv.set(key, old)
      } catch {
        /* best effort */
      }
    }
    throw err
  }
}

// --- ids ----------------------------------------------------------------------------------

/**
 * Next id: past the stored counter AND past anything already present, so a lost/stale counter
 * (restored backup, manual edit) can never overwrite a record. The counter is monotonic, so ids
 * of deleted records are not reused (like AUTOINCREMENT).
 */
function nextId(isTaken: (id: number) => boolean): number {
  let n = (Number(kv.get('seq')) || 0) + 1
  while (isTaken(n)) n++
  kv.set('seq', String(n))
  return n
}

// --- notes --------------------------------------------------------------------------------

const metaKey = (id: number) => `p.${id}.m`
const contentKey = (id: number) => `p.${id}.c`
const boardKey = (id: number) => `w.${id}`

export function getPasteMeta(id: number): PasteMeta | null {
  return readJson<PasteMeta>(metaKey(id))
}

/** All note metas, newest first. One pass over the `.m` keys; no body is read or decompressed. */
export function listPasteMetas(): Array<PasteMeta & { has_whiteboard: 0 | 1 }> {
  const boards = new Set(kv.keys('w.'))
  const rows: Array<PasteMeta & { has_whiteboard: 0 | 1 }> = []
  for (const key of kv.keys('p.')) {
    if (!key.endsWith('.m')) continue
    const meta = readJson<PasteMeta>(key)
    if (!meta) continue
    rows.push({ ...meta, has_whiteboard: boards.has(boardKey(meta.id)) ? 1 : 0 })
  }
  rows.sort((a, b) =>
    a.updated_at === b.updated_at ? b.id - a.id : a.updated_at < b.updated_at ? 1 : -1,
  )
  return rows
}

export function getPasteContent(id: number): string {
  const raw = kv.get(contentKey(id))
  return raw === null ? '' : unpack(raw)
}

export function createPaste(input: { title: string; content: string; group_id: number | null }): PasteMeta {
  const id = nextId((n) => kv.get(metaKey(n)) !== null)
  const stamp = nowStamp()
  const len = utf8Length(input.content)
  const meta: PasteMeta = {
    id,
    title: input.title,
    group_id: input.group_id,
    created_at: stamp,
    updated_at: stamp,
    content_length: len,
    is_empty: isBlank(input.content, len),
  }
  writeAll([
    [contentKey(id), pack(input.content)],
    [metaKey(id), JSON.stringify(meta)],
  ])
  return meta
}

/** Partial update. Only the meta key — plus the content key when content is in the patch — is written. */
export function updatePaste(
  id: number,
  patch: { title?: string; content?: string; group_id?: number | null },
): PasteMeta | null {
  const meta = getPasteMeta(id)
  if (!meta) return null
  const next: PasteMeta = { ...meta, updated_at: nowStamp() }
  if (patch.title !== undefined) next.title = patch.title
  if ('group_id' in patch) next.group_id = patch.group_id ?? null
  const writes: Array<[string, string]> = []
  if (patch.content !== undefined) {
    const len = utf8Length(patch.content)
    next.content_length = len
    next.is_empty = isBlank(patch.content, len)
    writes.push([contentKey(id), pack(patch.content)])
  }
  writes.push([metaKey(id), JSON.stringify(next)])
  writeAll(writes)
  return next
}

/** Delete a note and (like ON DELETE CASCADE) its whiteboard. */
export function deletePaste(id: number): boolean {
  if (kv.get(metaKey(id)) === null) return false
  kv.remove(contentKey(id))
  kv.remove(boardKey(id))
  kv.remove(metaKey(id))
  return true
}

// --- groups -------------------------------------------------------------------------------

export function listGroups(): GroupRow[] {
  return readJson<GroupRow[]>('g') ?? []
}

const writeGroups = (groups: GroupRow[]) => kv.set('g', JSON.stringify(groups))

export function groupExists(id: number): boolean {
  return listGroups().some((g) => g.id === id)
}

export function createGroup(name: string): GroupRow | 'duplicate' {
  const groups = listGroups()
  if (groups.some((g) => g.name === name)) return 'duplicate'
  const id = nextId((n) => groups.some((g) => g.id === n))
  const group = { id, name, created_at: nowStamp() }
  writeGroups([...groups, group])
  return group
}

export function renameGroup(id: number, name: string): GroupRow | 'duplicate' | null {
  const groups = listGroups()
  const idx = groups.findIndex((g) => g.id === id)
  if (idx < 0) return null
  if (groups.some((g) => g.id !== id && g.name === name)) return 'duplicate'
  const group = { ...groups[idx]!, name }
  groups[idx] = group
  writeGroups(groups)
  return group
}

/** Delete a group and unfile its notes (ON DELETE SET NULL; `updated_at` untouched, as in SQLite). */
export function deleteGroup(id: number): boolean {
  const groups = listGroups()
  if (!groups.some((g) => g.id === id)) return false
  writeGroups(groups.filter((g) => g.id !== id))
  for (const key of kv.keys('p.')) {
    if (!key.endsWith('.m')) continue
    const meta = readJson<PasteMeta>(key)
    if (meta && meta.group_id === id) kv.set(key, JSON.stringify({ ...meta, group_id: null }))
  }
  return true
}

// --- whiteboards --------------------------------------------------------------------------

export function getBoard(id: number): { scene: unknown; updated_at: string } | null {
  const raw = kv.get(boardKey(id))
  if (raw === null) return null
  return JSON.parse(unpack(raw)) as { scene: unknown; updated_at: string }
}

export function putBoard(id: number, serializedScene: string): void {
  // `serializedScene` is already JSON text; splice it in rather than parse + restringify.
  kv.set(boardKey(id), pack(`{"scene":${serializedScene},"updated_at":${JSON.stringify(nowStamp())}}`))
}

export function deleteBoard(id: number): boolean {
  if (kv.get(boardKey(id)) === null) return false
  kv.remove(boardKey(id))
  return true
}

// --- assets -------------------------------------------------------------------------------

const assetKey = (id: number) => `a.${id}`
const assetMetaKey = (id: number) => `a.${id}.m`

export function getAssetMeta(id: number): AssetMeta | null {
  return readJson<AssetMeta>(assetMetaKey(id))
}

export function getAssetDataUrl(id: number): string | null {
  return kv.get(assetKey(id))
}

export function findAssetBySha(sha256: string): AssetMeta | null {
  const idx = readJson<Record<string, number>>('a.idx') ?? {}
  const id = idx[sha256]
  if (id === undefined) return null
  const meta = getAssetMeta(id)
  // Index entry whose asset is gone: treat as a miss.
  return meta && kv.get(assetKey(id)) !== null ? meta : null
}

export function createAsset(input: Omit<AssetMeta, 'id' | 'created_at'>, dataUrl: string): AssetMeta {
  const id = nextId((n) => kv.get(assetMetaKey(n)) !== null)
  const meta: AssetMeta = { ...input, id, created_at: nowStamp() }
  const idx = readJson<Record<string, number>>('a.idx') ?? {}
  idx[input.sha256] = id
  writeAll([
    [assetKey(id), dataUrl],
    [assetMetaKey(id), JSON.stringify(meta)],
    ['a.idx', JSON.stringify(idx)],
  ])
  return meta
}

export function deleteAsset(id: number): boolean {
  const meta = getAssetMeta(id)
  if (!meta) return false
  const idx = readJson<Record<string, number>>('a.idx') ?? {}
  if (idx[meta.sha256] === id) {
    delete idx[meta.sha256]
    kv.set('a.idx', JSON.stringify(idx))
  }
  kv.remove(assetKey(id))
  kv.remove(assetMetaKey(id))
  forgetLocalMedia(id) // revoke the cached blob: URL
  return true
}
