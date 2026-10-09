import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { primaryKey } from '../../lib/commands'
import { moveMenuItems } from '../../lib/moveMenu'
import { groupColor, NOTE_DRAG_TYPE } from '../../lib/groupColors'
import { comboLabel } from '../../lib/platform'
import { newNote, requestDeleteGroup } from '../../lib/workspace'
import { useEditorStore } from '../../store/editorStore'
import { useGroupStore } from '../../store/groupStore'
import { useUiStore } from '../../store/uiStore'
import type { GroupFilter } from '../../types'
import { Icon, type IconName } from '../Icon'
import type { MenuState } from '../ui/ContextMenu'
import { ToolbarButton } from '../ui/ToolbarButton'
import styles from './Sidebar.module.css'

interface SourceRowProps {
  icon: IconName
  tint?: string
  label: string
  count: number
  selected: boolean
  dropTarget: boolean
  editing?: boolean
  onSelect: () => void
  onRename?: (name: string) => void
  onCancelRename?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: MouseEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
}

const SourceRow = memo(function SourceRow({
  icon,
  tint,
  label,
  count,
  selected,
  dropTarget,
  editing,
  onSelect,
  onRename,
  onCancelRename,
  onDoubleClick,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
}: SourceRowProps) {
  const [draft, setDraft] = useState(label)
  useEffect(() => {
    if (editing) setDraft(label)
  }, [editing, label])

  return (
    <li
      className={`${styles.sourceRow} ${selected ? styles.sourceRowSelected : ''} ${
        dropTarget ? styles.sourceRowDrop : ''
      }`}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      {editing ? (
        <div className={styles.sourceButton}>
          <span className={styles.sourceIcon} style={tint ? { color: tint } : undefined}>
            <Icon name={icon} size={17} />
          </span>
          <input
            className={styles.renameInput}
            value={draft}
            autoFocus
            aria-label="Folder name"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onRename?.(draft)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') onRename?.(draft)
              if (e.key === 'Escape') onCancelRename?.()
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.sourceButton}
          aria-current={selected || undefined}
          onClick={onSelect}
          onDoubleClick={onDoubleClick}
        >
          <span className={styles.sourceIcon} style={tint ? { color: tint } : undefined}>
            <Icon name={icon} size={17} />
          </span>
          <span className={styles.sourceLabel}>{label}</span>
          <span className={styles.sourceCount}>{count}</span>
        </button>
      )}
    </li>
  )
})

export function FoldersColumn({ onMenu }: { onMenu: (menu: MenuState) => void }) {
  const { groups, activeGroupId, editingGroupId, setActiveGroupId, setEditingGroupId, addGroup, setGroupName } =
    useGroupStore(
      useShallow((s) => ({
        groups: s.groups,
        activeGroupId: s.activeGroupId,
        editingGroupId: s.editingGroupId,
        setActiveGroupId: s.setActiveGroupId,
        setEditingGroupId: s.setEditingGroupId,
        addGroup: s.addGroup,
        setGroupName: s.setGroupName,
      })),
    )
  // Only counts are needed here — avoid re-rendering on every keystroke.
  const counts = useEditorStore(
    useShallow((s) => {
      const byGroup: Record<string, number> = { all: s.pastes.length, none: 0 }
      for (const p of s.pastes) {
        const key = p.group_id == null ? 'none' : String(p.group_id)
        byGroup[key] = (byGroup[key] ?? 0) + 1
      }
      return byGroup
    }),
  )
  const assignGroup = useEditorStore((s) => s.assignGroup)
  const { toggleSidebar, setSettingsOpen, openPalette } = useUiStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      setSettingsOpen: s.setSettingsOpen,
      openPalette: s.openPalette,
    })),
  )
  const [foldersExpanded, setFoldersExpanded] = useState(true)
  const [dropTarget, setDropTarget] = useState<GroupFilter | 'none' | 'header' | undefined>(undefined)
  const springTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(springTimer.current), [])

  const colors = useMemo(() => new Map(groups.map((g, i) => [g.id, groupColor(i)])), [groups])

  const dragProps = (target: number | null) => {
    const key: GroupFilter | 'none' = target ?? 'none'
    return {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropTarget(key)
      },
      onDragLeave: (e: DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDropTarget(undefined)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setDropTarget(undefined)
        const id = Number(e.dataTransfer.getData(NOTE_DRAG_TYPE))
        if (Number.isFinite(id) && id !== 0) assignGroup(id, target)
      },
    }
  }

  // The "Folders" header is a forgiving target too: hovering a collapsed section
  // springs it open; dropping there offers a menu of folders to file into.
  const headerDragProps = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget('header')
      if (!foldersExpanded && springTimer.current === undefined) {
        springTimer.current = setTimeout(() => {
          springTimer.current = undefined
          setFoldersExpanded(true)
        }, 450)
      }
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return
      clearTimeout(springTimer.current)
      springTimer.current = undefined
      setDropTarget(undefined)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      clearTimeout(springTimer.current)
      springTimer.current = undefined
      setDropTarget(undefined)
      const id = Number(e.dataTransfer.getData(NOTE_DRAG_TYPE))
      if (!Number.isFinite(id) || id === 0) return
      onMenu({ x: e.clientX, y: e.clientY, items: [{ heading: 'Move to' }, ...moveMenuItems(id)] })
    },
  }

  const folderMenu = (e: MouseEvent, groupId: number) => {
    e.preventDefault()
    onMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New Note in Folder', icon: 'square.and.pencil', onSelect: () => newNote({ groupId }) },
        { label: 'Rename Folder', icon: 'pencil', onSelect: () => setEditingGroupId(groupId) },
        { separator: true },
        { label: 'Delete Folder…', icon: 'trash', destructive: true, onSelect: () => requestDeleteGroup(groupId) },
      ],
    })
  }

  const searchKey = primaryKey('nav.quickOpen')

  return (
    <div className={styles.folders}>
      <div className={styles.foldersHeader}>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src="/brand/logo-64.png" alt="" width={24} height={24} />
          <span className={styles.brandName}>Velocity</span>
        </div>
        <ToolbarButton icon="sidebar.left" label="Hide Sidebar" shortcut={primaryKey('view.sidebar')} onClick={toggleSidebar} />
      </div>

      <button type="button" className={styles.searchField} onClick={() => openPalette('notes')}>
        <Icon name="magnifyingglass" size={14} />
        <span>Search</span>
        {searchKey && <span className={styles.searchHint}>{comboLabel(searchKey)}</span>}
      </button>

      <nav className={styles.sourceList} aria-label="Folders">
        <div className={styles.sectionHeader}>
          <span>Library</span>
        </div>
        <ul>
          <SourceRow
            icon="tray"
            label="All Notes"
            count={counts.all ?? 0}
            selected={activeGroupId === null}
            dropTarget={false}
            onSelect={() => setActiveGroupId(null)}
          />
        </ul>

        <div
          className={`${styles.sectionHeader} ${dropTarget === 'header' ? styles.sectionHeaderDrop : ''}`}
          {...headerDragProps}
        >
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={foldersExpanded}
            onClick={() => setFoldersExpanded((v) => !v)}
          >
            <span>Folders</span>
            <Icon name="chevron.down" size={11} strokeWidth={2.2} className={styles.disclosureIcon} />
          </button>
          <ToolbarButton icon="plus" label="New Folder" size="small" onClick={() => addGroup()} />
        </div>
        {foldersExpanded && (
          <ul>
            {groups.map((g) => (
              <SourceRow
                key={g.id}
                icon="folder"
                tint={colors.get(g.id)}
                label={g.name}
                count={counts[String(g.id)] ?? 0}
                selected={activeGroupId === g.id}
                dropTarget={dropTarget === g.id}
                editing={editingGroupId === g.id}
                onSelect={() => setActiveGroupId(g.id)}
                onDoubleClick={() => setEditingGroupId(g.id)}
                onRename={(name) => {
                  if (name.trim()) setGroupName(g.id, name)
                  setEditingGroupId(null)
                }}
                onCancelRename={() => setEditingGroupId(null)}
                onContextMenu={(e) => folderMenu(e, g.id)}
                {...dragProps(g.id)}
              />
            ))}
            {groups.length === 0 && (
              <li className={styles.sourceEmpty}>No folders yet. Create one with +.</li>
            )}
          </ul>
        )}

        <ul className={styles.unfiledList}>
          <SourceRow
            icon="doc.plaintext"
            label="Unfiled"
            count={counts.none ?? 0}
            selected={activeGroupId === 'ungrouped'}
            dropTarget={dropTarget === 'none'}
            onSelect={() => setActiveGroupId('ungrouped')}
            {...dragProps(null)}
          />
        </ul>
      </nav>

      <div className={styles.foldersFooter}>
        <button type="button" className={styles.footerButton} onClick={() => addGroup()}>
          <Icon name="plus.circle" size={16} />
          <span>New Folder</span>
        </button>
        <ToolbarButton
          icon="gearshape"
          label="Settings"
          shortcut={primaryKey('app.settings')}
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </div>
  )
}
