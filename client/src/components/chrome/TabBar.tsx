import { memo, useCallback, useState, type DragEvent, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { primaryKey } from '../../lib/commands'
import { NOTE_DRAG_TYPE } from '../../lib/groupColors'
import { displayTitle } from '../../lib/noteMeta'
import { isMac } from '../../lib/platform'
import { newNote, openNote } from '../../lib/workspace'
import { useEditorStore } from '../../store/editorStore'
import { useLayoutStore, visibleNoteIds } from '../../store/layoutStore'
import { Icon } from '../Icon'
import { ContextMenu, type MenuState } from '../ui/ContextMenu'
import { ToolbarButton } from '../ui/ToolbarButton'
import styles from './Chrome.module.css'

interface TabProps {
  id: number
  title: string
  dirty: boolean
  active: boolean
  visible: boolean
  index: number
  onMenu: (id: number, e: MouseEvent) => void
  onReorder: (id: number, index: number) => void
}

const Tab = memo(function Tab({ id, title, dirty, active, visible, index, onMenu, onReorder }: TabProps) {
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null)

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData(NOTE_DRAG_TYPE, String(id))
    e.dataTransfer.setData('application/x-velocity-tab', String(id))
    e.dataTransfer.setData('text/plain', title)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('application/x-velocity-tab')) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    setDropSide(e.clientX < r.left + r.width / 2 ? 'before' : 'after')
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const dragged = Number(e.dataTransfer.getData('application/x-velocity-tab'))
    setDropSide(null)
    if (!dragged) return
    e.preventDefault()
    e.stopPropagation()
    onReorder(dragged, dropSide === 'after' ? index + 1 : index)
  }

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      draggable
      title={title}
      className={`${styles.tab} ${active ? styles.tabActive : ''} ${visible && !active ? styles.tabVisible : ''} ${
        dropSide ? styles[`tabDrop_${dropSide}`] : ''
      }`}
      onClick={(e) => openNote(id, { split: e.altKey || (isMac ? e.metaKey : e.ctrlKey) ? 'auto' : false })}
      onDoubleClick={() => useEditorStore.getState().setEditingTitleId(id)}
      onAuxClick={(e) => {
        if (e.button === 1) useEditorStore.getState().closeTab(id)
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onContextMenu={(e) => onMenu(id, e)}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={() => setDropSide(null)}
      onDrop={onDrop}
    >
      <span className={styles.tabTitle}>{title}</span>
      <span className={styles.tabTrail}>
        {dirty && <span className={styles.tabDirty} aria-label="Unsaved changes" />}
        <button
          type="button"
          className={styles.tabClose}
          aria-label={`Close ${title}`}
          title="Close tab"
          onClick={(e) => {
            e.stopPropagation()
            useEditorStore.getState().closeTab(id)
          }}
        >
          <Icon name="xmark" size={11} strokeWidth={2} />
        </button>
      </span>
    </div>
  )
})

/** Safari-style compact tabs — only shown when more than one note is open. */
export default function TabBar() {
  const tabs = useEditorStore(
    useShallow((s) => {
      const map = new Map(s.pastes.map((p) => [p.id, p]))
      return s.openTabIds.map((id) => {
        const p = map.get(id)
        return p ? `${id}\u0000${displayTitle(p)}\u0000${p.dirty ? 1 : 0}` : ''
      })
    }),
  )
  const activeId = useEditorStore((s) => s.activeId)
  const visibleKey = useLayoutStore((s) => visibleNoteIds(s.root).join(','))
  const visible = new Set(visibleKey.split(',').map(Number))
  const [menu, setMenu] = useState<MenuState | null>(null)

  const onMenu = useCallback((id: number, e: MouseEvent) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Open in New Tile', icon: 'rectangle.split.2x1', onSelect: () => openNote(id, { split: 'auto' }) },
        { label: 'Rename…', icon: 'pencil', onSelect: () => useEditorStore.getState().setEditingTitleId(id) },
        { separator: true },
        { label: 'Close Tab', icon: 'xmark', shortcut: primaryKey('note.close'), onSelect: () => useEditorStore.getState().closeTab(id) },
        { label: 'Close Other Tabs', onSelect: () => useEditorStore.getState().closeOtherTabs(id) },
      ],
    })
  }, [])

  const onReorder = useCallback((id: number, index: number) => {
    const tabsNow = useEditorStore.getState().openTabIds
    const from = tabsNow.indexOf(id)
    useEditorStore.getState().moveTab(id, from < index ? index - 1 : index)
  }, [])

  if (tabs.length < 2) return null

  return (
    <div className={styles.tabBar} role="tablist" aria-label="Open notes">
      {tabs.map((key, index) => {
        if (!key) return null
        const [idStr, title, dirty] = key.split('\u0000')
        const id = Number(idStr)
        return (
          <Tab
            key={id}
            id={id}
            index={index}
            title={title!}
            dirty={dirty === '1'}
            active={id === activeId}
            visible={visible.has(id)}
            onMenu={onMenu}
            onReorder={onReorder}
          />
        )
      })}
      <ToolbarButton
        icon="plus"
        size="small"
        label="New Note"
        shortcut={primaryKey('note.new')}
        className={styles.tabNew}
        onClick={() => newNote()}
      />
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
