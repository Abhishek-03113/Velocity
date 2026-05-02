import { create } from 'zustand'
import { api } from '../lib/api'
import type { Paste, CreatePastePayload, UpdatePastePayload } from '../types'

const DEBOUNCE_MS = 800
const MAX_RETRIES = 3

const debounceTimers: Record<number, ReturnType<typeof setTimeout>> = {}

let _localIdCounter = -1
function localId(): number {
  return _localIdCounter--
}

interface EditorState {
  pastes: Paste[]
  activeId: number | null
  editingTitleId: number | null
  initialized: boolean

  initialize: () => Promise<void>
  getActivePaste: () => Paste | null
  setActiveId: (id: number) => Promise<void>
  addPaste: () => void
  closePaste: (id: number) => void
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

const _initialPaste: Paste = { id: localId(), title: 'Untitled', content: '', dirty: false }

export const useEditorStore = create<EditorState>((set, get) => ({
  pastes: [_initialPaste],
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
        if (pastes.length > 0) {
          const local = pastes[0]
          try {
            const created = await api.post<Paste>('/api/pastes', {
              title: local.title,
              content: local.content,
            } satisfies CreatePastePayload)
            if (created.data) {
              const serverPaste = created.data
              set((state) => ({
                pastes: state.pastes.map((p) =>
                  p.id === local.id ? { ...serverPaste, dirty: false } : p
                ),
                activeId: serverPaste.id,
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
          set({ pastes: [paste], activeId: paste.id })
        }
        return
      }

      const incoming = list.map((p) => ({ ...p, content: p.content ?? '', dirty: false }))
      set({ pastes: incoming, activeId: incoming[0].id })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[init] failed to load pastes:', message)
    }
  },

  getActivePaste: () => {
    const { pastes, activeId } = get()
    return pastes.find((p) => p.id === activeId) ?? pastes[0] ?? null
  },

  setActiveId: async (id: number) => {
    set({ activeId: id })
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
    set((state) => ({ pastes: [...state.pastes, paste], activeId: tempId }))

    api
      .post<Paste>('/api/pastes', { title: 'Untitled', content: '' } satisfies CreatePastePayload)
      .then((res) => {
        if (!res.data) return
        const serverPaste = res.data
        set((state) => ({
          pastes: state.pastes.map((p) =>
            p.id === tempId ? { ...serverPaste, dirty: false } : p
          ),
          activeId: state.activeId === tempId ? serverPaste.id : state.activeId,
        }))
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error('[addPaste] server sync failed:', message)
      })
  },

  closePaste: (id: number) => {
    clearTimeout(debounceTimers[id])
    delete debounceTimers[id]

    set((state) => {
      const pastes = state.pastes.filter((p) => p.id !== id)
      if (pastes.length === 0) {
        return { pastes: [], activeId: null }
      }
      const activeId =
        state.activeId === id
          ? pastes[Math.max(0, state.pastes.findIndex((p) => p.id === id) - 1)].id
          : state.activeId
      return { pastes, activeId }
    })

    if (get().pastes.length === 0) {
      get().addPaste()
    }

    if (id > 0) {
      api.delete<void>(`/api/pastes/${id}`).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[closePaste] delete ${id} failed:`, message)
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
  },

  setTitle: (id: number, title: string) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id ? { ...p, title, dirty: true } : p)),
    }))
    scheduleSync(id, get)
  },

  clearDirty: (id: number) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id ? { ...p, dirty: false } : p)),
    }))
  },

  setEditingTitleId: (id: number | null) => set({ editingTitleId: id }),
}))
