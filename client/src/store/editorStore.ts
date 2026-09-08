import { create } from 'zustand'
import { api } from '../lib/api'
import type { Paste, CreatePastePayload, UpdatePastePayload } from '../types'
import { useSearchStore } from './searchStore'

const DEBOUNCE_MS = 800
const MAX_RETRIES = 3
const MAX_LOCAL_MRU = 5

const debounceTimers: Record<number, ReturnType<typeof setTimeout>> = {}
type RetryTask = {
  attempt: number
  timer: ReturnType<typeof setTimeout>
}
const retryQueue = new Map<number, RetryTask>()

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
  addPaste: (groupId?: number | null) => void
  closeTab: (id: number) => void
  deletePaste: (id: number) => void
  setContent: (content: string, id?: number) => void
  setTitle: (id: number, title: string) => void
  assignGroup: (id: number, groupId: number | null) => void
  clearGroupFromPastes: (groupId: number) => void
  replaceGroupId: (oldId: number, newId: number) => void
  clearDirty: (id: number) => void
  setEditingTitleId: (id: number | null) => void
}

function clearRetry(id: number): void {
  const task = retryQueue.get(id)
  if (task) clearTimeout(task.timer)
  retryQueue.delete(id)
}

function scheduleSync(id: number, get: () => EditorState): void {
  clearTimeout(debounceTimers[id])
  clearRetry(id)
  debounceTimers[id] = setTimeout(() => syncPaste(id, get), DEBOUNCE_MS)
}

function queueRetry(id: number, get: () => EditorState, attempt: number): void {
  if (attempt >= MAX_RETRIES) return

  const nextAttempt = attempt + 1
  const timer = setTimeout(() => syncPaste(id, get, nextAttempt), 1000 * 2 ** attempt)
  retryQueue.set(id, { attempt: nextAttempt, timer })
}

async function syncPaste(id: number, get: () => EditorState, attempt = 1): Promise<void> {
  if (id < 0) return

  const { pastes, clearDirty } = get()
  const paste = pastes.find((p) => p.id === id)
  if (!paste) return
  // Never PUT a temp client group id — backend Zod rejects non-positive ids.
  if (isTempGroupId(paste.group_id)) return

  try {
    await api.put<Paste>(`/api/pastes/${id}`, {
      title: paste.title,
      content: paste.content,
      group_id: paste.group_id ?? null,
    } satisfies UpdatePastePayload)
    clearRetry(id)
    clearDirty(id)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`[sync] paste ${id} failed (attempt ${attempt}):`, message)
    queueRetry(id, get, attempt)
  }
}

async function deleteFromServer(id: number, attempt = 1): Promise<void> {
  if (id < 0) return
  try {
    await api.delete<void>(`/api/pastes/${id}`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`[deletePaste] delete ${id} failed (attempt ${attempt}):`, message)
    if (attempt < MAX_RETRIES) {
      setTimeout(() => deleteFromServer(id, attempt + 1), 1000 * 2 ** attempt)
    }
  }
}

/** True when group_id is a client-only temp id that the API will reject. */
function isTempGroupId(groupId: number | null | undefined): boolean {
  return groupId != null && groupId < 0
}

type EditorSet = (
  partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>),
) => void

/**
 * Persist a local-only paste (id < 0) via POST. Skips if the paste still points
 * at a temp group — wait for replaceGroupId / clearGroupFromPastes to resolve it.
 */
function createPasteOnServer(tempId: number, get: () => EditorState, set: EditorSet): void {
  if (tempId >= 0) return

  const paste = get().pastes.find((p) => p.id === tempId)
  if (!paste) return
  if (isTempGroupId(paste.group_id)) return

  api
    .post<Paste>('/api/pastes', {
      title: paste.title || 'Untitled',
      content: paste.content ?? '',
      group_id: paste.group_id ?? null,
    } satisfies CreatePastePayload)
    .then((res) => {
      if (!res.data) return
      const serverPaste = res.data
      set((state) => ({
        pastes: state.pastes.map((p) => {
          if (p.id !== tempId) return p
          const merged = {
            ...serverPaste,
            title: p.title,
            content: p.content,
            group_id: p.group_id ?? serverPaste.group_id,
            dirty: p.dirty,
          }
          if (p.dirty) setTimeout(() => syncPaste(serverPaste.id, get), 0)
          return merged
        }),
        openTabIds: state.openTabIds.map((id) => (id === tempId ? serverPaste.id : id)),
        activeId: state.activeId === tempId ? serverPaste.id : state.activeId,
      }))
      const current = get().pastes.find((p) => p.id === serverPaste.id)
      useSearchStore.getState().indexPaste({
        id: serverPaste.id,
        title: current?.title ?? serverPaste.title,
        content: current?.content ?? '',
      })
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[addPaste] server sync failed:', message)
    })
}

async function warmSearchIndex(ids: number[]): Promise<void> {
  const searchStore = useSearchStore.getState()
  if (searchStore.hasCachedDocuments()) return

  for (const id of ids) {
    try {
      const detail = await api.get<Paste>(`/api/pastes/${id}`)
      if (detail.data) {
        searchStore.indexPaste({
          id,
          title: detail.data.title,
          content: detail.data.content ?? '',
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error(`[search:warm] paste ${id}:`, message)
    }
  }

  searchStore.flushIndex()
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
              group_id: local.group_id ?? null,
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
      await useSearchStore.getState().ensureReady()
      useSearchStore.getState().hydrateIndex(incoming)

      const firstId = incoming[0].id
      try {
        const detail = await api.get<Paste>(`/api/pastes/${firstId}`)
        if (detail.data) {
          const content = detail.data.content ?? ''
          set((state) => ({
            pastes: state.pastes.map((p) => (p.id === firstId ? { ...p, content } : p)),
          }))
          useSearchStore.getState().indexPaste({
            id: firstId,
            title: detail.data.title,
            content,
          })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[init] failed to load content for paste ${firstId}:`, message)
      }

      void warmSearchIndex(incoming.map((p) => p.id))
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
          useSearchStore.getState().indexPaste({
            id,
            title: res.data.title,
            content,
          })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[load] paste ${id}:`, message)
      }
    }
  },

  addPaste: (groupId?: number | null) => {
    const tempId = localId()
    const paste: Paste = {
      id: tempId,
      title: 'Untitled',
      content: '',
      dirty: false,
      group_id: groupId ?? null,
    }
    set((state) => ({
      pastes: trimLocalMru([...state.pastes, paste], [...state.openTabIds, tempId]),
      openTabIds: [...state.openTabIds, tempId],
      activeId: tempId,
    }))

    // Defer POST until the group has a real server id (temp ids are rejected by Zod).
    if (isTempGroupId(paste.group_id)) return
    createPasteOnServer(tempId, get, set)
  },

  // Close a tab without deleting the paste — it remains in the sidebar
  closeTab: (id: number) => {
    clearTimeout(debounceTimers[id])
    delete debounceTimers[id]
    clearRetry(id)

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
    clearRetry(id)

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

    deleteFromServer(id)
  },

  setContent: (content: string, id) => {
    const targetId = id ?? get().activeId
    if (targetId === null) return
    set((state) => ({
      pastes: state.pastes.map((p) =>
        p.id === targetId ? { ...p, content, dirty: true } : p
      ),
    }))
    scheduleSync(targetId, get)
    const paste = get().pastes.find((p) => p.id === targetId)
    if (paste) useSearchStore.getState().indexPaste({ id: targetId, title: paste.title, content })
  },

  setTitle: (id: number, title: string) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id ? { ...p, title, dirty: true } : p)),
    }))
    scheduleSync(id, get)
    const paste = get().pastes.find((p) => p.id === id)
    if (paste) useSearchStore.getState().indexPaste({ id, title, content: paste.content ?? '' })
  },

  assignGroup: (id: number, groupId: number | null) => {
    set((state) => ({
      pastes: state.pastes.map((p) =>
        p.id === id ? { ...p, group_id: groupId, dirty: true } : p
      ),
    }))
    // Temp group ids are invalid for PUT — wait for replaceGroupId after group POST.
    if (isTempGroupId(groupId)) return
    // Local-only pastes need POST, not PUT.
    if (id < 0) {
      createPasteOnServer(id, get, set)
      return
    }
    scheduleSync(id, get)
  },

  clearGroupFromPastes: (groupId: number) => {
    const pendingCreates: number[] = []
    set((state) => ({
      pastes: state.pastes.map((p) => {
        if (p.group_id !== groupId) return p
        if (p.id < 0) pendingCreates.push(p.id)
        return { ...p, group_id: null }
      }),
    }))
    // Pastes that were waiting on a deleted temp group can now POST as ungrouped.
    for (const tempId of pendingCreates) createPasteOnServer(tempId, get, set)
  },

  replaceGroupId: (oldId: number, newId: number) => {
    const pendingCreates: number[] = []
    const affectedServer: number[] = []
    set((state) => ({
      pastes: state.pastes.map((p) => {
        if (p.group_id !== oldId) return p
        if (p.id < 0) {
          pendingCreates.push(p.id)
          return { ...p, group_id: newId }
        }
        affectedServer.push(p.id)
        return { ...p, group_id: newId, dirty: true }
      }),
    }))
    for (const id of affectedServer) scheduleSync(id, get)
    for (const tempId of pendingCreates) createPasteOnServer(tempId, get, set)
  },

  clearDirty: (id: number) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id ? { ...p, dirty: false } : p)),
    }))
  },

  setEditingTitleId: (id: number | null) => set({ editingTitleId: id }),
}))
