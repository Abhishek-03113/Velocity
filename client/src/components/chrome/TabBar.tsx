import { memo, useCallback, useState, type DragEvent, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { primaryKey } from '../../lib/commands'
import { NOTE_DRAG_TYPE } from '../../lib/groupColors'
import { displayTitle } from '../../lib/noteMeta'
import { isPrimaryContent } from '../../lib/noteViews'
import { isMac } from '../../lib/platform'
import { findLeaf, leaves, tileNoteId, type TileContent } from '../../lib/tiling'
import { closeTile, focusTile, newNote, openNote } from '../../lib/workspace'
import { pluginName, pluginTileView, pluginWorkspaceView, usePluginsVersion } from '../../plugins/host'
import { useEditorStore } from '../../store/editorStore'
import { useLayoutStore, visibleNoteIds } from '../../store/layoutStore'
import { Icon, type IconName } from '../Icon'
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
      data-note-tab={id}
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

/** Icon and label of a tile that is not a note's primary view (so it has no note tab of its own). */
function tileTabLabel(content: TileContent, noteTitle: string | null): { icon: IconName; title: string } {
  switch (content.kind) {
    case 'empty':
      return { icon: 'plus.circle', title: 'New Tile' }
    case 'view': {
      const spec = pluginWorkspaceView(content.pluginId, content.view)
      return { icon: spec?.icon ?? 'doc.plaintext', title: spec?.title ?? pluginName(content.pluginId) }
    }
    case 'board':
      return { icon: 'scribble', title: `${noteTitle ?? 'Note'} — Whiteboard` }
    case 'plugin': {
      const spec = pluginTileView(content.pluginId, content.view)
      return { icon: spec?.icon ?? 'doc.plaintext', title: `${noteTitle ?? 'Note'} — ${spec?.title ?? pluginName(content.pluginId)}` }
    }
    default:
      return { icon: 'doc.text', title: noteTitle ?? 'Note' }
  }
}

/**
 * Tab of a tile with no note tab of its own: an empty tile, a workspace view (Bookshelf), a whiteboard or a plugin
 * tile beside its note. Clicking focuses the tile; × (or a middle click) closes just that tile.
 */
const TileTab = memo(function TileTab({ tileId, active }: { tileId: string; active: boolean }) {
  usePluginsVersion((s) => s.version)
  const content = useLayoutStore((s) => findLeaf(s.root, tileId)?.content)
  const noteId = content && 'noteId' in content ? content.noteId : null
  const noteTitle = useEditorStore((s) => {
    if (noteId == null) return null
    const p = s.pastes.find((x) => x.id === noteId)
    return p ? displayTitle(p) : null
  })
  if (!content) return null
  const { icon, title } = tileTabLabel(content, noteTitle)
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={title}
      data-tile-tab={tileId}
      className={`${styles.tab} ${active ? styles.tabActive : ''} ${active ? '' : styles.tabVisible}`}
      onClick={() => focusTile(tileId, { dom: true })}
      onAuxClick={(e) => {
        if (e.button === 1) closeTile(tileId)
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
    >
      <Icon name={icon} size={12} className={styles.tabIcon} />
      <span className={styles.tabTitle}>{title}</span>
      <span className={styles.tabTrail}>
        <button
          type="button"
          className={styles.tabClose}
          aria-label={`Close ${title}`}
          title="Close tile"
          onClick={(e) => {
            e.stopPropagation()
            closeTile(tileId)
          }}
        >
          <Icon name="xmark" size={11} strokeWidth={2} />
        </button>
      </span>
    </div>
  )
})

/**
 * Safari-style compact tabs: one per open note, plus one per tile that has no note tab of its own, so every tile is
 * focused and closed from here. Shown when there is more than one tab to choose between.
 */
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
  // Re-resolve which tiles are a note's primary view when plugins are switched on or off.
  usePluginsVersion((s) => s.version)
  const openTabIds = useEditorStore((s) => s.openTabIds)
  // A tile gets its own tab unless a note tab already stands for it (it is that note's primary view).
  const tileTabs = useLayoutStore(
    useShallow((s) =>
      leaves(s.root)
        .filter((l) => {
          const noteId = tileNoteId(l.content)
          return noteId == null || !isPrimaryContent(l.content) || !openTabIds.includes(noteId)
        })
        .map((l) => l.id),
    ),
  )
  const focusedId = useLayoutStore((s) => s.focusedId)
  const focusOnTileTab = tileTabs.includes(focusedId)
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

  if (tabs.length + tileTabs.length < 2) return null

  return (
    <div
      className={styles.tabBar}
      role="tablist"
      aria-label="Open notes"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        const tabsEls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
        const index = tabsEls.indexOf(e.target as HTMLElement)
        if (index < 0) return
        e.preventDefault()
        const next = tabsEls[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabsEls.length) % tabsEls.length]
        next?.focus()
        next?.click()
      }}
    >
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
            active={!focusOnTileTab && id === activeId}
            visible={visible.has(id)}
            onMenu={onMenu}
            onReorder={onReorder}
          />
        )
      })}
      {tileTabs.map((tileId) => (
        <TileTab key={tileId} tileId={tileId} active={tileId === focusedId} />
      ))}
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
