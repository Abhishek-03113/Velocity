import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useThrottledValue } from '../../hooks/useThrottledValue'
import { primaryKey } from '../../lib/commands'
import { groupColorFor, NOTE_DRAG_TYPE } from '../../lib/groupColors'
import { dateSection, displayTitle, parseTimestamp, relativeTime, snippet } from '../../lib/noteMeta'
import { isMac } from '../../lib/platform'
import {
  exportMarkdown,
  newNote,
  openNote,
  requestDelete,
  startRename,
} from '../../lib/workspace'
import { useEditorStore } from '../../store/editorStore'
import { useGroupStore } from '../../store/groupStore'
import { cachedContent } from '../../store/searchStore'
import { useUiStore } from '../../store/uiStore'
import type { Group, Paste } from '../../types'
import { Icon } from '../Icon'
import type { MenuItem, MenuState } from '../ui/ContextMenu'
import { ToolbarButton } from '../ui/ToolbarButton'
import styles from './Sidebar.module.css'

interface RowModel {
  id: number
  section: string
  title: string
  date: string
  preview: string
  folder?: string
  folderColor?: string
  dirty: boolean
}

interface NoteRowProps {
  row: RowModel
  selected: boolean
  onOpen: (id: number, e: MouseEvent | KeyboardEvent) => void
  onMenu: (id: number, e: MouseEvent) => void
}

const NoteRow = memo(function NoteRow({ row, selected, onOpen, onMenu }: NoteRowProps) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData(NOTE_DRAG_TYPE, String(row.id))
    e.dataTransfer.setData('text/plain', row.title)
  }
  return (
    <li role="presentation">
      <div
        role="option"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        data-note-row={row.id}
        draggable
        onDragStart={onDragStart}
        className={`${styles.noteRow} ${selected ? styles.noteRowSelected : ''}`}
        onClick={(e) => onOpen(row.id, e)}
        onContextMenu={(e) => onMenu(row.id, e)}
      >
        <div className={styles.noteTitleLine}>
          <span className={styles.noteTitle}>{row.title}</span>
          {row.dirty && <span className={styles.unsavedDot} title="Unsaved changes" />}
        </div>
        <div className={styles.noteMetaLine}>
          <span className={styles.noteDate}>{row.date}</span>
          <span className={styles.notePreview}>{row.preview || 'No additional text'}</span>
        </div>
        {row.folder && (
          <div className={styles.noteFolder}>
            <span style={{ color: row.folderColor }}>
              <Icon name="folder" size={12} />
            </span>
            {row.folder}
          </div>
        )}
      </div>
    </li>
  )
}, (prev, next) =>
  prev.selected === next.selected &&
  prev.onOpen === next.onOpen &&
  prev.onMenu === next.onMenu &&
  prev.row.id === next.row.id &&
  prev.row.title === next.row.title &&
  prev.row.date === next.row.date &&
  prev.row.preview === next.row.preview &&
  prev.row.folder === next.row.folder &&
  prev.row.folderColor === next.row.folderColor &&
  prev.row.dirty === next.row.dirty,
)

/** Per-paste cache: unchanged notes keep their object identity across keystrokes. */
const textCache = new WeakMap<Paste, { source: string | undefined; title: string; preview: string }>()

function rowText(p: Paste): { title: string; preview: string } {
  const content = p.content ?? cachedContent(p.id)
  const hit = textCache.get(p)
  if (hit && hit.source === content) return hit
  const title = displayTitle(p, content)
  const entry = { source: content, title, preview: snippet(content, title) }
  textCache.set(p, entry)
  return entry
}

function filterName(filter: number | 'ungrouped' | null, groups: Group[]): string {
  if (filter === null) return 'All Notes'
  if (filter === 'ungrouped') return 'Unfiled'
  return groups.find((g) => g.id === filter)?.name ?? 'Folder'
}

function sortPastes(list: Paste[], order: 'updated' | 'title'): Paste[] {
  const decorated = list.map((p) => ({
    p,
    stamp: parseTimestamp(p.updated_at),
    title: order === 'title' ? rowText(p).title.toLocaleLowerCase() : '',
  }))
  decorated.sort((a, b) =>
    order === 'title' ? a.title.localeCompare(b.title) : b.stamp - a.stamp || b.p.id - a.p.id,
  )
  return decorated.map((d) => d.p)
}

export function NotesColumn({
  onMenu,
  showFolderPicker,
  canShowFolders,
  compact,
}: {
  onMenu: (menu: MenuState) => void
  showFolderPicker: boolean
  /** Wide window with the folders column collapsed — offer to bring it back. */
  canShowFolders: boolean
  compact: boolean
}) {
  const pastes = useEditorStore((s) => s.pastes)
  const activeId = useEditorStore((s) => s.activeId)
  const assignGroup = useEditorStore((s) => s.assignGroup)
  const { groups, activeGroupId, setActiveGroupId } = useGroupStore(
    useShallow((s) => ({
      groups: s.groups,
      activeGroupId: s.activeGroupId,
      setActiveGroupId: s.setActiveGroupId,
    })),
  )
  const { sort, setPref, toggleSidebar, toggleFolders } = useUiStore(
    useShallow((s) => ({
      sort: s.prefs.sort,
      setPref: s.setPref,
      toggleSidebar: s.toggleSidebar,
      toggleFolders: s.toggleFolders,
    })),
  )
  const listRef = useRef<HTMLUListElement>(null)

  // Typing updates `pastes` on every keystroke; the list catches up a few times a
  // second instead (and at low priority) so keystrokes never pay for it.
  const deferredPastes = useDeferredValue(useThrottledValue(pastes, 300))

  const rows = useMemo<RowModel[]>(() => {
    const filtered = deferredPastes.filter((p) => {
      if (activeGroupId === null) return true
      if (activeGroupId === 'ungrouped') return p.group_id == null
      return p.group_id === activeGroupId
    })
    const now = Date.now()
    return sortPastes(filtered, sort).map((p) => {
      const { title, preview } = rowText(p)
      const groupName =
        activeGroupId === null && p.group_id != null
          ? groups.find((g) => g.id === p.group_id)?.name
          : undefined
      const stamp = parseTimestamp(p.updated_at)
      return {
        id: p.id,
        section: sort === 'updated' ? dateSection(stamp, now) : '',
        title,
        date: relativeTime(stamp, now),
        preview,
        folder: groupName,
        folderColor: groupColorFor(groups, p.group_id),
        dirty: p.dirty,
      }
    })
  }, [deferredPastes, activeGroupId, groups, sort])

  const openRow = useCallback((id: number, e: MouseEvent | KeyboardEvent) => {
    const split = e.altKey || (isMac ? e.metaKey : e.ctrlKey)
    openNote(id, { split: split ? 'auto' : false, focus: e.type !== 'click' || split })
  }, [])

  const rowMenu = useCallback(
    (id: number, e: MouseEvent) => {
      e.preventDefault()
      const paste = useEditorStore.getState().pastes.find((p) => p.id === id)
      const moveItems: MenuItem[] = [
        ...groups.map((g) => ({
          label: g.name,
          icon: 'folder' as const,
          checked: paste?.group_id === g.id,
          onSelect: () => assignGroup(id, g.id),
        })),
        {
          label: 'Unfiled',
          icon: 'doc.plaintext' as const,
          checked: paste?.group_id == null,
          onSelect: () => assignGroup(id, null),
        },
      ]
      onMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: 'Open', icon: 'doc.text', onSelect: () => openNote(id) },
          { label: 'Open in New Tile', icon: 'rectangle.split.2x1', shortcut: undefined, onSelect: () => openNote(id, { split: 'auto' }) },
          { separator: true },
          {
            label: 'Rename…',
            icon: 'pencil',
            onSelect: () => {
              openNote(id, { focus: false })
              startRename(id)
            },
          },
          { label: 'Export as Markdown', icon: 'square.and.arrow.down', onSelect: () => exportMarkdown(id) },
          { heading: 'Move to' },
          ...moveItems,
          { separator: true },
          { label: 'Delete Note…', icon: 'trash', destructive: true, onSelect: () => requestDelete(id) },
        ],
      })
    },
    [groups, assignGroup, onMenu],
  )

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement
    const id = Number(target.dataset.noteRow)
    if (!id) return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-note-row]') ?? [])
    const index = items.indexOf(target)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = items[index + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        next.focus()
        // Preview while browsing, like Finder / Mail — keyboard focus stays in the list.
        openNote(Number(next.dataset.noteRow), { focus: false })
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openRow(id, e)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      requestDelete(id)
    }
  }

  const folderPicker = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        { label: 'All Notes', icon: 'tray', checked: activeGroupId === null, onSelect: () => setActiveGroupId(null) },
        {
          label: 'Unfiled',
          icon: 'doc.plaintext',
          checked: activeGroupId === 'ungrouped',
          onSelect: () => setActiveGroupId('ungrouped'),
        },
        ...(groups.length ? [{ separator: true } as const] : []),
        ...groups.map((g) => ({
          label: g.name,
          icon: 'folder' as const,
          checked: activeGroupId === g.id,
          onSelect: () => setActiveGroupId(g.id),
        })),
        { separator: true },
        { label: 'New Folder', icon: 'folder.badge.plus', onSelect: () => useGroupStore.getState().addGroup() },
        { label: 'Settings…', icon: 'gearshape', onSelect: () => useUiStore.getState().setSettingsOpen(true) },
      ],
    })
  }

  const sortMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        { heading: 'Sort by' },
        { label: 'Date Edited', checked: sort === 'updated', onSelect: () => setPref('sort', 'updated') },
        { label: 'Title', checked: sort === 'title', onSelect: () => setPref('sort', 'title') },
      ],
    })
  }

  const title = filterName(activeGroupId, groups)

  return (
    <section className={styles.notes} aria-label="Notes">
      <header className={styles.notesHeader}>
        {showFolderPicker ? (
          <button type="button" className={styles.folderPicker} onClick={folderPicker} aria-haspopup="menu">
            <span className={styles.notesTitle}>{title}</span>
            <Icon name="chevron.down" size={12} strokeWidth={2.2} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.folderPicker}
            onClick={sortMenu}
            aria-haspopup="menu"
            title="Sort notes"
          >
            <span className={styles.notesTitle}>{title}</span>
          </button>
        )}
        <span className={styles.notesCount}>{rows.length}</span>
        <div className={styles.notesActions}>
          {compact ? (
            <ToolbarButton icon="xmark" label="Close Sidebar" onClick={toggleSidebar} />
          ) : canShowFolders ? (
            <ToolbarButton
              icon="sidebar.left"
              label="Show Folders"
              shortcut={primaryKey('view.folders')}
              onClick={toggleFolders}
            />
          ) : !showFolderPicker ? (
            <ToolbarButton
              icon="sidebar.left"
              label="Hide Folders"
              shortcut={primaryKey('view.folders')}
              onClick={toggleFolders}
            />
          ) : (
            <ToolbarButton
              icon="sidebar.left"
              label="Hide Sidebar"
              shortcut={primaryKey('view.sidebar')}
              onClick={toggleSidebar}
            />
          )}
          <ToolbarButton
            icon="square.and.pencil"
            label="New Note"
            shortcut={primaryKey('note.new')}
            onClick={() => newNote()}
          />
        </div>
      </header>

      {rows.length === 0 ? (
        <div className={styles.emptyList}>
          <Icon name="doc.text" size={32} strokeWidth={1.2} />
          <p className={styles.emptyTitle}>No Notes</p>
          <p className={styles.emptyBody}>
            {activeGroupId === null ? 'Create your first note to get started.' : `“${title}” is empty.`}
          </p>
          <button type="button" className={styles.emptyButton} onClick={() => newNote()}>
            New Note
          </button>
        </div>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={`${title} notes`}
          className={styles.noteList}
          onKeyDown={onListKeyDown}
        >
          {rows.map((row, i) => (
            <Fragment key={row.id}>
              {row.section && row.section !== rows[i - 1]?.section && (
                <li role="presentation" className={styles.dateSection}>
                  {row.section}
                </li>
              )}
              <NoteRow row={row} selected={row.id === activeId} onOpen={openRow} onMenu={rowMenu} />
            </Fragment>
          ))}
        </ul>
      )}
    </section>
  )
}
