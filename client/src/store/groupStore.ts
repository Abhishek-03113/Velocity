import { create } from 'zustand'
import { api } from '../lib/api'
import type { CreateGroupPayload, Group, GroupFilter, UpdateGroupPayload } from '../types'
import { useEditorStore } from './editorStore'

let _localGroupIdCounter = -1
function localGroupId(): number {
  return _localGroupIdCounter--
}

function nextGroupName(groups: Group[]): string {
  const names = new Set(groups.map((g) => g.name))
  if (!names.has('New Folder')) return 'New Folder'

  let idx = 2
  while (names.has(`New Folder ${idx}`)) idx += 1
  return `New Folder ${idx}`
}

interface GroupState {
  groups: Group[]
  activeGroupId: GroupFilter
  editingGroupId: number | null
  initialized: boolean

  initialize: () => Promise<void>
  setActiveGroupId: (id: GroupFilter) => void
  setEditingGroupId: (id: number | null) => void
  /** Creates a folder optimistically and returns its temporary id. */
  addGroup: (opts?: { edit?: boolean }) => number
  setGroupName: (id: number, name: string) => void
  deleteGroup: (id: number) => void
}

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  activeGroupId: null,
  editingGroupId: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return
    set({ initialized: true })

    try {
      const res = await api.get<Group[]>('/api/groups')
      set({ groups: res.data ?? [] })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[groups:init] failed to load groups:', message)
    }
  },

  setActiveGroupId: (id) => set({ activeGroupId: id }),
  setEditingGroupId: (id) => set({ editingGroupId: id }),

  addGroup: (opts) => {
    const tempId = localGroupId()
    const name = nextGroupName(get().groups)
    const group: Group = { id: tempId, name }

    set((state) => ({
      groups: [...state.groups, group],
      editingGroupId: opts?.edit === false ? state.editingGroupId : tempId,
    }))

    api
      .post<Group>('/api/groups', { name } satisfies CreateGroupPayload)
      .then((res) => {
        if (!res.data) return
        const serverGroup = res.data
        // Preserve any rename that happened while the POST was in flight.
        const latestName = get().groups.find((g) => g.id === tempId)?.name ?? serverGroup.name

        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === tempId ? { ...serverGroup, name: latestName } : g
          ),
          activeGroupId: state.activeGroupId === tempId ? serverGroup.id : state.activeGroupId,
          editingGroupId: state.editingGroupId === tempId ? serverGroup.id : state.editingGroupId,
        }))
        useEditorStore.getState().replaceGroupId(tempId, serverGroup.id)

        if (latestName !== name) {
          api
            .put<Group>(`/api/groups/${serverGroup.id}`, {
              name: latestName,
            } satisfies UpdateGroupPayload)
            .then((renameRes) => {
              if (!renameRes.data) return
              set((state) => ({
                groups: state.groups.map((g) =>
                  g.id === serverGroup.id ? renameRes.data! : g
                ),
              }))
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : 'unknown error'
              console.error(`[groups:rename] group ${serverGroup.id} failed:`, message)
            })
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error('[groups:add] server sync failed:', message)
      })
    return tempId
  },

  setGroupName: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return

    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
    }))

    // Temp groups: local rename is kept; addGroup's POST handler flushes via PUT.
    if (id < 0) return

    api
      .put<Group>(`/api/groups/${id}`, { name: trimmed } satisfies UpdateGroupPayload)
      .then((res) => {
        if (!res.data) return
        set((state) => ({
          groups: state.groups.map((g) => (g.id === id ? res.data! : g)),
        }))
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`[groups:rename] group ${id} failed:`, message)
      })
  },

  deleteGroup: (id) => {
    const previous = get().groups
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
      activeGroupId: state.activeGroupId === id ? null : state.activeGroupId,
      editingGroupId: state.editingGroupId === id ? null : state.editingGroupId,
    }))
    useEditorStore.getState().clearGroupFromPastes(id)

    if (id < 0) return

    api.delete<void>(`/api/groups/${id}`).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error(`[groups:delete] group ${id} failed:`, message)
      set({ groups: previous })
    })
  },
}))
