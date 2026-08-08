import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { db } from '../db/client.ts'

const documentsDir = path.join(os.homedir(), 'velocity_docs')
let syncing = false

function fileName(id: number, title: string | null) {
  const safeTitle = (title || 'Untitled').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim().slice(0, 120) || 'Untitled'
  return `${id} - ${safeTitle}.md`
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
      const filePath = path.join(documentsDir, fileName(paste.id, paste.title))
      const existing = await fs.readFile(filePath, 'utf8').catch(() => null)
      if (existing !== content) await fs.writeFile(filePath, content, 'utf8')
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
