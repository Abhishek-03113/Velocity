import { create } from 'zustand'

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

export function loadScene(noteId: number): BoardScene | null {
  if (typeof localStorage === 'undefined') return null
  return safeParse<BoardScene | null>(localStorage.getItem(STORAGE_PREFIX + String(noteId)), null)
}

export function saveScene(noteId: number, scene: BoardScene): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_PREFIX + String(noteId), JSON.stringify(scene))
    const ids = safeParse<number[]>(localStorage.getItem(INDEX_KEY), [])
    if (!ids.includes(noteId)) {
      localStorage.setItem(INDEX_KEY, JSON.stringify([...ids, noteId]))
    }
  } catch {
    // storage full / unavailable — ignore
  }
}

export function listBoardNoteIds(): number[] {
  if (typeof localStorage === 'undefined') return []
  return safeParse<number[]>(localStorage.getItem(INDEX_KEY), [])
}

export function hasBoard(noteId: number): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(STORAGE_PREFIX + String(noteId)) !== null
}

interface WhiteboardState {
  /** Note the currently displayed board belongs to. Stays put when tabs change. */
  boardNoteId: number | null
  isOpen: boolean
  /** 0.2 - 0.8 — fraction of the editor area taken by the board */
  splitRatio: number
  openBoard: (noteId: number) => void
  toggleBoard: (noteId: number) => void
  closeBoard: () => void
  setSplitRatio: (ratio: number) => void
  removeBoard: (noteId: number) => void
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  boardNoteId: null,
  isOpen: false,
  splitRatio: 0.45,

  openBoard: (noteId) => {
    set({ boardNoteId: noteId, isOpen: true })
  },

  toggleBoard: (noteId) => {
    const { isOpen, boardNoteId } = get()
    if (isOpen && boardNoteId === noteId) set({ isOpen: false })
    else set({ boardNoteId: noteId, isOpen: true })
  },

  closeBoard: () => {
    set({ isOpen: false })
  },

  setSplitRatio: (ratio) => {
    set({ splitRatio: Math.min(0.75, Math.max(0.2, ratio)) })
  },

  removeBoard: (noteId) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_PREFIX + String(noteId))
      const ids = safeParse<number[]>(localStorage.getItem(INDEX_KEY), []).filter((id) => id !== noteId)
      localStorage.setItem(INDEX_KEY, JSON.stringify(ids))
    }
    if (get().boardNoteId === noteId) set({ isOpen: false, boardNoteId: null })
  },
}))
