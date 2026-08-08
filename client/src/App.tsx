import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type EditorMode } from './components/Editor'
import DrawingCanvas from './components/DrawingCanvas'
import MarkdownPreview from './components/MarkdownPreview'
import PasteList from './components/PasteList'
import SearchModal from './components/SearchModal'
import ShortcutsModal from './components/ShortcutsModal'
import { useEditorStore } from './store/editorStore'
import { useGroupStore } from './store/groupStore'
import { useSearchStore } from './store/searchStore'
import { hasBoard, useWhiteboardStore } from './store/whiteboardStore'
import type { Paste } from './types'
import { parseDrawing } from './lib/drawing'
import styles from './App.module.css'

const Whiteboard = lazy(() => import('./components/Whiteboard'))

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'

function BoardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M12 17v3M8.5 20h7" strokeLinecap="round" />
      <path d="M7 12.5c1.8-3.2 3.2-3.2 5 0s3.2 3.2 5 0" strokeLinecap="round" />
    </svg>
  )
}

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
  const {
    boardNoteId,
    isOpen: boardOpen,
    splitRatio,
    toggleBoard,
    openBoard,
    closeBoard,
    setSplitRatio,
    removeBoard,
  } = useWhiteboardStore()
  const activePaste = getActivePaste()
  const openTabs = getOpenTabs()
  const activeDrawing = parseDrawing(activePaste?.content)
  const [pendingTitle, setPendingTitle] = useState('')
  const [editorMode, setEditorMode] = useState<EditorMode>('plain')
  const [readMode, setReadMode] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [splitDrawingId, setSplitDrawingId] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const lastNoteId = useRef<number | null>(null)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const splitDrawingPaste = pastes.find((paste) => paste.id === splitDrawingId)
  const splitDrawing = parseDrawing(splitDrawingPaste?.content)
  const showCompanionBoard = boardOpen && boardNoteId != null
  const showLegacyDrawing = !showCompanionBoard && splitDrawing != null && splitDrawingId != null
  const groupColorById = useMemo(() => {
    return new Map(groups.map((group, index) => [group.id, GROUP_COLORS[index % GROUP_COLORS.length]]))
  }, [groups])

  const startDrag = useCallback(() => {
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      const el = splitRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setSplitRatio(1 - (e.clientX - rect.left) / rect.width)
    }
    function onUp() {
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, setSplitRatio])

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
      const isD = code === 'KeyD' || keyStr === 'd'

      if (mod && e.shiftKey && isD) {
        e.preventDefault()
        const currentId = useEditorStore.getState().activeId
        if (currentId != null) useWhiteboardStore.getState().toggleBoard(currentId)
      } else if (mod && e.shiftKey && isF) {
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

  const handleDiscard = (id: number) => {
    removeBoard(id)
    if (splitDrawingId === id) setSplitDrawingId(null)
    deletePaste(id)
  }

  if (!activePaste) return null

  const noteHasBoard = hasBoard(activePaste.id)
  const boardNoteTitle =
    (pastes.find((p) => p.id === boardNoteId)?.title ?? '') || 'Untitled'
  const boardActive = boardOpen && boardNoteId === activePaste.id

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
          <button className={styles.addTab} onClick={() => addPaste()} title={`New note (${MOD}N)`}>
            +
          </button>
        </div>
        <button
          className={`${styles.boardToggle} ${boardActive ? styles.boardToggleActive : ''}`}
          onClick={() => toggleBoard(activePaste.id)}
          title={`Whiteboard for this note (${MOD}⇧D)`}
          aria-label="Toggle whiteboard"
        >
          <BoardIcon className={styles.boardIcon} />
          {noteHasBoard && <span className={styles.boardDot} />}
        </button>
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
            ref={splitRef}
            className={styles.editorSplit}
            style={
              showCompanionBoard
                ? { display: 'flex' }
                : showLegacyDrawing
                  ? { gridTemplateColumns: `${100 - Math.round(splitRatio * 100)}% 6px ${Math.round(splitRatio * 100)}%` }
                  : undefined
            }
          >
            <div
              className={styles.notePane}
              style={showCompanionBoard ? { flex: '1 1 0', minWidth: 0 } : undefined}
            >
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

            {showCompanionBoard && boardNoteId != null && (
              <>
                <div
                  className={`${styles.splitHandle} ${dragging ? styles.splitHandleActive : ''}`}
                  onMouseDown={startDrag}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize"
                />
                <div
                  className={styles.drawingPane}
                  style={{ width: `${Math.round(splitRatio * 100)}%`, flexShrink: 0 }}
                >
                  <div className={styles.drawingHeader}>
                    <span className={styles.boardHeaderTitle}>
                      <BoardIcon className={styles.boardHeaderIcon} />
                      {boardNoteTitle} — whiteboard
                    </span>
                    <div className={styles.drawingHeaderActions}>
                      {boardNoteId !== activeId && activeId != null && (
                        <button
                          className={styles.switchBoard}
                          onClick={() => openBoard(activeId)}
                          title="Open the whiteboard for the note you're viewing"
                        >
                          Switch to current note
                        </button>
                      )}
                      <button className={styles.drawingHeaderClose} onClick={closeBoard} title="Close whiteboard">×</button>
                    </div>
                  </div>
                  <div className={styles.boardBody}>
                    <Suspense fallback={<div className={styles.drawingNotice}>Loading board…</div>}>
                      <Whiteboard noteId={boardNoteId} />
                    </Suspense>
                  </div>
                </div>
              </>
            )}

            {showLegacyDrawing && splitDrawing && splitDrawingId != null && (
              <>
                <div
                  className={styles.splitHandle}
                  onMouseDown={startDrag}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize"
                />
                <div className={styles.drawingPane}>
                  <div className={styles.drawingHeader}>
                    <span className={styles.boardHeaderTitle}>{splitDrawingPaste?.title || 'Drawing'}</span>
                    <div className={styles.drawingHeaderActions}>
                      <button className={styles.drawingHeaderClose} onClick={() => setSplitDrawingId(null)} title="Close drawing">×</button>
                    </div>
                  </div>
                  <DrawingCanvas
                    key={splitDrawingId}
                    drawing={splitDrawing}
                    onChange={(content) => setContent(content, splitDrawingId)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
        <div className={styles.listPane}>
          <div className={styles.newNoteWrap}>
            <button
              className={styles.newNote}
              onClick={() => addPaste()}
              title={`New note (${MOD}N)`}
            >
              + New Note
            </button>
          </div>
          <div className={styles.listBody}>
            <PasteList
              pastes={pastes}
              groups={groups}
              activeId={activeId}
              activeGroupId={activeGroupId}
              editingGroupId={editingGroupId}
              onSelect={setActiveId}
              onDiscard={handleDiscard}
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
    </div>
  )
}
