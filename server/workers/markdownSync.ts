import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { db } from '../db/client.ts'
import { parseDataUrl, storeImageBuffer } from '../db/assets.ts'

const documentsDir = path.join(os.homedir(), 'velocity_docs')
let syncing = false

const DATA_URL_IMAGE_RE =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/g

function fileName(id: number, title: string | null) {
  const safeTitle =
    (title || 'Untitled').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim().slice(0, 120) ||
    'Untitled'
  return `${id} - ${safeTitle}.md`
}

/**
 * Extract inline data-URL images from paste content into:
 *   1) durable `data/assets/` store (B)
 *   2) export folder `~/velocity_docs/assets/{pasteId}/` (C)
 * Rewrites the *exported* markdown to relative paths; DB content stays data-URL based.
 */
async function materializeInlineImages(
  pasteId: number,
  content: string
): Promise<string> {
  const assetsDir = path.join(documentsDir, 'assets', String(pasteId))
  await fs.mkdir(assetsDir, { recursive: true })

  let exportContent = content
  const matches = [...content.matchAll(DATA_URL_IMAGE_RE)]

  for (const match of matches) {
    const full = match[0]!
    const alt = match[1] ?? ''
    const dataUrl = match[2]!.replace(/\s+/g, '')
    const decoded = parseDataUrl(dataUrl)
    if (!decoded) continue

    // B — durable asset store (deduped by sha256)
    try {
      storeImageBuffer(decoded.mime, decoded.buffer)
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] asset materialize failure pasteId=${pasteId}:`,
        err
      )
    }

    const sha = createHash('sha256').update(decoded.buffer).digest('hex').slice(0, 16)
    const ext =
      decoded.mime === 'image/jpeg' || decoded.mime === 'image/jpg'
        ? 'jpg'
        : decoded.mime.split('/')[1]?.replace('+xml', '') ?? 'bin'
    const exportName = `${sha}.${ext}`
    const exportPath = path.join(assetsDir, exportName)
    await fs.writeFile(exportPath, decoded.buffer)

    const relative = `assets/${pasteId}/${exportName}`
    // Exported markdown uses relative paths for offline docs; DB keeps data URLs.
    exportContent = exportContent.replaceAll(full, `![${alt}](${relative})`)
  }

  return exportContent
}

export async function syncMarkdowns() {
  if (syncing) return
  syncing = true
  try {
    await fs.mkdir(documentsDir, { recursive: true })
    const pastes = db.prepare('SELECT id, title, content FROM pastes').all() as {
      id: number
      title: string | null
      content: string | null
    }[]
    for (const paste of pastes) {
      const content = paste.content ?? ''
      if (Buffer.byteLength(content, 'utf8') === 0) continue

      const exportContent = await materializeInlineImages(paste.id, content)
      const filePath = path.join(documentsDir, fileName(paste.id, paste.title))
      const existing = await fs.readFile(filePath, 'utf8').catch(() => null)
      if (existing !== exportContent) await fs.writeFile(filePath, exportContent, 'utf8')
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] markdown sync failure:`, error)
  } finally {
    syncing = false
  }
}

export function startMarkdownSync() {
  void syncMarkdowns()
  setInterval(() => void syncMarkdowns(), 5_000).unref()
}
