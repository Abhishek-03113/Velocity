import { useEffect, useState } from 'react'
import Editor from './components/Editor'
import MarkdownPreview from './components/MarkdownPreview'
import PasteList from './components/PasteList'
import { useEditorStore } from './store/editorStore'
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
  } = useEditorStore()
  const activePaste = getActivePaste()
  const openTabs = getOpenTabs()
  const [pendingTitle, setPendingTitle] = useState('')
  const [readMode, setReadMode] = useState(false)

  useEffect(() => {
    initialize()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // leave read mode when switching tabs
  useEffect(() => {
    setReadMode(false)
  }, [activeId])

  const commitTitle = (id: number) => {
    if (pendingTitle.trim()) setTitle(id, pendingTitle.trim())
    setEditingTitleId(null)
    setPendingTitle('')
  }

  if (!activePaste) return null

  return (
    <div className={styles.app}>
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
          <PasteList pastes={pastes} activeId={activeId} onSelect={setActiveId} />
        </div>
      </div>
    </div>
  )
}
