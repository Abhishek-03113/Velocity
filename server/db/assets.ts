import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { db } from './client.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ASSETS_DIR =
  process.env.ASSETS_DIR ?? path.resolve(__dirname, '../../data/assets')

fs.mkdirSync(ASSETS_DIR, { recursive: true })

export type AssetRow = {
  id: number
  mime_type: string
  ext: string
  byte_size: number
  sha256: string
  created_at: string
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

export function extForMime(mime: string): string | null {
  return MIME_EXT[mime.toLowerCase()] ?? null
}

export function assetPath(id: number, ext: string): string {
  return path.join(ASSETS_DIR, `${id}.${ext}`)
}

export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim())
  if (!match) return null
  const mime = match[1]!
  const ext = extForMime(mime)
  if (!ext) return null
  try {
    const buffer = Buffer.from(match[2]!.replace(/\s+/g, ''), 'base64')
    if (buffer.byteLength === 0) return null
    return { mime, buffer }
  } catch {
    return null
  }
}

/** Store (or dedupe by sha256) an image buffer. Returns the asset row. */
export function storeImageBuffer(mime: string, buffer: Buffer): AssetRow {
  const ext = extForMime(mime)
  if (!ext) throw new Error(`Unsupported mime type: ${mime}`)

  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const existing = db
    .prepare('SELECT * FROM assets WHERE sha256 = ?')
    .get(sha256) as AssetRow | undefined

  if (existing) {
    const file = assetPath(existing.id, existing.ext)
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, buffer)
    }
    return existing
  }

  const result = db
    .prepare(
      'INSERT INTO assets (mime_type, ext, byte_size, sha256) VALUES (?, ?, ?, ?)'
    )
    .run(mime, ext, buffer.byteLength, sha256)

  const id = Number(result.lastInsertRowid)
  fs.writeFileSync(assetPath(id, ext), buffer)

  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow
}

export function getAsset(id: number): AssetRow | undefined {
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
}
