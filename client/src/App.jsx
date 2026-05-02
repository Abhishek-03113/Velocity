import { useRef, useState } from 'react'
import Editor from './components/Editor'
import PasteList from './components/PasteList'
import { useEditorStore } from './store/editorStore'
import styles from './App.module.css'

function Tab({ paste, isActive, isEditing, onActivate, onClose, onDoubleClick, onTitleChange, onTitleBlur, onTitleKeyDown }) {
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
      <button
        className={styles.tabClose}
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        ×
      </button>
    </div>
  )
}

export default function App() {
  const { pastes, activeId, editingTitleId, setActiveId, addPaste, closePaste, setContent, setTitle, setEditingTitleId, getActivePaste } = useEditorStore()
  const activePaste = getActivePaste()
  const [pendingTitle, setPendingTitle] = useState('')

  const commitTitle = (id) => {
    if (pendingTitle.trim()) setTitle(id, pendingTitle.trim())
    setEditingTitleId(null)
    setPendingTitle('')
  }

  return (
    <div className={styles.app}>
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {pastes.map((paste) => (
            <Tab
              key={paste.id}
              paste={paste}
              isActive={paste.id === activeId}
              isEditing={paste.id === editingTitleId}
              onActivate={() => setActiveId(paste.id)}
              onClose={() => closePaste(paste.id)}
              onDoubleClick={() => { setPendingTitle(paste.title); setEditingTitleId(paste.id) }}
              onTitleChange={setPendingTitle}
              onTitleBlur={() => commitTitle(paste.id)}
              onTitleKeyDown={(e) => { if (e.key === 'Enter') commitTitle(paste.id); if (e.key === 'Escape') setEditingTitleId(null) }}
            />
          ))}
          <button className={styles.addTab} onClick={addPaste}>+</button>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.editorPane}>
          <Editor
            key={activePaste.id}
            content={activePaste.content}
            mode="plaintext"
            onChange={setContent}
          />
        </div>
        <div className={styles.listPane}>
          <PasteList
            pastes={pastes}
            activeId={activeId}
            onSelect={setActiveId}
          />
        </div>
      </div>
    </div>
  )
}
