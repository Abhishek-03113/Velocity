import { useEffect, useState } from 'react'
import Editor from './components/Editor'
import MarkdownPreview from './components/MarkdownPreview'
import PasteList from './components/PasteList'
import SearchModal from './components/SearchModal'
import ShortcutsModal from './components/ShortcutsModal'
import { useEditorStore } from './store/editorStore'
import { useSearchStore } from './store/searchStore'
import type { Paste } from './types'
import styles from './App.module.css'

interface TabProps {
  paste: Paste
  isActive: boolean
  isEditing: boolean
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
  } = useEditorStore()
  const { isOpen: searchOpen, openSearch, closeSearch } = useSearchStore()
  const activePaste = getActivePaste()
  const openTabs = getOpenTabs()
  const [pendingTitle, setPendingTitle] = useState('')
  const [readMode, setReadMode] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    initialize()
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

      if (mod && e.shiftKey && isF) {
        e.preventDefault()
        openSearch()
      } else if (mod && !e.shiftKey && isN) {
        e.preventDefault()
        addPaste()
      } else if (mod && !e.shiftKey && isW) {
        e.preventDefault()
        const currentId = useEditorStore.getState().activeId
        if (currentId != null) closeTab(currentId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // leave read mode and close search when switching tabs
  useEffect(() => {
    setReadMode(false)
    closeSearch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const commitTitle = (id: number) => {
    if (pendingTitle.trim()) setTitle(id, pendingTitle.trim())
    setEditingTitleId(null)
    setPendingTitle('')
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
              onActivate={() => setActiveId(paste.id)}
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
          <button className={styles.addTab} onClick={addPaste}>
            +
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
          className={`${styles.readModeBtn} ${readMode ? styles.readModeBtnActive : ''}`}
          onClick={() => setReadMode((v) => !v)}
          title="Toggle Read Mode"
        >
          {readMode ? 'Edit' : 'Read'}
        </button>
      </div>
      <div className={styles.body}>
        <div className={styles.editorPane}>
          {readMode ? (
            <MarkdownPreview content={activePaste.content} />
          ) : (
            <Editor
              key={activePaste.id}
              content={activePaste.content}
              onChange={setContent}
            />
          )}
        </div>
        <div className={styles.listPane}>
          <PasteList pastes={pastes} activeId={activeId} onSelect={setActiveId} onDiscard={deletePaste} />
        </div>
      </div>
    </div>
  )
}
