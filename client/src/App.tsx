import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from './components/Editor'
import MarkdownPreview from './components/MarkdownPreview'
import PasteList from './components/PasteList'
import SearchModal from './components/SearchModal'
import ShortcutsModal from './components/ShortcutsModal'
import { useEditorStore } from './store/editorStore'
import { useGroupStore } from './store/groupStore'
import { useSearchStore } from './store/searchStore'
import { hasBoard, useWhiteboardStore } from './store/whiteboardStore'
import type { Paste } from './types'

const Whiteboard = lazy(() => import('./components/Whiteboard'))

const GROUP_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#c084fc', '#fb7185']

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'

function PlusIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function CloseIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function BoardIcon({ className = 'h-4 w-4' }: { className?: string }) {
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
      onClick={onActivate}
      className={`group flex h-9 min-w-0 max-w-56 cursor-pointer items-center gap-2.5 rounded-t-lg px-3.5 text-sm transition-colors duration-150 ${
        isActive
          ? 'border-x border-t border-v-border bg-v-bg text-v-text-strong'
          : 'border-x border-t border-transparent text-v-muted hover:bg-v-surface hover:text-v-text'
      }`}
    >
      {groupColor && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: groupColor }}
          aria-hidden="true"
        />
      )}
      {isEditing ? (
        <input
          className="w-32 rounded border border-v-accent/60 bg-v-bg px-1 py-0.5 text-sm text-v-text-strong outline-none"
          defaultValue={paste.title}
          autoFocus
          onClick={(e) => { e.stopPropagation() }}
          onChange={(e) => { onTitleChange(e.target.value) }}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
        />
      ) : (
        <span className="truncate" onDoubleClick={onDoubleClick}>
          {paste.title || 'Untitled'}
        </span>
      )}
      {paste.dirty && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-v-warn" title="Unsaved changes" />
      )}
      <button
        aria-label="Close tab"
        className="shrink-0 rounded p-0.5 text-v-muted opacity-0 transition-all duration-150 hover:bg-v-border hover:text-v-text-strong focus-visible:opacity-100 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

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
  const [pendingTitle, setPendingTitle] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [readMode, setReadMode] = useState(false)
  const [dragging, setDragging] = useState(false)
  const splitRef = useRef<HTMLDivElement | null>(null)

  const showCompanionBoard = boardOpen && boardNoteId != null
  const noteHasBoard = activePaste != null && hasBoard(activePaste.id)
  const boardNoteTitle =
    (pastes.find((p) => p.id === boardNoteId)?.title ?? '') || 'Untitled'
  const boardActive = boardOpen && boardNoteId === activePaste?.id

  const groupColorById = useMemo(() => {
    return new Map(
      groups.map((group, index) => [group.id, GROUP_COLORS[index % GROUP_COLORS.length]]),
    )
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
      const isE = code === 'KeyE' || keyStr === 'e'
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
      } else if (mod && !e.shiftKey && isE) {
        e.preventDefault()
        setReadMode((r) => !r)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Leave read mode and close search when switching tabs
  useEffect(() => {
    closeSearch()
    setReadMode(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const commitTitle = (id: number) => {
    if (pendingTitle.trim()) setTitle(id, pendingTitle.trim())
    setEditingTitleId(null)
    setPendingTitle('')
  }

  const handleDiscard = (id: number) => {
    removeBoard(id)
    deletePaste(id)
  }

  const content = activePaste?.content ?? ''
  const stats = useMemo(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0
    return {
      words,
      chars: content.length,
      lines: content ? content.split('\n').length : 0,
    }
  }, [content])

  if (!activePaste) return null

  const activeGroupName =
    activePaste.group_id != null
      ? (groups.find((g) => g.id === activePaste.group_id)?.name ?? 'Ungrouped')
      : 'Ungrouped'

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-v-bg font-body text-v-text">
      {searchOpen && <SearchModal onSelect={(id) => { void setActiveId(id) }} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => { setShortcutsOpen(false) }} />}

      {/* Top command bar */}
      <header className="z-20 flex h-14 shrink-0 items-center gap-4 border-b border-v-border bg-v-bg px-4">
        <button
          aria-label="Toggle sidebar"
          title={`Toggle sidebar (${MOD}1)`}
          onClick={() => { setSidebarOpen((o) => !o) }}
          className={`shrink-0 rounded-md p-2 transition-all duration-150 hover:bg-v-elevated hover:text-v-text-strong ${
            sidebarOpen ? 'text-v-accent' : 'text-v-muted'
          }`}
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M9.5 4v16" strokeLinecap="round" />
            <path d="M5.75 8.25h1.5M5.75 11.25h1.5" strokeLinecap="round" />
          </svg>
        </button>

        <button
          onClick={openSearch}
          className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-v-border bg-v-surface px-3.5 text-sm text-v-muted transition-colors duration-150 hover:border-v-accent/50 hover:bg-v-elevated hover:text-v-text"
        >
          <svg className="h-4 w-4 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="truncate">Search notes...</span>
          <span className="ml-auto shrink-0 rounded border border-v-border bg-v-bg px-1.5 py-0.5 font-mono text-[10px] opacity-70">
            {MOD}⇧F
          </span>
        </button>

        <button
          aria-label="Toggle whiteboard"
          title={`Whiteboard for this note (${MOD}⇧D)`}
          onClick={() => { toggleBoard(activePaste.id) }}
          className={`relative shrink-0 rounded-md p-2 transition-all duration-150 hover:bg-v-elevated hover:text-v-text-strong ${
            boardActive ? 'text-v-accent' : 'text-v-muted'
          }`}
        >
          <BoardIcon />
          {noteHasBoard && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-v-accent" aria-hidden="true" />
          )}
        </button>

        <button
          aria-label={readMode ? 'Edit note' : 'Read mode'}
          title={`${readMode ? 'Edit' : 'Read mode'} (${MOD}E)`}
          onClick={() => { setReadMode((r) => !r) }}
          className={`shrink-0 rounded-md p-2 transition-all duration-150 hover:bg-v-elevated hover:text-v-text-strong ${
            readMode ? 'text-v-accent' : 'text-v-muted'
          }`}
        >
          {readMode ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          )}
        </button>

        <button
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={() => { setShortcutsOpen(true) }}
          className="shrink-0 rounded-md p-2 text-v-muted transition-all duration-150 hover:bg-v-elevated hover:text-v-text-strong"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        {sidebarOpen && (
          <aside className="flex w-60 shrink-0 flex-col border-r border-v-border bg-v-surface">
            <div className="p-4">
              <button
                onClick={() => { addPaste() }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-v-accent px-4 py-2 text-sm font-medium text-v-text-strong shadow-lg shadow-v-accent/10 transition-all duration-150 hover:bg-v-accent-hover"
              >
                <PlusIcon />
                New Note
              </button>
            </div>

            <PasteList
              pastes={pastes}
              groups={groups}
              activeId={activeId}
              activeGroupId={activeGroupId}
              editingGroupId={editingGroupId}
              onSelect={(id) => { void setActiveId(id) }}
              onDiscard={handleDiscard}
              onAssignGroup={assignGroup}
              onGroupFilter={setActiveGroupId}
              onAddGroup={addGroup}
              onAddNote={(groupId) => { addPaste(groupId) }}
              onRenameGroup={setGroupName}
              onDeleteGroup={deleteGroup}
              onEditingGroupChange={setEditingGroupId}
            />

            <div className="border-t border-v-border p-4">
              <div className="flex items-center gap-3 px-2 py-1 opacity-60">
                <div className="h-2 w-2 rounded-full bg-v-ok" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-v-text">
                  Local Mode
                </span>
              </div>
            </div>
          </aside>
        )}

        {/* Editor column */}
        <main className="flex min-w-0 flex-1 flex-col bg-v-bg">
          <div className="flex h-10 shrink-0 items-end overflow-x-auto border-b border-v-border bg-v-surface/30 px-2">
            {openTabs.map((paste) => (
              <Tab
                key={paste.id}
                paste={paste}
                isActive={paste.id === activeId}
                isEditing={paste.id === editingTitleId}
                groupColor={paste.group_id ? groupColorById.get(paste.group_id) : undefined}
                onActivate={() => { void setActiveId(paste.id) }}
                onClose={() => { closeTab(paste.id) }}
                onDoubleClick={() => {
                  setPendingTitle(paste.title)
                  setEditingTitleId(paste.id)
                }}
                onTitleChange={setPendingTitle}
                onTitleBlur={() => { commitTitle(paste.id) }}
                onTitleKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle(paste.id)
                  if (e.key === 'Escape') setEditingTitleId(null)
                }}
              />
            ))}
            <button
              aria-label="New note"
              title={`New note (${MOD}N)`}
              onClick={() => { addPaste() }}
              className="mb-2 ml-2 shrink-0 rounded p-1 text-v-muted transition-colors duration-150 hover:bg-v-border hover:text-v-text-strong"
            >
              <PlusIcon />
            </button>
          </div>

          <div
            ref={splitRef}
            className="relative flex min-h-0 flex-1 overflow-hidden"
          >
            <div
              className="min-w-0 overflow-hidden"
              style={showCompanionBoard ? { flex: '1 1 0' } : { flex: '1 1 auto' }}
            >
              {readMode ? (
                <div className="h-full overflow-auto">
                  <MarkdownPreview content={activePaste.content} />
                </div>
              ) : (
                <Editor
                  key={String(activePaste.id)}
                  content={activePaste.content}
                  onChange={setContent}
                  mode="markdown"
                />
              )}
            </div>

            {showCompanionBoard && boardNoteId != null && (
              <>
                <div
                  className={`w-1.5 shrink-0 cursor-col-resize touch-none bg-v-border transition-colors ${
                    dragging ? 'bg-v-accent' : 'hover:bg-v-accent/70'
                  }`}
                  onMouseDown={startDrag}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize"
                />
                <div
                  className="flex min-w-0 flex-col overflow-hidden border-l border-v-border bg-v-bg"
                  style={{ width: `${Math.round(splitRatio * 100)}%`, flexShrink: 0 }}
                >
                  <div className="flex h-8 shrink-0 items-center gap-2 border-b border-v-border bg-v-surface px-3 text-sm text-v-text">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                      <BoardIcon className="h-3.5 w-3.5 shrink-0 text-v-accent" />
                      <span className="truncate">{boardNoteTitle} — whiteboard</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {boardNoteId !== activeId && activeId != null && (
                        <button
                          type="button"
                          className="rounded border border-v-border px-1.5 py-0.5 text-[10px] text-v-muted transition-colors hover:border-v-accent/50 hover:text-v-text"
                          onClick={() => { openBoard(activeId) }}
                          title="Open the whiteboard for the note you're viewing"
                        >
                          Switch to current note
                        </button>
                      )}
                      <button
                        type="button"
                        className="px-1 text-lg leading-none text-v-muted transition-colors hover:text-v-text-strong"
                        onClick={closeBoard}
                        title="Close whiteboard"
                        aria-label="Close whiteboard"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1">
                    <Suspense fallback={
                      <div className="grid h-full place-items-center text-sm text-v-muted">
                        Loading board…
                      </div>
                    }>
                      <Whiteboard noteId={boardNoteId} />
                    </Suspense>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Status footer */}
          <footer className="flex h-7 shrink-0 items-center justify-between border-t border-v-border bg-v-surface/30 px-4 text-[11px] text-v-muted">
            <div className="flex min-w-0 items-center gap-4">
              <span className="truncate">{activePaste.title || 'Untitled'}</span>
              <span className="hidden sm:inline">{activeGroupName}</span>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <span>{stats.words} words</span>
              <span className="hidden sm:inline">{stats.lines} lines</span>
              <span className={activePaste.dirty ? 'text-v-warn' : 'text-v-ok'}>
                {activePaste.dirty ? 'Saving…' : 'Saved'}
              </span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
