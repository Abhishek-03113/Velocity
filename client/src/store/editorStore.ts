import { create } from 'zustand'
import { api, apiBaseUrl } from '../lib/api'
import { focusEditor, remapEditor } from '../lib/editorRegistry'
import { createSyncEngine, type SyncField, type SyncStatus } from '../lib/syncEngine'
import { UNTITLED } from '../lib/noteMeta'
import { welcomeNote } from '../lib/welcome'
import type { Paste, CreatePastePayload, UpdatePastePayload } from '../types'
import { focusedNoteId, markLayoutRestored, useLayoutStore, visibleNoteIds } from './layoutStore'
import type { SplitRequest } from './layoutStore'
import { cachedContent, useSearchStore } from './searchStore'
import { migrateLocalBoards, remapBoard, removeBoardScene, seedBoardFlags } from './whiteboardStore'

const MAX_LOCAL_MRU = 5
const INDEX_DEBOUNCE_MS = 250
const TABS_KEY = 'velocity.tabs.v1'

let _localIdCounter = -1
function localId(): number {
  return _localIdCounter--
}

export interface OpenOptions {
  /** Open in a new tile instead of the focused one. */
  split?: SplitRequest | false
  /** Move keyboard focus into the editor (default true). */
  focus?: boolean
}

interface EditorState {
  pastes: Paste[]
  openTabIds: number[]
  activeId: number | null
  editingTitleId: number | null
  initialized: boolean
  /** First API load finished (or failed) — UI can render real content. */
  loaded: boolean
  /** Per-note save status; absent means fully saved. */
  syncStatus: Record<number, SyncStatus>

  initialize: () => Promise<void>
  getActivePaste: () => Paste | null
  getOpenTabs: () => Paste[]
  /** Open a note in the workspace (reveals it in the focused tile). */
  setActiveId: (id: number, opts?: OpenOptions) => Promise<void>
  /** Mark a note active without moving it between tiles (tile focus changes). */
  activateNote: (id: number) => void
  ensureContent: (id: number) => Promise<void>
  addPaste: (groupId?: number | null, opts?: OpenOptions) => number
  closeTab: (id: number) => void
  closeOtherTabs: (id: number) => void
  moveTab: (id: number, toIndex: number) => void
  deletePaste: (id: number) => void
  setContent: (content: string, id?: number) => void
  setTitle: (id: number, title: string) => void
  assignGroup: (id: number, groupId: number | null) => void
  clearGroupFromPastes: (groupId: number) => void
  replaceGroupId: (oldId: number, newId: number) => void
  clearDirty: (id: number) => void
  setEditingTitleId: (id: number | null) => void
  saveNow: () => Promise<void>
}

/** True when group_id is a client-only temp id that the API will reject. */
function isTempGroupId(groupId: number | null | undefined): boolean {
  return groupId != null && groupId < 0
}

const contentLoads = new Map<number, Promise<void>>()
const indexTimers = new Map<number, ReturnType<typeof setTimeout>>()

function scheduleIndex(id: number): void {
  const existing = indexTimers.get(id)
  if (existing) clearTimeout(existing)
  indexTimers.set(
    id,
    setTimeout(() => {
      indexTimers.delete(id)
      const paste = useEditorStore.getState().pastes.find((p) => p.id === id)
      if (paste) {
        useSearchStore.getState().indexPaste({ id, title: paste.title, content: paste.content ?? '' })
      }
    }, INDEX_DEBOUNCE_MS),
  )
}

function persistTabs(): void {
  const { openTabIds, activeId } = useEditorStore.getState()
  try {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ openTabIds: openTabIds.filter((id) => id > 0), activeId }),
    )
  } catch {
    // Storage unavailable — tabs just won't be restored.
  }
}

function readPersistedTabs(): { openTabIds: number[]; activeId: number | null } {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (!raw) return { openTabIds: [], activeId: null }
    const parsed = JSON.parse(raw) as { openTabIds?: unknown; activeId?: unknown }
    return {
      openTabIds: Array.isArray(parsed.openTabIds)
        ? parsed.openTabIds.filter((id): id is number => Number.isInteger(id))
        : [],
      activeId: typeof parsed.activeId === 'number' ? parsed.activeId : null,
    }
  } catch {
    return { openTabIds: [], activeId: null }
  }
}

// ---------------------------------------------------------------------------
// Auto-save worker wiring
// ---------------------------------------------------------------------------

async function sendUpdate(
  id: number,
  payload: UpdatePastePayload,
  { keepalive }: { keepalive: boolean },
): Promise<void> {
  if (keepalive) {
    const body = JSON.stringify(payload)
    // keepalive requests are capped (~64 KB) by browsers; larger bodies use a normal fetch.
    await fetch(`${apiBaseUrl()}/api/pastes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60_000,
    })
    return
  }
  await api.put<Paste>(`/api/pastes/${id}`, payload)
}

export const syncEngine = createSyncEngine({
  snapshot: (id) => {
    const paste = useEditorStore.getState().pastes.find((p) => p.id === id)
    if (!paste) return null
    return { title: paste.title, content: paste.content, group_id: paste.group_id ?? null }
  },
  send: (id, payload, opts) => sendUpdate(id, payload, opts),
  onSaved: (id) => useEditorStore.getState().clearDirty(id),
  onStatus: (id, status) => {
    useEditorStore.setState((state) => {
      const current = state.syncStatus[id]
      if (current === status || (status == null && current === undefined)) return state
      const next = { ...state.syncStatus }
      if (status == null) delete next[id]
      else next[id] = status
      return { syncStatus: next }
    })
  },
})

function markDirty(id: number, fields: SyncField[]): void {
  syncEngine.markDirty(id, fields)
}

if (typeof window !== 'undefined') {
  const flushOnExit = () => syncEngine.flushOnExit()
  window.addEventListener('pagehide', flushOnExit)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncEngine.flushAll()
    else syncEngine.retryFailed()
  })
  window.addEventListener('online', () => syncEngine.retryFailed())
  window.addEventListener('focus', () => syncEngine.retryFailed())
}

// ---------------------------------------------------------------------------

async function deleteFromServer(id: number, attempt = 1): Promise<void> {
  if (id < 0) return
  try {
    await api.delete<void>(`/api/pastes/${id}`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`[deletePaste] delete ${id} failed (attempt ${attempt}):`, message)
    if (attempt < 3) {
      setTimeout(() => void deleteFromServer(id, attempt + 1), 1000 * 2 ** attempt)
    }
  }
}

type EditorSet = (
  partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>),
) => void

const creating = new Set<number>()

/**
 * Persist a local-only paste (id < 0) via POST. Skips if the paste still points
 * at a temp group — wait for replaceGroupId / clearGroupFromPastes to resolve it.
 */
function createPasteOnServer(tempId: number, get: () => EditorState, set: EditorSet): void {
  if (tempId >= 0 || creating.has(tempId)) return

  const paste = get().pastes.find((p) => p.id === tempId)
  if (!paste) return
  if (isTempGroupId(paste.group_id)) return
  creating.add(tempId)

  api
    .post<Paste>('/api/pastes', {
      title: paste.title || UNTITLED,
      content: paste.content ?? '',
      group_id: paste.group_id ?? null,
    } satisfies CreatePastePayload)
    .then((res) => {
      if (!res.data) return
      const serverPaste = res.data
      if (!get().pastes.some((p) => p.id === tempId)) {
        // Deleted while the POST was in flight.
        void deleteFromServer(serverPaste.id)
        return
      }
      set((state) => ({
        pastes: state.pastes.map((p) => {
          if (p.id !== tempId) return p
          return {
            ...serverPaste,
            cid: p.cid,
            title: p.title,
            content: p.content,
            group_id: p.group_id ?? serverPaste.group_id,
            updated_at: p.updated_at ?? serverPaste.updated_at,
            dirty: p.dirty,
          }
        }),
        openTabIds: state.openTabIds.map((id) => (id === tempId ? serverPaste.id : id)),
        activeId: state.activeId === tempId ? serverPaste.id : state.activeId,
        editingTitleId: state.editingTitleId === tempId ? serverPaste.id : state.editingTitleId,
      }))
      useLayoutStore.getState().remapNote(tempId, serverPaste.id)
      remapEditor(tempId, serverPaste.id)
      remapBoard(tempId, serverPaste.id)
      syncEngine.remap(tempId, serverPaste.id)
      persistTabs()
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
      // Retry creation when the network comes back.
      setTimeout(() => createPasteOnServer(tempId, get, set), 4000)
    })
    .finally(() => creating.delete(tempId))
}

async function warmSearchIndex(ids: number[]): Promise<void> {
  const searchStore = useSearchStore.getState()
  // Only fetch notes whose text isn't cached yet (first run, or created on another device).
  const queue = ids.filter((id) => !cachedContent(id))
  if (queue.length === 0) return

  // Small concurrency pool — fast warmup without flooding the server.
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!
      try {
        const detail = await api.get<Paste>(`/api/pastes/${id}`)
        if (detail.data) {
          searchStore.indexPaste({ id, title: detail.data.title, content: detail.data.content ?? '' })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[search:warm] paste ${id}:`, message)
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  searchStore.flushIndex()
  // Snippets in the notes list read from the search cache — refresh once warm.
  useEditorStore.setState((s) => ({ pastes: [...s.pastes] }))
}

// Trim local-only (id < 0) pastes in the sidebar to the MRU cap.
// Named pastes (title !== 'Untitled') are always kept regardless of server ID.
function trimLocalMru(pastes: Paste[], openTabIds: number[]): Paste[] {
  const openSet = new Set(openTabIds)
  const closedUntitled = pastes.filter(
    (p) => p.id < 0 && p.title === UNTITLED && !p.content && !openSet.has(p.id),
  )
  const overflow = closedUntitled.length - MAX_LOCAL_MRU
  if (overflow <= 0) return pastes
  const drop = new Set(closedUntitled.slice(0, overflow).map((p) => p.id))
  return pastes.filter((p) => !drop.has(p.id))
}

function nowStamp(): string {
  return new Date().toISOString()
}

/** After a tile change, make the focused tile's note the active one (or pick a tab). */
function syncActiveFromLayout(get: () => EditorState, set: EditorSet, preferredFallback: number | null) {
  const focused = focusedNoteId(useLayoutStore.getState())
  if (focused != null) {
    set({ activeId: focused })
    return
  }
  const { openTabIds } = get()
  const fallback =
    preferredFallback != null && openTabIds.includes(preferredFallback)
      ? preferredFallback
      : (openTabIds[openTabIds.length - 1] ?? null)
  if (fallback != null) void get().setActiveId(fallback, { focus: false })
  else set({ activeId: null })
}

export const useEditorStore = create<EditorState>((set, get) => ({
  pastes: [],
  openTabIds: [],
  activeId: null,
  editingTitleId: null,
  initialized: false,
  loaded: false,
  syncStatus: {},

  initialize: async () => {
    if (get().initialized) return
    set({ initialized: true })

    let list: Paste[]
    try {
      const res = await api.get<Paste[]>('/api/pastes')
      list = (res.data ?? []).map((p) => ({
        ...p,
        // SQLite returns 0/1.
        has_whiteboard: Boolean(p.has_whiteboard),
        content: undefined,
        dirty: false,
      }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[init] failed to load pastes:', message)
      // Offline first run — still let the user write; it POSTs once the API is reachable.
      set({ loaded: true })
      get().addPaste(null, { focus: true })
      return
    }

    seedBoardFlags(list)
    // Move pre-SQLite localStorage boards to the server (idempotent, in the background).
    void migrateLocalBoards(list)

    if (list.length === 0) {
      set({ loaded: true })
      const id = get().addPaste(null, { focus: false })
      get().setContent(welcomeNote(), id)
      return
    }

    set({ pastes: list })
    await useSearchStore.getState().ensureReady()
    useSearchStore.getState().hydrateIndex(list)

    // Restore tabs + tiles from the last session; fall back to the most recent note.
    const valid = new Set(list.map((p) => p.id))
    const saved = readPersistedTabs()
    let openTabIds = saved.openTabIds.filter((id) => valid.has(id))
    const layout = useLayoutStore.getState()
    layout.restore((id) => valid.has(id))
    markLayoutRestored()
    for (const id of visibleNoteIds(useLayoutStore.getState().root)) {
      if (!openTabIds.includes(id)) openTabIds.push(id)
    }
    if (openTabIds.length === 0) openTabIds = [list[0]!.id]
    const focused = focusedNoteId(useLayoutStore.getState())
    const activeId =
      focused ?? (saved.activeId != null && openTabIds.includes(saved.activeId) ? saved.activeId : openTabIds[0]!)

    set({ openTabIds, activeId, loaded: true })
    useLayoutStore.getState().revealNote(activeId)

    await Promise.all(
      [activeId, ...visibleNoteIds(useLayoutStore.getState().root)].map((id) => get().ensureContent(id)),
    )
    persistTabs()
    void warmSearchIndex(list.map((p) => p.id))
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

  ensureContent: (id) => {
    const paste = get().pastes.find((p) => p.id === id)
    if (!paste || paste.content !== undefined || id < 0) return Promise.resolve()
    const inflight = contentLoads.get(id)
    if (inflight) return inflight
    const load = api
      .get<Paste>(`/api/pastes/${id}`)
      .then((res) => {
        if (!res.data) return
        const content = res.data.content ?? ''
        set((state) => ({
          pastes: state.pastes.map((p) =>
            p.id === id && p.content === undefined ? { ...p, content } : p,
          ),
        }))
        useSearchStore.getState().indexPaste({ id, title: res.data.title, content })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[load] paste ${id}:`, message)
      })
      .finally(() => contentLoads.delete(id))
    contentLoads.set(id, load)
    return load
  },

  setActiveId: async (id: number, opts: OpenOptions = {}) => {
    if (!get().pastes.some((p) => p.id === id)) return
    set((state) => ({
      activeId: id,
      openTabIds: state.openTabIds.includes(id) ? state.openTabIds : [...state.openTabIds, id],
    }))
    const layout = useLayoutStore.getState()
    if (opts.split) {
      const existing = layout.root && visibleNoteIds(layout.root).includes(id)
      if (existing) layout.revealNote(id)
      else layout.split(opts.split, { kind: 'note', noteId: id, mode: 'edit' })
    } else {
      layout.revealNote(id)
    }
    persistTabs()
    if (opts.focus !== false) focusEditor(id)
    await get().ensureContent(id)
  },

  activateNote: (id) => {
    if (get().activeId === id) return
    set((state) => ({
      activeId: id,
      openTabIds: state.openTabIds.includes(id) ? state.openTabIds : [...state.openTabIds, id],
    }))
    persistTabs()
    void get().ensureContent(id)
  },

  addPaste: (groupId?: number | null, opts: OpenOptions = {}) => {
    const tempId = localId()
    const paste: Paste = {
      id: tempId,
      cid: `t${tempId}`,
      title: UNTITLED,
      content: '',
      dirty: false,
      group_id: groupId ?? null,
      updated_at: nowStamp(),
      created_at: nowStamp(),
    }
    set((state) => {
      const openTabIds = [...state.openTabIds, tempId]
      return {
        pastes: trimLocalMru([paste, ...state.pastes], openTabIds),
        openTabIds,
        activeId: tempId,
      }
    })
    const layout = useLayoutStore.getState()
    if (opts.split) layout.split(opts.split, { kind: 'note', noteId: tempId, mode: 'edit' })
    else layout.revealNote(tempId)
    // New notes always open in edit mode.
    const leafId = useLayoutStore.getState().focusedId
    layout.setMode(leafId, 'edit')
    if (opts.focus !== false) focusEditor(tempId)

    // Defer POST until the group has a real server id (temp ids are rejected by Zod).
    if (!isTempGroupId(paste.group_id)) createPasteOnServer(tempId, get, set)
    return tempId
  },

  // Close a tab without deleting the paste — it remains in the sidebar.
  closeTab: (id: number) => {
    // Flush, never cancel: closing right after typing must not lose the edit.
    void syncEngine.flush(id)
    const { openTabIds } = get()
    const idx = openTabIds.indexOf(id)
    const neighbourTab = openTabIds[idx - 1] ?? openTabIds[idx + 1] ?? null

    set((state) => {
      const nextTabs = state.openTabIds.filter((tid) => tid !== id)
      return {
        openTabIds: nextTabs,
        pastes: trimLocalMru(state.pastes, nextTabs),
        editingTitleId: state.editingTitleId === id ? null : state.editingTitleId,
      }
    })
    useLayoutStore.getState().dropNote(id)

    if (get().openTabIds.length === 0) {
      get().addPaste()
      return
    }
    syncActiveFromLayout(get, set, neighbourTab)
    persistTabs()
  },

  closeOtherTabs: (id: number) => {
    for (const other of get().openTabIds.filter((tid) => tid !== id)) get().closeTab(other)
    void get().setActiveId(id)
  },

  moveTab: (id, toIndex) => {
    set((state) => {
      const tabs = state.openTabIds.filter((tid) => tid !== id)
      const clamped = Math.max(0, Math.min(tabs.length, toIndex))
      tabs.splice(clamped, 0, id)
      return { openTabIds: tabs }
    })
    persistTabs()
  },

  // Explicit delete — removes paste from sidebar and server.
  deletePaste: (id: number) => {
    syncEngine.forget(id)
    const pending = indexTimers.get(id)
    if (pending) clearTimeout(pending)
    indexTimers.delete(id)

    const { openTabIds } = get()
    const idx = openTabIds.indexOf(id)
    const neighbourTab = openTabIds[idx - 1] ?? openTabIds[idx + 1] ?? null

    set((state) => ({
      pastes: state.pastes.filter((p) => p.id !== id),
      openTabIds: state.openTabIds.filter((tid) => tid !== id),
      editingTitleId: state.editingTitleId === id ? null : state.editingTitleId,
    }))
    useLayoutStore.getState().dropNote(id)
    removeBoardScene(id)

    if (get().openTabIds.length === 0) {
      const next = get().pastes[0]
      if (next) void get().setActiveId(next.id, { focus: false })
      else get().addPaste()
    } else {
      syncActiveFromLayout(get, set, neighbourTab)
    }

    useSearchStore.getState().removePaste(id)
    persistTabs()
    void deleteFromServer(id)
  },

  setContent: (content: string, id) => {
    const targetId = id ?? get().activeId
    if (targetId === null) return
    const stamp = nowStamp()
    set((state) => ({
      pastes: state.pastes.map((p) =>
        p.id === targetId ? { ...p, content, dirty: true, updated_at: stamp } : p,
      ),
    }))
    markDirty(targetId, ['content'])
    // Re-tokenising a whole note per keystroke is expensive — index on idle instead.
    scheduleIndex(targetId)
  },

  setTitle: (id: number, title: string) => {
    const next = title.trim() || UNTITLED
    const paste = get().pastes.find((p) => p.id === id)
    if (!paste || paste.title === next) return
    set((state) => ({
      pastes: state.pastes.map((p) =>
        p.id === id ? { ...p, title: next, dirty: true, updated_at: nowStamp() } : p,
      ),
    }))
    markDirty(id, ['title'])
    useSearchStore.getState().indexPaste({ id, title: next, content: paste.content ?? '' })
  },

  assignGroup: (id: number, groupId: number | null) => {
    set((state) => ({
      pastes: state.pastes.map((p) =>
        p.id === id ? { ...p, group_id: groupId, dirty: true } : p,
      ),
    }))
    // Temp group ids are invalid for PUT — wait for replaceGroupId after group POST.
    if (isTempGroupId(groupId)) return
    // Local-only pastes need POST, not PUT.
    if (id < 0) {
      createPasteOnServer(id, get, set)
      return
    }
    markDirty(id, ['group_id'])
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
    for (const id of affectedServer) markDirty(id, ['group_id'])
    for (const tempId of pendingCreates) createPasteOnServer(tempId, get, set)
  },

  clearDirty: (id: number) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id && p.dirty ? { ...p, dirty: false } : p)),
    }))
  },

  setEditingTitleId: (id: number | null) => set({ editingTitleId: id }),

  saveNow: async () => {
    syncEngine.retryFailed()
    await syncEngine.flushAll()
  },
}))
