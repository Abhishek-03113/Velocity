/**
 * Whiteboard scenes, stored in SQLite via `/api/pastes/:id/whiteboard`.
 *
 * Local-first: the canvas never waits on the network. Scenes are cached in memory,
 * saves go through a debounced, coalescing queue (see lib/boardSync.ts), and
 * boards of not-yet-created notes (temp ids) wait in memory until the note has a
 * server id. Board *visibility* is owned by the tiling layout.
 */
import { apiBaseUrl } from '../lib/api'
import { createBoardSync, type SyncedScene } from '../lib/boardSync'
import { migrateLegacyBoards, type LegacyNote } from '../lib/boardMigration'

export type BoardScene = SyncedScene

class BoardHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const boardUrl = (id: number) => `${apiBaseUrl()}/api/pastes/${id}/whiteboard`

export async function putScene(id: number, scene: BoardScene, opts: { keepalive?: boolean } = {}): Promise<void> {
  const body = JSON.stringify({ scene })
  const res = await fetch(boardUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    // keepalive requests are capped (~64 KB); larger bodies use a normal fetch.
    keepalive: Boolean(opts.keepalive) && body.length < 60_000,
  })
  if (!res.ok) throw new BoardHttpError(res.status, `HTTP ${res.status}`)
}

async function fetchScene(id: number): Promise<BoardScene | null> {
  const res = await fetch(boardUrl(id))
  if (res.status === 404) return null
  if (!res.ok) throw new BoardHttpError(res.status, `HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { scene?: BoardScene } }
  return json.data?.scene ?? null
}

export const boardSync = createBoardSync({
  send: (id, scene, { keepalive }) => putScene(id, scene, { keepalive }),
  // Note gone (404) or payload refused (400/413): retrying can't help.
  isFatal: (err) => err instanceof BoardHttpError && [400, 404, 413].includes(err.status),
})

/** Last loaded/saved scene per note. `null` = known to have no board. */
const cache = new Map<number, BoardScene | null>()
/** Cheap fingerprint of what the server has / is about to have, to skip no-op onChange calls. */
const signatures = new Map<number, string>()
const known = new Set<number>()
const loads = new Map<number, Promise<BoardScene | null>>()

/** Identity of the drawing itself (not pan/zoom), so selecting or panning doesn't trigger saves. */
export function sceneSignature(scene: BoardScene): string {
  let sig = ''
  for (const el of scene.elements as Array<{ id?: string; version?: number; isDeleted?: boolean }>) {
    sig += `${el.id}:${el.version}:${el.isDeleted ? 1 : 0},`
  }
  sig += `|${Object.keys(scene.files ?? {}).join(',')}|${String(scene.appState['viewBackgroundColor'])}`
  return sig
}

/** Synchronous peek: scene if we already hold it, `null` if known empty, `undefined` if unknown. */
export function peekScene(noteId: number): BoardScene | null | undefined {
  return boardSync.peek(noteId) ?? cache.get(noteId)
}

export async function loadScene(noteId: number): Promise<BoardScene | null> {
  const hit = peekScene(noteId)
  if (hit !== undefined) return hit
  if (noteId < 0) return null
  let load = loads.get(noteId)
  if (!load) {
    load = fetchScene(noteId)
      .then((scene) => {
        const newer = boardSync.peek(noteId)
        if (newer) return newer
        cache.set(noteId, scene)
        if (scene) {
          signatures.set(noteId, sceneSignature(scene))
          known.add(noteId)
        } else known.delete(noteId)
        return scene
      })
      .finally(() => loads.delete(noteId))
    loads.set(noteId, load)
  }
  return load
}

export function saveScene(noteId: number, scene: BoardScene): void {
  const sig = sceneSignature(scene)
  if (signatures.get(noteId) === sig) return
  signatures.set(noteId, sig)
  cache.set(noteId, scene)
  known.add(noteId)
  boardSync.queue(noteId, scene)
}

export function flushScene(noteId: number): void {
  void boardSync.flush(noteId)
}

export function hasBoard(noteId: number): boolean {
  return known.has(noteId) || boardSync.isPending(noteId)
}

/** Seed `hasBoard` from the notes list (`has_whiteboard`). */
export function seedBoardFlags(notes: Array<{ id: number; has_whiteboard?: boolean }>): void {
  for (const n of notes) if (n.has_whiteboard) known.add(n.id)
}

/** The server deletes the board with its note (cascade) — just drop local state. */
export function removeBoardScene(noteId: number): void {
  boardSync.forget(noteId)
  cache.delete(noteId)
  signatures.delete(noteId)
  known.delete(noteId)
}

/** Temp note ids become server ids after the first save — move the scene with them. */
export function remapBoard(from: number, to: number): void {
  const scene = peekScene(from)
  if (scene) {
    cache.set(to, scene)
    signatures.set(to, signatures.get(from) ?? sceneSignature(scene))
    known.add(to)
  }
  cache.delete(from)
  signatures.delete(from)
  known.delete(from)
  boardSync.remap(from, to)
}

/** One-time move of pre-SQLite localStorage boards to the server. Safe to call repeatedly. */
export async function migrateLocalBoards(notes: LegacyNote[]): Promise<number> {
  try {
    return await migrateLegacyBoards({
      storage: localStorage,
      notes,
      put: (id, scene) => putScene(id, scene as BoardScene),
      onUploaded: (id) => known.add(id),
    })
  } catch {
    return 0
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => boardSync.flushOnExit())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void boardSync.flushAll()
    else boardSync.retryFailed()
  })
  window.addEventListener('online', () => boardSync.retryFailed())
  window.addEventListener('focus', () => boardSync.retryFailed())
}
