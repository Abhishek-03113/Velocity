import { create } from 'zustand'
import { api } from '../lib/api'
import type { Paste, CreatePastePayload, UpdatePastePayload } from '../types'
import { useSearchStore } from './searchStore'

const DEBOUNCE_MS = 800
const MAX_RETRIES = 3
const MAX_LOCAL_MRU = 5

const debounceTimers: Record<number, ReturnType<typeof setTimeout>> = {}

let _localIdCounter = -1
function localId(): number {
  return _localIdCounter--
}

interface EditorState {
  pastes: Paste[]
  openTabIds: number[]
  activeId: number | null
  editingTitleId: number | null
  initialized: boolean

  initialize: () => Promise<void>
  getActivePaste: () => Paste | null
  getOpenTabs: () => Paste[]
  setActiveId: (id: number) => Promise<void>
  addPaste: () => void
  closeTab: (id: number) => void
  deletePaste: (id: number) => void
  setContent: (content: string) => void
  setTitle: (id: number, title: string) => void
  clearDirty: (id: number) => void
  setEditingTitleId: (id: number | null) => void
}

function scheduleSync(id: number, get: () => EditorState): void {
  clearTimeout(debounceTimers[id])
  debounceTimers[id] = setTimeout(() => syncPaste(id, get), DEBOUNCE_MS)
}

async function syncPaste(id: number, get: () => EditorState, attempt = 1): Promise<void> {
  if (id < 0) return

  const { pastes, clearDirty } = get()
  const paste = pastes.find((p) => p.id === id)
  if (!paste) return

  try {
    await api.put<Paste>(`/api/pastes/${id}`, {
      title: paste.title,
      content: paste.content,
    } satisfies UpdatePastePayload)
    clearDirty(id)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`[sync] paste ${id} failed (attempt ${attempt}):`, message)
    if (attempt < MAX_RETRIES) {
      setTimeout(() => syncPaste(id, get, attempt + 1), 1000 * 2 ** attempt)
    }
  }
}

// Trim local-only (id < 0) pastes in the sidebar to the MRU cap.
// Named pastes (title !== 'Untitled') are always kept regardless of server ID.
function trimLocalMru(pastes: Paste[], openTabIds: number[]): Paste[] {
  const serverPastes = pastes.filter((p) => p.id > 0)
  const localNamed = pastes.filter((p) => p.id < 0 && p.title !== 'Untitled')
  const localUntitled = pastes.filter((p) => p.id < 0 && p.title === 'Untitled')

  // Keep open tabs always; among closed untitled locals keep most recent (highest array index = most recent)
  const openSet = new Set(openTabIds)
  const openUntitled = localUntitled.filter((p) => openSet.has(p.id))
  const closedUntitled = localUntitled.filter((p) => !openSet.has(p.id))

  const keepClosed = closedUntitled.slice(-Math.max(0, MAX_LOCAL_MRU - openUntitled.length))

  return [...serverPastes, ...localNamed, ...openUntitled, ...keepClosed]
}

const _initialPaste: Paste = { id: localId(), title: 'Untitled', content: '', dirty: false }

export const useEditorStore = create<EditorState>((set, get) => ({
  pastes: [_initialPaste],
  openTabIds: [_initialPaste.id],
  activeId: _initialPaste.id,
  editingTitleId: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return
    set({ initialized: true })

    try {
      const res = await api.get<Paste[]>('/api/pastes')
      const list = res.data ?? []

      if (list.length === 0) {
        const { pastes } = get()
        const local = pastes[0]
        if (local) {
          try {
            const created = await api.post<Paste>('/api/pastes', {
              title: local.title,
              content: local.content ?? '',
            } satisfies CreatePastePayload)
            if (created.data) {
              const serverPaste = created.data
              set((state) => ({
                pastes: state.pastes.map((p) =>
                  p.id === local.id ? { ...serverPaste, dirty: false } : p
                ),
                openTabIds: state.openTabIds.map((id) =>
                  id === local.id ? serverPaste.id : id
                ),
                activeId: state.activeId === local.id ? serverPaste.id : state.activeId,
              }))
            }
          } catch {
            // keep local paste
          }
          return
        }

        const created = await api.post<Paste>('/api/pastes', {
          title: 'Untitled',
          content: '',
        } satisfies CreatePastePayload)
        if (created.data) {
          const paste: Paste = { ...created.data, dirty: false }
          set({ pastes: [paste], openTabIds: [paste.id], activeId: paste.id })
        }
        return
      }

      const incoming: Paste[] = list.map((p) => ({ ...p, content: undefined, dirty: false }))
      set({ pastes: incoming, openTabIds: [incoming[0].id], activeId: incoming[0].id })
      useSearchStore.getState().hydrateIndex(incoming.map((p) => ({ id: p.id, title: p.title, content: '' })))

      const firstId = incoming[0].id
      try {
        const detail = await api.get<Paste>(`/api/pastes/${firstId}`)
        if (detail.data) {
          const content = detail.data.content ?? ''
          set((state) => ({
            pastes: state.pastes.map((p) => (p.id === firstId ? { ...p, content } : p)),
          }))
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[init] failed to load content for paste ${firstId}:`, message)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[init] failed to load pastes:', message)
    }
  },

  getActivePaste: () => {
    const { pastes, activeId } = get()
    return pastes.find((p) => p.id === activeId) ?? null
  },

  getOpenTabs: () => {
    const { pastes, openTabIds } = get()
    const map = new Map(pastes.map((p) => [p.id, p]))
    return openTabIds.map((id) => map.get(id)).filter((p): p is Paste => p !== undefined)
  },

  setActiveId: async (id: number) => {
    // Opening a paste from sidebar adds it as a tab
    set((state) => ({
      activeId: id,
      openTabIds: state.openTabIds.includes(id) ? state.openTabIds : [...state.openTabIds, id],
    }))

    const paste = get().pastes.find((p) => p.id === id)
    if (paste && paste.content === undefined) {
      try {
        const res = await api.get<Paste>(`/api/pastes/${id}`)
        if (res.data) {
          const content = res.data.content ?? ''
          set((state) => ({
            pastes: state.pastes.map((p) => (p.id === id ? { ...p, content } : p)),
          }))
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[load] paste ${id}:`, message)
      }
    }
  },

  addPaste: () => {
    const tempId = localId()
    const paste: Paste = { id: tempId, title: 'Untitled', content: '', dirty: false }
    set((state) => ({
      pastes: trimLocalMru([...state.pastes, paste], [...state.openTabIds, tempId]),
      openTabIds: [...state.openTabIds, tempId],
      activeId: tempId,
    }))

    api
      .post<Paste>('/api/pastes', { title: 'Untitled', content: '' } satisfies CreatePastePayload)
      .then((res) => {
        if (!res.data) return
        const serverPaste = res.data
        set((state) => ({
          pastes: state.pastes.map((p) =>
            p.id === tempId ? { ...serverPaste, dirty: false } : p
          ),
          openTabIds: state.openTabIds.map((id) => (id === tempId ? serverPaste.id : id)),
          activeId: state.activeId === tempId ? serverPaste.id : state.activeId,
        }))
        useSearchStore.getState().indexPaste({ id: serverPaste.id, title: serverPaste.title, content: '' })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error('[addPaste] server sync failed:', message)
      })
  },

  // Close a tab without deleting the paste — it remains in the sidebar
  closeTab: (id: number) => {
    clearTimeout(debounceTimers[id])
    delete debounceTimers[id]

    set((state) => {
      const openTabIds = state.openTabIds.filter((tid) => tid !== id)

      let activeId = state.activeId
      if (state.activeId === id) {
        const idx = state.openTabIds.indexOf(id)
        const next = state.openTabIds[idx - 1] ?? state.openTabIds[idx + 1] ?? null
        activeId = next
      }

      // Apply MRU trim for local-only untitled pastes
      const pastes = trimLocalMru(state.pastes, openTabIds)

      return { openTabIds, activeId, pastes }
    })

    // If no tabs remain, open a new untitled paste
    if (get().openTabIds.length === 0) {
      get().addPaste()
    }
  },

  // Explicit delete — removes paste from sidebar and server
  deletePaste: (id: number) => {
    clearTimeout(debounceTimers[id])
    delete debounceTimers[id]

    set((state) => {
      const pastes = state.pastes.filter((p) => p.id !== id)
      const openTabIds = state.openTabIds.filter((tid) => tid !== id)

      let activeId = state.activeId
      if (state.activeId === id) {
        const idx = state.openTabIds.indexOf(id)
        const next = state.openTabIds[idx - 1] ?? state.openTabIds[idx + 1] ?? null
        activeId = next ?? (pastes[0]?.id ?? null)
      }

      return { pastes, openTabIds, activeId }
    })

    if (get().openTabIds.length === 0) {
      get().addPaste()
    }

    useSearchStore.getState().removePaste(id)

    if (id > 0) {
      api.delete<void>(`/api/pastes/${id}`).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[deletePaste] delete ${id} failed:`, message)
      })
    }
  },

  setContent: (content: string) => {
    const { activeId } = get()
    if (activeId === null) return
    set((state) => ({
      pastes: state.pastes.map((p) =>
        p.id === activeId ? { ...p, content, dirty: true } : p
      ),
    }))
    scheduleSync(activeId, get)
    const paste = get().pastes.find((p) => p.id === activeId)
    if (paste) useSearchStore.getState().indexPaste({ id: activeId, title: paste.title, content })
  },

  setTitle: (id: number, title: string) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id ? { ...p, title, dirty: true } : p)),
    }))
    scheduleSync(id, get)
    const paste = get().pastes.find((p) => p.id === id)
    if (paste) useSearchStore.getState().indexPaste({ id, title, content: paste.content ?? '' })
  },

  clearDirty: (id: number) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id ? { ...p, dirty: false } : p)),
    }))
  },

  setEditingTitleId: (id: number | null) => set({ editingTitleId: id }),
}))
