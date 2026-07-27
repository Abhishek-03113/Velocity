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
  if (!names.has('New Group')) return 'New Group'

  let idx = 2
  while (names.has(`New Group ${idx}`)) idx += 1
  return `New Group ${idx}`
}

interface GroupState {
  groups: Group[]
  activeGroupId: GroupFilter
  editingGroupId: number | null
  initialized: boolean

  initialize: () => Promise<void>
  setActiveGroupId: (id: GroupFilter) => void
  setEditingGroupId: (id: number | null) => void
  addGroup: () => void
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

  addGroup: () => {
    const tempId = localGroupId()
    const name = nextGroupName(get().groups)
    const group: Group = { id: tempId, name }

    set((state) => ({
      groups: [...state.groups, group],
      editingGroupId: tempId,
    }))

    api
      .post<Group>('/api/groups', { name } satisfies CreateGroupPayload)
      .then((res) => {
        if (!res.data) return
        const serverGroup = res.data
        set((state) => ({
          groups: state.groups.map((g) => (g.id === tempId ? serverGroup : g)),
          activeGroupId: state.activeGroupId === tempId ? serverGroup.id : state.activeGroupId,
          editingGroupId: state.editingGroupId === tempId ? serverGroup.id : state.editingGroupId,
        }))
        useEditorStore.getState().replaceGroupId(tempId, serverGroup.id)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error('[groups:add] server sync failed:', message)
      })
  },

  setGroupName: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return

    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
    }))

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
