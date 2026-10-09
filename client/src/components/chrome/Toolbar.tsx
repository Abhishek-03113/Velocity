import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { primaryKey } from '../../lib/commands'
import { moveMenuItems } from '../../lib/moveMenu'
import { displayTitle } from '../../lib/noteMeta'
import { comboLabel } from '../../lib/platform'
import { findLeaf, leaves } from '../../lib/tiling'
import {
  closeTile,
  duplicateNote,
  exportMarkdown,
  newNote,
  requestDelete,
  splitTile,
  toggleBoard,
  toggleReadMode,
} from '../../lib/workspace'
import { useEditorStore } from '../../store/editorStore'
import { useGroupStore } from '../../store/groupStore'
import { focusedNoteId, useLayoutStore } from '../../store/layoutStore'
import { useUiStore } from '../../store/uiStore'
import { Icon } from '../Icon'
import { ContextMenu, type MenuState } from '../ui/ContextMenu'
import { Segmented } from '../ui/Segmented'
import { ToolbarButton } from '../ui/ToolbarButton'
import styles from './Chrome.module.css'

/** Inline title editor — Enter / blur commits, Escape cancels. */
function TitleField({ noteId, initial, onDone }: { noteId: number; initial: string; onDone: () => void }) {
  const [draft, setDraft] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const committed = useRef(false)
  useEffect(() => {
    ref.current?.select()
  }, [])
  const commit = () => {
    if (committed.current) return
    committed.current = true
    useEditorStore.getState().setTitle(noteId, draft)
    onDone()
  }
  return (
    <input
      ref={ref}
      autoFocus
      className={styles.titleInput}
      value={draft}
      aria-label="Note title"
      placeholder="Title"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          committed.current = true
          onDone()
        }
      }}
    />
  )
}

/** Unified window toolbar (HIG): sidebar toggle, title + folder, view controls. */
export default function Toolbar() {
  const { sidebarOpen, toggleSidebar } = useUiStore(
    useShallow((s) => ({ sidebarOpen: s.sidebarOpen, toggleSidebar: s.toggleSidebar })),
  )
  const { noteId, tileMode, tileCount, focusedKind, boardOpen } = useLayoutStore(
    useShallow((s) => {
      const leaf = findLeaf(s.root, s.focusedId)
      const id = focusedNoteId(s)
      return {
        noteId: id,
        tileMode: leaf?.content.kind === 'note' ? leaf.content.mode : null,
        focusedKind: leaf?.content.kind ?? 'empty',
        tileCount: leaves(s.root).length,
        boardOpen:
          id != null && leaves(s.root).some((l) => l.content.kind === 'board' && l.content.noteId === id),
      }
    }),
  )
  const { title, explicitTitle, groupId, editing } = useEditorStore(
    useShallow((s) => {
      const p = s.pastes.find((x) => x.id === noteId)
      return {
        title: p ? displayTitle(p) : '',
        explicitTitle: p && p.title !== 'Untitled' ? p.title : '',
        groupId: p?.group_id ?? null,
        editing: noteId != null && s.editingTitleId === noteId,
      }
    }),
  )
  const groupName = useGroupStore((s) => s.groups.find((g) => g.id === groupId)?.name)

  useEffect(() => {
    document.title = title ? `${title} — Velocity` : 'Velocity'
  }, [title])
  const setEditingTitleId = useEditorStore((s) => s.setEditingTitleId)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const moveMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (noteId == null) return
    const rect = e.currentTarget.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + 6, items: [{ heading: 'Move to' }, ...moveMenuItems(noteId)] })
  }

  const moreMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const id = noteId
    setMenu({
      x: rect.right - 240,
      y: rect.bottom + 6,
      items: [
        { label: 'Rename…', icon: 'pencil', shortcut: primaryKey('note.rename'), disabled: id == null, onSelect: () => setEditingTitleId(id) },
        { label: 'Duplicate', icon: 'doc.on.doc', disabled: id == null, onSelect: () => duplicateNote(id) },
        { label: 'Export as Markdown', icon: 'square.and.arrow.down', shortcut: primaryKey('note.export'), disabled: id == null, onSelect: () => exportMarkdown(id) },
        { separator: true },
        { label: 'Split Right', icon: 'rectangle.split.2x1', shortcut: primaryKey('tile.splitRight'), onSelect: () => splitTile('row') },
        { label: 'Split Down', icon: 'rectangle.split.1x2', shortcut: primaryKey('tile.splitDown'), onSelect: () => splitTile('column') },
        ...(tileCount > 1
          ? [
              { label: 'Zoom Tile', icon: 'arrow.up.left.and.arrow.down.right' as const, shortcut: primaryKey('tile.zoom'), onSelect: () => useLayoutStore.getState().toggleZoom() },
              { label: 'Close Tile', icon: 'xmark' as const, shortcut: primaryKey('tile.close'), onSelect: () => closeTile() },
            ]
          : []),
        { separator: true },
        { label: 'Keyboard Shortcuts', icon: 'keyboard', shortcut: primaryKey('app.shortcuts'), onSelect: () => useUiStore.getState().setShortcutsOpen(true) },
        { label: 'Settings…', icon: 'gearshape', shortcut: primaryKey('app.settings'), onSelect: () => useUiStore.getState().setSettingsOpen(true) },
        { separator: true },
        { label: 'Delete Note…', icon: 'trash', destructive: true, disabled: id == null, onSelect: () => requestDelete(id) },
      ],
    })
  }

  return (
    <header className={styles.toolbar}>
      <div className={styles.toolbarLeading}>
        {!sidebarOpen && (
          <ToolbarButton
            icon="sidebar.left"
            label="Show Sidebar"
            shortcut={primaryKey('view.sidebar')}
            onClick={toggleSidebar}
          />
        )}
        <div className={styles.titleBlock}>
          {editing && noteId != null ? (
            <TitleField noteId={noteId} initial={explicitTitle || title} onDone={() => setEditingTitleId(null)} />
          ) : (
            <button
              type="button"
              className={styles.titleButton}
              title="Rename (F2)"
              disabled={noteId == null}
              onClick={() => setEditingTitleId(noteId)}
            >
              <span className={styles.titleText}>{noteId == null ? 'Velocity' : title}</span>
            </button>
          )}
          {focusedKind === 'empty' || noteId == null ? (
            <span className={styles.subtitle}>Empty tile</span>
          ) : (
            <button
              type="button"
              className={`${styles.subtitle} ${styles.subtitleButton}`}
              title={`Move to Folder (${comboLabel(primaryKey('note.moveToFolder') ?? '')})`}
              aria-haspopup="menu"
              onClick={moveMenu}
            >
              <Icon name="folder" size={11} />
              <span>{groupName ?? 'Unfiled'}</span>
              <Icon name="chevron.down" size={9} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>

      <div className={styles.toolbarTrailing}>
        {tileMode && (
          <Segmented
            label="Mode"
            iconOnly
            value={tileMode}
            onChange={(mode) => {
              if (mode !== tileMode) toggleReadMode()
            }}
            options={[
              { value: 'edit', label: 'Edit', icon: 'pencil', title: `Edit` },
              { value: 'read', label: 'Read', icon: 'book', title: `Read` },
            ]}
          />
        )}
        <span className={styles.toolbarSpacer} />
        <ToolbarButton
          icon="scribble"
          label={boardOpen ? 'Hide Whiteboard' : 'Show Whiteboard'}
          shortcut={primaryKey('view.board')}
          active={boardOpen}
          disabled={noteId == null}
          onClick={toggleBoard}
        />
        <ToolbarButton
          className={styles.hideCompact}
          icon="rectangle.split.2x1"
          label="Split Tile"
          shortcut={primaryKey('tile.split')}
          onClick={() => splitTile('auto')}
        />
        <ToolbarButton
          icon="square.and.pencil"
          label="New Note"
          shortcut={primaryKey('note.new')}
          onClick={() => newNote()}
          className={styles.hideWhenSidebar}
          data-sidebar={sidebarOpen ? 'open' : 'closed'}
        />
        <ToolbarButton
          icon="magnifyingglass"
          label="Search"
          shortcut={primaryKey('nav.quickOpen')}
          onClick={() => useUiStore.getState().openPalette('notes')}
        />
        <ToolbarButton icon="ellipsis.circle" label="More" onClick={moreMenu} aria-haspopup="menu" />
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </header>
  )
}
