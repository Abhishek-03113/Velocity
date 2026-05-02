import { create } from 'zustand'

let nextId = 2

export const useEditorStore = create((set, get) => ({
  pastes: [{ id: 1, title: 'Untitled', content: '' }],
  activeId: 1,
  editingTitleId: null,

  getActivePaste: () => {
    const { pastes, activeId } = get()
    return pastes.find((p) => p.id === activeId) ?? pastes[0]
  },

  setActiveId: (id) => set({ activeId: id }),

  addPaste: () => {
    const id = nextId++
    set((state) => ({
      pastes: [...state.pastes, { id, title: 'Untitled', content: '' }],
      activeId: id,
    }))
  },

  closePaste: (id) => {
    set((state) => {
      const pastes = state.pastes.filter((p) => p.id !== id)
      if (pastes.length === 0) {
        const newId = nextId++
        return { pastes: [{ id: newId, title: 'Untitled', content: '' }], activeId: newId }
      }
      const activeId = state.activeId === id
        ? pastes[Math.max(0, state.pastes.findIndex((p) => p.id === id) - 1)].id
        : state.activeId
      return { pastes, activeId }
    })
  },

  setContent: (content) => {
    set((state) => ({
      pastes: state.pastes.map((p) =>
        p.id === state.activeId ? { ...p, content } : p
      ),
    }))
  },

  setTitle: (id, title) => {
    set((state) => ({
      pastes: state.pastes.map((p) => (p.id === id ? { ...p, title } : p)),
    }))
  },

  setEditingTitleId: (id) => set({ editingTitleId: id }),
}))
