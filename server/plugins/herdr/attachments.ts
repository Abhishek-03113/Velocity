import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../db/client.ts'
import { assetPath, getAsset } from '../../db/assets.ts'

/**
 * Attachments: the note's embedded images and its whiteboard, written as files the agent can open.
 *
 * Agents read from their own working folder without a permission prompt, so files go to
 * `<agent cwd>/.velocity/attachments/<turn>/` (and `.velocity/` is added to the repo's
 * `.git/info/exclude`, never to a tracked file). When Velocity can't see that folder (it runs in
 * Docker), set HERDR_ATTACHMENTS_DIR to a folder Velocity can write and HERDR_ATTACHMENTS_HOST_DIR to
 * where the same folder is on the host; paths in the prompt use the host side.
 */

export interface AttachmentFile {
  kind: 'image' | 'whiteboard-png' | 'whiteboard-scene'
  path: string
  label: string
}

export interface PreparedAttachments {
  /** The note text with embedded asset images pointed at the written files. */
  text: string
  files: AttachmentFile[]
  /** Set when there was something to attach but no folder to put it in. */
  skipped?: string
}

const ASSET_IMG = /(!\[([^\]]*)\]\()\s*(?:https?:\/\/[^)\s]*?)?\/api\/assets\/(\d+)(\s+"[^"]*")?\s*\)/g
const ASSET_HTML = /(<img\b[^>]*?\bsrc=["'])(?:https?:\/\/[^"']*?)?\/api\/assets\/(\d+)(["'])/gi
const MAX_PNG_BYTES = 20 * 1024 * 1024

export function hasWhiteboard(noteId: number): boolean {
  return !!db.prepare('SELECT 1 FROM whiteboards WHERE paste_id = ?').get(noteId)
}

function excludeFromGit(cwd: string) {
  const info = path.join(cwd, '.git', 'info')
  try {
    if (!fs.statSync(path.join(cwd, '.git')).isDirectory()) return
    fs.mkdirSync(info, { recursive: true })
    const file = path.join(info, 'exclude')
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    if (!/^\/?\.velocity\/?$/m.test(current)) {
      fs.appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}# Velocity attachments\n.velocity/\n`)
    }
  } catch {
    // not a git checkout, or not writable: attachments still work
  }
}

/** Where to write this turn's files, and how the agent will see that path. */
export function attachmentFolder(turnKey: string, agentCwd: string | undefined): { write: string; shown: string } | { error: string } {
  const configured = process.env.HERDR_ATTACHMENTS_DIR?.trim()
  if (configured) {
    const shownBase = process.env.HERDR_ATTACHMENTS_HOST_DIR?.trim() || configured
    return { write: path.join(configured, turnKey), shown: path.join(shownBase, turnKey) }
  }
  if (!agentCwd) return { error: 'herdr didn’t report the agent’s folder' }
  try {
    if (!fs.statSync(agentCwd).isDirectory()) throw new Error('not a folder')
    fs.accessSync(agentCwd, fs.constants.W_OK)
  } catch {
    return { error: `Velocity can’t write to the agent’s folder (${agentCwd}). In Docker, set HERDR_ATTACHMENTS_DIR and HERDR_ATTACHMENTS_HOST_DIR.` }
  }
  excludeFromGit(agentCwd)
  const dir = path.join(agentCwd, '.velocity', 'attachments', turnKey)
  return { write: dir, shown: dir }
}

export function prepareAttachments(opts: {
  turnKey: string
  noteId: number
  content: string
  agentCwd?: string
  includeWhiteboard: boolean
  whiteboardPng?: string | null
}): PreparedAttachments {
  const assetIds = new Set<number>()
  for (const m of opts.content.matchAll(ASSET_IMG)) assetIds.add(Number(m[3]))
  for (const m of opts.content.matchAll(ASSET_HTML)) assetIds.add(Number(m[2]))
  const board = opts.includeWhiteboard ? (db.prepare('SELECT scene FROM whiteboards WHERE paste_id = ?').get(opts.noteId) as { scene: string } | undefined) : undefined
  if (!assetIds.size && !board) return { text: opts.content, files: [] }

  const folder = attachmentFolder(opts.turnKey, opts.agentCwd)
  if ('error' in folder) return { text: opts.content, files: [], skipped: folder.error }
  fs.mkdirSync(folder.write, { recursive: true })

  const files: AttachmentFile[] = []
  const shownFor = new Map<number, string>()
  let n = 0
  for (const id of assetIds) {
    const asset = getAsset(id)
    if (!asset) continue
    const src = assetPath(asset.id, asset.ext)
    if (!fs.existsSync(src)) continue
    const name = `image-${++n}.${asset.ext}`
    fs.copyFileSync(src, path.join(folder.write, name))
    const shown = path.join(folder.shown, name)
    shownFor.set(id, shown)
    files.push({ kind: 'image', path: shown, label: `Image ${n}` })
  }

  const text = opts.content
    .replace(ASSET_IMG, (all, open: string, _alt: string, id: string, title = '') => {
      const shown = shownFor.get(Number(id))
      return shown ? `${open}${shown}${title})` : all
    })
    .replace(ASSET_HTML, (all, open: string, id: string, close: string) => {
      const shown = shownFor.get(Number(id))
      return shown ? `${open}${shown}${close}` : all
    })

  if (board) {
    let scene: { elements?: unknown[]; appState?: unknown; files?: unknown } = {}
    try {
      scene = JSON.parse(board.scene)
    } catch {
      // unreadable scene: skip the JSON, keep the PNG if the browser sent one
    }
    if (Array.isArray(scene.elements)) {
      const file = path.join(folder.write, 'whiteboard.excalidraw')
      fs.writeFileSync(file, JSON.stringify({ type: 'excalidraw', version: 2, source: 'velocity', elements: scene.elements, appState: scene.appState ?? {}, files: scene.files ?? {} }))
      files.push({ kind: 'whiteboard-scene', path: path.join(folder.shown, 'whiteboard.excalidraw'), label: 'Whiteboard (Excalidraw scene, JSON)' })
    }
    const png = decodePng(opts.whiteboardPng)
    if (png) {
      fs.writeFileSync(path.join(folder.write, 'whiteboard.png'), png)
      files.unshift({ kind: 'whiteboard-png', path: path.join(folder.shown, 'whiteboard.png'), label: 'Whiteboard (rendered image)' })
    }
  }
  return { text, files }
}

function decodePng(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim())
  if (!m) return null
  const buf = Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64')
  if (buf.byteLength === 0 || buf.byteLength > MAX_PNG_BYTES) return null
  // PNG signature check
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  return buf
}

/** The paragraph appended to the prompt that tells the agent about the files. */
export function attachmentSection(prepared: PreparedAttachments): string {
  if (!prepared.files.length) return ''
  const lines = prepared.files.map((f) => `- ${f.label}: ${f.path}`)
  return ['Attached files from my note (open them as part of this task):', ...lines].join('\n')
}
