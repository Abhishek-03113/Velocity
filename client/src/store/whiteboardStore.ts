/**
 * Whiteboard scenes, persisted per note in localStorage.
 *
 * Board *visibility* is owned by the tiling layout (a board is just a tile kind),
 * so this module only stores and retrieves scenes.
 */

const STORAGE_PREFIX = 'velocity.whiteboard.v1.'
const INDEX_KEY = 'velocity.whiteboard.index.v1'

export interface BoardScene {
  elements: unknown[]
  appState: Record<string, unknown>
  files?: Record<string, unknown>
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readIndex(): number[] {
  try {
    return safeParse<number[]>(localStorage.getItem(INDEX_KEY), [])
  } catch {
    return []
  }
}

function writeIndex(ids: number[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids))
  } catch {
    // storage full / unavailable — ignore
  }
}

// In-memory mirror of the index so `hasBoard` (called during render) never hits storage.
let boardIds: Set<number> | null = null
function ids(): Set<number> {
  if (!boardIds) boardIds = new Set(readIndex())
  return boardIds
}

export function loadScene(noteId: number): BoardScene | null {
  try {
    return safeParse<BoardScene | null>(localStorage.getItem(STORAGE_PREFIX + String(noteId)), null)
  } catch {
    return null
  }
}

export function saveScene(noteId: number, scene: BoardScene): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + String(noteId), JSON.stringify(scene))
    if (!ids().has(noteId)) {
      ids().add(noteId)
      writeIndex([...ids()])
    }
  } catch {
    // storage full / unavailable — ignore
  }
}

export function hasBoard(noteId: number): boolean {
  return ids().has(noteId)
}

export function removeBoardScene(noteId: number): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + String(noteId))
  } catch {
    // ignore
  }
  if (ids().delete(noteId)) writeIndex([...ids()])
}

/** Temp note ids become server ids after the first save — move the scene with them. */
export function remapBoard(from: number, to: number): void {
  const scene = loadScene(from)
  if (!scene) return
  saveScene(to, scene)
  removeBoardScene(from)
}
