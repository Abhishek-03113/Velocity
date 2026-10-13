/**
 * Browser-only flows through the real stores (not just the backend router): what a user does,
 * then a page exit, then what is actually in localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.doMock('../runtime', () => ({ BROWSER_ONLY: true }))
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})

afterEach(() => {
  vi.doUnmock('../runtime')
  vi.unstubAllGlobals()
})

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0))
}

describe('browser-only flows', () => {
  it('moving a note into a new folder survives an immediate page exit', async () => {
    const { useEditorStore, syncEngine } = await import('../../store/editorStore')
    const { useGroupStore } = await import('../../store/groupStore')
    const { moveNoteToNewFolder } = await import('../workspace')
    const db = await import('./db')

    await useEditorStore.getState().initialize()
    await useGroupStore.getState().initialize()
    await settle()

    const id = useEditorStore.getState().addPaste(null, { focus: false })
    useEditorStore.getState().setContent('Filed note', id)
    await settle()
    const realId = useEditorStore.getState().activeId!
    expect(realId).toBeGreaterThan(0)

    moveNoteToNewFolder(realId)
    await settle()
    const group = useGroupStore.getState().groups.find((g) => g.name.startsWith('New Folder'))!
    expect(group.id).toBeGreaterThan(0)

    // Reload before the 800 ms debounce: only the pagehide flush can save the move.
    syncEngine.flushOnExit()
    expect(db.getPasteMeta(realId)?.group_id).toBe(group.id)
  })

  it('same flow with the folders column open, inline rename and real page-exit events', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))
    const { useEditorStore } = await import('../../store/editorStore')
    const { useGroupStore } = await import('../../store/groupStore')
    const { useUiStore } = await import('../../store/uiStore')
    const { moveNoteToNewFolder } = await import('../workspace')
    const db = await import('./db')

    await useEditorStore.getState().initialize()
    await useGroupStore.getState().initialize()
    useUiStore.setState({ sidebarOpen: true, foldersOpen: true })
    await settle()
    const id = useEditorStore.getState().addPaste(null, { focus: false })
    useEditorStore.getState().setContent('Filed note', id)
    await settle()
    const realId = useEditorStore.getState().activeId!

    moveNoteToNewFolder(realId)
    expect(useGroupStore.getState().editingGroupId).not.toBeNull()
    await settle()
    const g = useGroupStore.getState().groups.find((x) => x.name.startsWith('New Folder'))!
    useGroupStore.getState().setGroupName(g.id, g.name) // Enter in the inline field

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    expect(db.getPasteMeta(realId)?.group_id).toBe(g.id)
  })

  it('race: page exit right after the move, before the folder POST reply is processed', async () => {
    const { useEditorStore } = await import('../../store/editorStore')
    const { useGroupStore } = await import('../../store/groupStore')
    const { moveNoteToNewFolder } = await import('../workspace')
    const db = await import('./db')
    await useEditorStore.getState().initialize()
    await useGroupStore.getState().initialize()
    await settle()
    const id = useEditorStore.getState().addPaste(null, { focus: false })
    useEditorStore.getState().setContent('Filed note', id)
    await settle()
    const realId = useEditorStore.getState().activeId!

    moveNoteToNewFolder(realId)
    // A reload's pagehide is a later task: only the microtasks queued by the move can run first.
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    window.dispatchEvent(new Event('pagehide'))
    const g = db.listGroups().find((x) => x.name.startsWith('New Folder'))!
    expect(db.getPasteMeta(realId)?.group_id).toBe(g.id)
  })
})
