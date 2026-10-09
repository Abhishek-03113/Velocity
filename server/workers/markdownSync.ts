/**
 * File sync worker — mirrors every note to `DOCS_DIR` (default ~/velocity_docs)
 * as plain Markdown so notes stay readable outside Velocity.
 *
 * Design:
 *  - Event-driven: API writes call `requestMarkdownSync(id)`; a debounced run
 *    follows. A slow safety poll catches edits made directly in the database.
 *  - Incremental: a metadata-only scan decides what changed; content is loaded
 *    only for those notes, and an in-memory hash replaces read-to-compare.
 *  - Renames delete the stale file, deletes remove the file and its assets.
 *  - Images are exported next to the Markdown with relative links, so the
 *    folder is fully usable offline.
 *  - Writes are atomic (temp file + rename).
 */
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { db } from '../db/client.ts'
import { assetPath, getAsset, parseDataUrl, storeImageBuffer } from '../db/assets.ts'

const SYNC_DEBOUNCE_MS = 750
const SAFETY_POLL_MS = 60_000
const FILE_RE = /^(\d+) - .*\.md$/

const DATA_URL_IMAGE_RE =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/g
const ASSET_IMAGE_RE = /!\[([^\]]*)\]\(\/api\/assets\/(\d+)\)/g

type Row = { id: number; title: string | null; updated_at: string }

interface Entry {
  file: string
  hash: string
  title: string | null
  updatedAt: string
}

export function docsDir(): string {
  return process.env.DOCS_DIR ?? path.join(os.homedir(), 'velocity_docs')
}

const state = new Map<number, Entry>()
const dirty = new Set<number>()
let reconciled = false
let running: Promise<void> | null = null
let rerun = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`|\*|_)/g, '')
    .trim()
}

/** Same rule as the client: explicit title, else the first meaningful line. */
export function exportTitle(title: string | null, content: string): string {
  const t = (title ?? '').trim()
  if (t && t !== 'Untitled') return t
  for (const raw of content.slice(0, 4000).split('\n')) {
    if (/^\s*(```|---|\*\*\*)/.test(raw)) continue
    const text = stripMarkdown(raw)
    if (text) return text.length > 80 ? text.slice(0, 80).trimEnd() : text
  }
  return 'Untitled'
}

export function fileName(id: number, title: string): string {
  const safeTitle =
    // eslint-disable-next-line no-control-regex -- strip characters invalid in filenames
    title
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .slice(0, 120)
      .replace(/[\s.]+$/, '') // Windows rejects trailing dots/spaces
      .trim() || 'Untitled'
  return `${id} - ${safeTitle}.md`
}

function sha(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex')
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, file)
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/**
 * Rewrite image references for the export:
 *  - inline data URLs → stored as durable assets, exported as files
 *  - `/api/assets/:id` → copied next to the Markdown
 * The database content is never modified.
 */
async function materializeImages(pasteId: number, content: string): Promise<string> {
  const hasInline = content.includes('data:image/')
  const hasAssets = content.includes('/api/assets/')
  if (!hasInline && !hasAssets) return content

  const relDir = `assets/${pasteId}`
  const assetsDir = path.join(docsDir(), relDir)
  await fs.mkdir(assetsDir, { recursive: true })
  let out = content

  if (hasInline) {
    for (const match of [...content.matchAll(DATA_URL_IMAGE_RE)]) {
      const decoded = parseDataUrl(match[2]!.replace(/\s+/g, ''))
      if (!decoded) continue
      try {
        storeImageBuffer(decoded.mime, decoded.buffer)
      } catch (err) {
        console.error(`[${new Date().toISOString()}] asset materialize failure pasteId=${pasteId}:`, err)
      }
      const ext =
        decoded.mime === 'image/jpeg' || decoded.mime === 'image/jpg'
          ? 'jpg'
          : (decoded.mime.split('/')[1]?.replace('+xml', '') ?? 'bin')
      const name = `${sha(decoded.buffer).slice(0, 16)}.${ext}`
      const target = path.join(assetsDir, name)
      if (!(await exists(target))) await writeAtomic(target, decoded.buffer)
      out = out.replaceAll(match[0], `![${match[1] ?? ''}](${relDir}/${name})`)
    }
  }

  if (hasAssets) {
    for (const match of [...out.matchAll(ASSET_IMAGE_RE)]) {
      const asset = getAsset(Number(match[2]))
      if (!asset) continue
      const name = `${asset.id}.${asset.ext}`
      const target = path.join(assetsDir, name)
      if (!(await exists(target))) {
        try {
          await fs.copyFile(assetPath(asset.id, asset.ext), target)
        } catch {
          continue // source missing — keep the API link
        }
      }
      out = out.replaceAll(match[0], `![${match[1] ?? ''}](${relDir}/${name})`)
    }
  }

  return out
}

/** First run: adopt files already on disk so unchanged notes aren't rewritten. */
async function reconcile(rows: Row[]): Promise<void> {
  const dir = docsDir()
  const files = await fs.readdir(dir).catch(() => [] as string[])
  const byId = new Map<number, string[]>()
  for (const f of files) {
    const m = FILE_RE.exec(f)
    if (!m) continue
    const id = Number(m[1])
    byId.set(id, [...(byId.get(id) ?? []), f])
  }
  const live = new Set(rows.map((r) => r.id))
  for (const [id, names] of byId) {
    if (!live.has(id)) {
      // Note deleted while the server was down.
      await Promise.all(names.map((n) => fs.rm(path.join(dir, n), { force: true })))
      await fs.rm(path.join(dir, 'assets', String(id)), { recursive: true, force: true })
      continue
    }
    // Keep one candidate; content hash decides whether it gets rewritten.
    const [first, ...stale] = names
    await Promise.all(stale.map((n) => fs.rm(path.join(dir, n), { force: true })))
    const text = await fs.readFile(path.join(dir, first!), 'utf8').catch(() => null)
    if (text != null) state.set(id, { file: first!, hash: sha(text), title: null, updatedAt: '' })
  }
}

async function syncOnce(): Promise<void> {
  const dir = docsDir()
  await fs.mkdir(dir, { recursive: true })
  const rows = db.prepare('SELECT id, title, updated_at FROM pastes').all() as Row[]
  if (!reconciled) {
    await reconcile(rows)
    reconciled = true
  }

  const getContent = db.prepare('SELECT title, content FROM pastes WHERE id = ?')
  const pending = new Set(dirty)
  dirty.clear()
  const seen = new Set<number>()

  for (const row of rows) {
    seen.add(row.id)
    const entry = state.get(row.id)
    const unchanged =
      entry && entry.updatedAt === row.updated_at && entry.title === row.title && !pending.has(row.id)
    if (unchanged) continue

    const full = getContent.get(row.id) as { title: string | null; content: string | null } | undefined
    if (!full) continue
    const content = full.content ?? ''

    if (content.trim().length === 0) {
      // Empty notes are not exported (matches previous behaviour).
      if (entry) await fs.rm(path.join(dir, entry.file), { force: true })
      state.set(row.id, { file: '', hash: '', title: row.title, updatedAt: row.updated_at })
      continue
    }

    const exported = await materializeImages(row.id, content)
    const hash = sha(exported)
    const file = fileName(row.id, exportTitle(full.title, content))

    if (entry?.file && entry.file !== file) {
      await fs.rm(path.join(dir, entry.file), { force: true })
    }
    if (!entry || entry.hash !== hash || entry.file !== file) {
      await writeAtomic(path.join(dir, file), exported)
    }
    state.set(row.id, { file, hash, title: row.title, updatedAt: row.updated_at })
  }

  for (const [id, entry] of state) {
    if (seen.has(id)) continue
    if (entry.file) await fs.rm(path.join(dir, entry.file), { force: true })
    await fs.rm(path.join(dir, 'assets', String(id)), { recursive: true, force: true })
    state.delete(id)
  }
}

/** Run a sync now; concurrent callers share the run and trigger one follow-up. */
export function syncMarkdowns(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    do {
      rerun = false
      try {
        await syncOnce()
      } catch (error) {
        console.error(`[${new Date().toISOString()}] markdown sync failure:`, error)
      }
    } while (rerun)
  })().finally(() => {
    running = null
  })
  return running
}

/** Called by API writes — coalesces bursts of saves into one export pass. */
export function requestMarkdownSync(id?: number): void {
  if (id != null) dirty.add(id)
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void syncMarkdowns()
  }, SYNC_DEBOUNCE_MS)
  debounceTimer.unref?.()
}

export function startMarkdownSync(): void {
  if (process.env.DOCS_SYNC === 'off') return
  void syncMarkdowns()
  setInterval(() => void syncMarkdowns(), SAFETY_POLL_MS).unref()
}

/** Test hook — forget in-memory state (simulates a restart). */
export function resetMarkdownSyncState(): void {
  state.clear()
  dirty.clear()
  reconciled = false
}
