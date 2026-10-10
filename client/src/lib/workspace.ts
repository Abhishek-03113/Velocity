/**
 * Workspace actions — the glue between the tiling layout, the note store and
 * DOM focus. UI components and keyboard commands both call these so behaviour
 * is identical no matter how an action is triggered.
 */
import { openSearchPanel } from '@codemirror/search'
import { useEditorStore } from '../store/editorStore'
import { useGroupStore } from '../store/groupStore'
import { focusedNoteId, useLayoutStore, type SplitRequest } from '../store/layoutStore'
import { useUiStore } from '../store/uiStore'
import { focusEditor, getEditor } from './editorRegistry'
import { displayTitle } from './noteMeta'
import { findLeaf, leaves, type Direction } from './tiling'

const narrow = () => typeof window !== 'undefined' && window.innerWidth < 760

function afterOpenOnNarrow() {
  // On phones the sidebar is an overlay — get it out of the way once a note opens.
  if (narrow()) useUiStore.getState().setSidebarOpen(false)
}

export function openNote(id: number, opts: { split?: SplitRequest | false; focus?: boolean } = {}) {
  void useEditorStore.getState().setActiveId(id, opts)
  afterOpenOnNarrow()
}

export function newNote(opts: { split?: SplitRequest | false; groupId?: number | null } = {}) {
  const { activeGroupId } = useGroupStore.getState()
  const groupId =
    opts.groupId !== undefined ? opts.groupId : typeof activeGroupId === 'number' ? activeGroupId : null
  useEditorStore.getState().addPaste(groupId, { split: opts.split ?? false })
  afterOpenOnNarrow()
}

/**
 * Put a note into a specific tile. A note shows in at most one editor tile,
 * so if it is already visible elsewhere it *moves* here (Hyprland-style).
 */
export function placeNoteInTile(tileId: string, noteId: number) {
  const layout = useLayoutStore.getState()
  const existing = leaves(layout.root).find(
    (l) => l.content.kind === 'note' && l.content.noteId === noteId,
  )
  if (existing?.id === tileId) {
    focusTile(tileId, { dom: true })
    return
  }
  if (existing && leaves(layout.root).length > 1) layout.close(existing.id)
  const target = useLayoutStore.getState()
  if (!findLeaf(target.root, tileId)) return
  target.setContent(tileId, { kind: 'note', noteId, mode: 'edit' })
  target.focus(tileId)
  void useEditorStore.getState().setActiveId(noteId)
}

export function currentNoteId(): number | null {
  return focusedNoteId(useLayoutStore.getState()) ?? useEditorStore.getState().activeId
}

/** Focus a tile (and the DOM inside it) — used by clicks and directional keys. */
export function focusTile(tileId: string, opts: { dom?: boolean } = {}) {
  const layout = useLayoutStore.getState()
  layout.focus(tileId)
  const tile = findLeaf(useLayoutStore.getState().root, tileId)
  if (!tile || tile.content.kind === 'empty') {
    if (opts.dom) document.querySelector<HTMLElement>(`[data-tile-id="${tileId}"] input`)?.focus()
    return
  }
  useEditorStore.getState().activateNote(tile.content.noteId)
  if (opts.dom) {
    if (tile.content.kind === 'note' && tile.content.mode === 'edit') focusEditor(tile.content.noteId)
    else document.querySelector<HTMLElement>(`[data-tile-id="${tileId}"] [data-tile-body]`)?.focus()
  }
}

export function focusDirection(dir: Direction) {
  const target = useLayoutStore.getState().focusDirection(dir)
  if (target) focusTile(target, { dom: true })
}

export function swapDirection(dir: Direction) {
  useLayoutStore.getState().swapDirection(dir)
  focusTile(useLayoutStore.getState().focusedId, { dom: true })
}

export function splitTile(request: SplitRequest) {
  useLayoutStore.getState().split(request, { kind: 'empty' })
  focusTile(useLayoutStore.getState().focusedId, { dom: true })
}

export function toggleTilingMode() {
  const layout = useLayoutStore.getState()
  layout.toggleTilingMode()
  const mode = useLayoutStore.getState().mode
  useUiStore.getState().showFlash(mode === 'sliding' ? 'Sliding tiling: tiles are columns' : 'Dwindle tiling')
}

export function setFocusedColumnWidth(width: number) {
  const { columns, focusedId, setColumnWidth } = useLayoutStore.getState()
  const col = columns.find((c) => c.tiles.includes(focusedId))
  if (col) setColumnWidth(col.id, width, true)
}

export function closeTile(tileId?: string) {
  const layout = useLayoutStore.getState()
  const id = tileId ?? layout.focusedId
  if (leaves(layout.root).length <= 1) {
    // Last tile: closing it means closing its note tab (a fresh one replaces it).
    const tile = findLeaf(layout.root, id)
    if (tile && tile.content.kind !== 'empty') useEditorStore.getState().closeTab(tile.content.noteId)
    return
  }
  layout.close(id)
  focusTile(useLayoutStore.getState().focusedId, { dom: true })
}

export function toggleReadMode(tileId?: string) {
  const layout = useLayoutStore.getState()
  const tile = findLeaf(layout.root, tileId ?? layout.focusedId)
  if (!tile || tile.content.kind !== 'note') return
  const mode = tile.content.mode === 'edit' ? 'read' : 'edit'
  layout.setMode(tile.id, mode)
  if (mode === 'edit') focusEditor(tile.content.noteId)
}

export function toggleBoard() {
  const id = currentNoteId()
  if (id == null) return
  useLayoutStore.getState().toggleBoard(id)
}

export function findInNote() {
  const layout = useLayoutStore.getState()
  const tile = findLeaf(layout.root, layout.focusedId)
  if (!tile || tile.content.kind !== 'note') {
    useUiStore.getState().openPalette('notes')
    return
  }
  const noteId = tile.content.noteId
  if (tile.content.mode === 'read') layout.setMode(tile.id, 'edit')
  requestAnimationFrame(() => {
    const view = getEditor(noteId)
    if (view) {
      openSearchPanel(view)
    }
  })
}

export function cycleTab(delta: 1 | -1) {
  const { openTabIds, activeId } = useEditorStore.getState()
  if (openTabIds.length === 0) return
  const idx = activeId == null ? -1 : openTabIds.indexOf(activeId)
  const next = openTabIds[(idx + delta + openTabIds.length) % openTabIds.length]
  if (next != null) openNote(next)
}

export function goToTab(n: number) {
  const { openTabIds } = useEditorStore.getState()
  // ⌃⌥9 always means "last tab", like browsers.
  const id = n >= 9 ? openTabIds[openTabIds.length - 1] : openTabIds[n - 1]
  if (id != null) openNote(id)
}

export function requestDelete(id: number | null = currentNoteId()) {
  if (id == null) return
  const paste = useEditorStore.getState().pastes.find((p) => p.id === id)
  if (!paste) return
  const title = displayTitle(paste)
  const doDelete = () => useEditorStore.getState().deletePaste(id)
  // Empty notes go without ceremony; anything with content asks first.
  if (!paste.content?.trim() && paste.content !== undefined) {
    doDelete()
    return
  }
  useUiStore.getState().confirm({
    title: `Delete “${title}”?`,
    message: 'This note will be permanently deleted. This action can’t be undone.',
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: doDelete,
  })
}

export function requestDeleteGroup(groupId: number) {
  const group = useGroupStore.getState().groups.find((g) => g.id === groupId)
  if (!group) return
  const count = useEditorStore.getState().pastes.filter((p) => p.group_id === groupId).length
  useUiStore.getState().confirm({
    title: `Delete folder “${group.name}”?`,
    message:
      count > 0
        ? `The ${count === 1 ? 'note' : `${count} notes`} inside will move to Unfiled. Notes are never deleted with a folder.`
        : 'This folder is empty.',
    confirmLabel: 'Delete Folder',
    destructive: true,
    onConfirm: () => useGroupStore.getState().deleteGroup(groupId),
  })
}

export function startRename(id: number | null = currentNoteId()) {
  if (id == null) return
  useEditorStore.getState().setEditingTitleId(id)
}

export function duplicateNote(id: number | null = currentNoteId()) {
  if (id == null) return
  const paste = useEditorStore.getState().pastes.find((p) => p.id === id)
  if (!paste) return
  const store = useEditorStore.getState()
  const copyId = store.addPaste(paste.group_id ?? null)
  store.setContent(paste.content ?? '', copyId)
  store.setTitle(copyId, `${displayTitle(paste)} copy`)
}

export function exportMarkdown(id: number | null = currentNoteId()) {
  if (id == null) return
  const paste = useEditorStore.getState().pastes.find((p) => p.id === id)
  if (!paste) return
  const title = displayTitle(paste)
  const blob = new Blob([paste.content ?? ''], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // eslint-disable-next-line no-control-regex -- strip characters invalid in filenames
  a.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 120) || 'Note'}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  useUiStore.getState().showFlash(`Exported “${title}.md”`)
}

export async function saveNow() {
  await useEditorStore.getState().saveNow()
  const pending = Object.keys(useEditorStore.getState().syncStatus).length
  useUiStore.getState().showFlash(pending ? 'Couldn’t reach the server. Will keep retrying.' : 'All changes saved')
}

export function adjustTextSize(delta: number) {
  const { prefs, setPref } = useUiStore.getState()
  if (delta === 0) setPref('editorSize', 16)
  else setPref('editorSize', Math.max(12, Math.min(24, prefs.editorSize + delta)))
}

export function cycleAppearance() {
  const { prefs, resolvedTheme, setPref } = useUiStore.getState()
  if (prefs.theme === 'system') setPref('theme', resolvedTheme === 'dark' ? 'light' : 'dark')
  else setPref('theme', prefs.theme === 'dark' ? 'light' : 'dark')
}

export function focusNotesList() {
  const ui = useUiStore.getState()
  if (!ui.sidebarOpen) ui.setSidebarOpen(true)
  requestAnimationFrame(() => {
    const el =
      document.querySelector<HTMLElement>('[data-note-row][aria-selected="true"]') ??
      document.querySelector<HTMLElement>('[data-note-row]')
    el?.focus()
  })
}
