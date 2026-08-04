import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type EditorMode } from './components/Editor'
import DrawingCanvas from './components/DrawingCanvas'
import MarkdownPreview from './components/MarkdownPreview'
import PasteList from './components/PasteList'
import SearchModal from './components/SearchModal'
import ShortcutsModal from './components/ShortcutsModal'
import { useEditorStore } from './store/editorStore'
import { useGroupStore } from './store/groupStore'
import { useSearchStore } from './store/searchStore'
import type { Paste } from './types'
import { createDrawing, parseDrawing } from './lib/drawing'
import styles from './App.module.css'

interface TabProps {
  paste: Paste
  isActive: boolean
  isEditing: boolean
  groupColor?: string
  onActivate: () => void
  onClose: () => void
  onDoubleClick: () => void
  onTitleChange: (value: string) => void
  onTitleBlur: () => void
  onTitleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

function Tab({
  paste,
  isActive,
  isEditing,
  groupColor,
  onActivate,
  onClose,
  onDoubleClick,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
}: TabProps) {
  return (
    <div
      className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
      onClick={onActivate}
    >
      {groupColor && (
        <span
          className={styles.tabGroupMark}
          style={{ backgroundColor: groupColor }}
        />
      )}
      {isEditing ? (
        <input
          className={styles.tabInput}
          defaultValue={paste.title}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onTitleChange(e.target.value)}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
        />
      ) : (
        <span className={styles.tabTitle} onDoubleClick={onDoubleClick}>
          {paste.title || 'Untitled'}
        </span>
      )}
      {paste.dirty && <span className={styles.tabDirty} title="Unsaved changes" />}
      <button
        className={styles.tabClose}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
    </div>
  )
}

const GROUP_COLORS = ['#7aa7ff', '#82d39e', '#d4a96a', '#c58de2', '#d97878']

export default function App() {
  const {
    pastes,
    activeId,
    editingTitleId,
    setActiveId,
    addPaste,
    closeTab,
    setContent,
    setTitle,
    setEditingTitleId,
    getActivePaste,
    getOpenTabs,
    initialize,
    deletePaste,
    assignGroup,
  } = useEditorStore()
  const {
    groups,
    activeGroupId,
    editingGroupId,
    initialize: initializeGroups,
    setActiveGroupId,
    setEditingGroupId,
    addGroup,
    setGroupName,
    deleteGroup,
  } = useGroupStore()
  const { isOpen: searchOpen, openSearch, closeSearch } = useSearchStore()
  const activePaste = getActivePaste()
  const openTabs = getOpenTabs()
  const activeDrawing = parseDrawing(activePaste?.content)
  const [pendingTitle, setPendingTitle] = useState('')
  const [editorMode, setEditorMode] = useState<EditorMode>('plain')
  const [readMode, setReadMode] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [splitDrawingId, setSplitDrawingId] = useState<number | null>(null)
  const [drawingWidth, setDrawingWidth] = useState(50)
  const lastNoteId = useRef<number | null>(null)
  const splitDrawingPaste = pastes.find((paste) => paste.id === splitDrawingId)
  const splitDrawing = parseDrawing(splitDrawingPaste?.content)
  const groupColorById = useMemo(() => {
    return new Map(groups.map((group, index) => [group.id, GROUP_COLORS[index % GROUP_COLORS.length]]))
  }, [groups])

  useEffect(() => {
    initialize()
    initializeGroups()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const code = e.code
      const keyStr = e.key.toLowerCase()

      const isF = code === 'KeyF' || keyStr === 'f'
      const isN = code === 'KeyN' || keyStr === 'n'
      const isW = code === 'KeyW' || keyStr === 'w'
      const isOne = code === 'Digit1' || keyStr === '1'

      if (mod && e.shiftKey && isF) {
        e.preventDefault()
        openSearch()
      } else if (mod && !e.shiftKey && isF) {
        e.preventDefault()
        window.dispatchEvent(new Event('velocity:open-inline-search'))
      } else if (mod && !e.shiftKey && isN) {
        e.preventDefault()
        addPaste()
      } else if (mod && !e.shiftKey && isW) {
        e.preventDefault()
        const currentId = useEditorStore.getState().activeId
        if (currentId != null) closeTab(currentId)
      } else if (mod && !e.shiftKey && isOne) {
        e.preventDefault()
        setSidebarOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep drawings in the secondary pane so their serialized scene is never shown as note text.
  useEffect(() => {
    setReadMode(false)
    closeSearch()
    if (!activePaste) return
    if (activeDrawing) {
      setSplitDrawingId(activePaste.id)
      const noteId = lastNoteId.current
        ?? pastes.find((paste) => paste.id !== activePaste.id && paste.content !== undefined && !parseDrawing(paste.content))?.id
      if (noteId != null && noteId !== activePaste.id) void setActiveId(noteId)
    } else if (activePaste.content !== undefined) {
      lastNoteId.current = activePaste.id
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activePaste?.content])

  const commitTitle = (id: number) => {
    if (pendingTitle.trim()) setTitle(id, pendingTitle.trim())
    setEditingTitleId(null)
    setPendingTitle('')
  }

  const openDrawing = () => {
    if (!activePaste) return
    const drawingId = addPaste('Drawing', createDrawing(), setSplitDrawingId)
    setSplitDrawingId(drawingId)
    void setActiveId(activePaste.id)
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const resize = (moveEvent: PointerEvent) => {
      const width = ((bounds.right - moveEvent.clientX) / bounds.width) * 100
      setDrawingWidth(Math.min(75, Math.max(25, width)))
    }
    const stopResize = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResize)
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResize)
  }

  if (!activePaste) return null

  return (
    <div className={styles.app}>
      {searchOpen && (
        <SearchModal onSelect={(id) => setActiveId(id)} />
      )}
      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {openTabs.map((paste) => (
            <Tab
              key={paste.id}
              paste={paste}
              isActive={paste.id === activeId}
              isEditing={paste.id === editingTitleId}
              groupColor={paste.group_id ? groupColorById.get(paste.group_id) : undefined}
              onActivate={() => {
                if (parseDrawing(paste.content)) setSplitDrawingId(paste.id)
                else void setActiveId(paste.id)
              }}
              onClose={() => closeTab(paste.id)}
              onDoubleClick={() => {
                setPendingTitle(paste.title)
                setEditingTitleId(paste.id)
              }}
              onTitleChange={setPendingTitle}
              onTitleBlur={() => commitTitle(paste.id)}
              onTitleKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle(paste.id)
                if (e.key === 'Escape') setEditingTitleId(null)
              }}
            />
          ))}
          <button className={styles.addTab} onClick={() => addPaste()} title="New paste">
            +
          </button>
          <button
            className={styles.addDrawing}
            onClick={openDrawing}
            title="New drawing"
          >
            ✎
          </button>
        </div>
        <button
          className={styles.shortcutsBtn}
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts"
        >
          ?
        </button>
        <button
          className={`${styles.sidebarToggle} ${sidebarOpen ? styles.sidebarToggleActive : ''}`}
          onClick={() => setSidebarOpen((open) => !open)}
          title="Toggle sidebar"
        >
          ◧
        </button>
        <div className={styles.modeTabs} aria-label="Editor mode">
          <button
            className={`${styles.modeBtn} ${!readMode && editorMode === 'plain' ? styles.modeBtnActive : ''}`}
            onClick={() => {
              setEditorMode('plain')
              setReadMode(false)
            }}
          >
            Plain
          </button>
          <button
            className={`${styles.modeBtn} ${!readMode && editorMode === 'markdown' ? styles.modeBtnActive : ''}`}
            onClick={() => {
              setEditorMode('markdown')
              setReadMode(false)
            }}
          >
            Markdown
          </button>
          <button
            className={`${styles.modeBtn} ${readMode ? styles.modeBtnActive : ''}`}
            onClick={() => setReadMode(true)}
          >
            Read
          </button>
        </div>
      </div>
      <div className={`${styles.body} ${sidebarOpen ? '' : styles.bodySidebarClosed}`}>
        <div className={styles.editorPane}>
          <div
            className={styles.editorSplit}
            style={splitDrawing ? { gridTemplateColumns: `${100 - drawingWidth}% 6px ${drawingWidth}%` } : undefined}
          >
            <div className={styles.notePane}>
              {activeDrawing ? (
                <div className={styles.drawingNotice}>This drawing is open in the right pane.</div>
              ) : readMode ? (
                <MarkdownPreview content={activePaste.content} />
              ) : (
                <Editor
                  key={`${activePaste.id}:${editorMode}`}
                  content={activePaste.content}
                  onChange={setContent}
                  mode={editorMode}
                />
              )}
            </div>
            {splitDrawing && splitDrawingId != null && (
              <>
                <div className={styles.splitHandle} onPointerDown={startResize} title="Drag to resize" />
                <div className={styles.drawingPane}>
                  <div className={styles.drawingHeader}>
                    <span>{splitDrawingPaste?.title || 'Drawing'}</span>
                    <button onClick={() => setSplitDrawingId(null)} title="Close drawing">×</button>
                  </div>
                  <DrawingCanvas key={splitDrawingId} drawing={splitDrawing} onChange={(content) => setContent(content, splitDrawingId)} />
                </div>
              </>
            )}
          </div>
        </div>
        <div className={styles.listPane}>
          <PasteList
            pastes={pastes}
            groups={groups}
            activeId={activeId}
            activeGroupId={activeGroupId}
            editingGroupId={editingGroupId}
            onSelect={setActiveId}
            onDiscard={deletePaste}
            onAssignGroup={assignGroup}
            onGroupFilter={setActiveGroupId}
            onAddGroup={addGroup}
            onRenameGroup={setGroupName}
            onDeleteGroup={deleteGroup}
            onEditingGroupChange={setEditingGroupId}
          />
        </div>
      </div>
    </div>
  )
}
