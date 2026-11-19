/** A small sheet with a multi-line field for a highlight's note (⌘↩ saves, Esc cancels). */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { comboLabel } from '../../../lib/platform'
import { PAPER_STOCK } from '../paper'
import type { HighlightColor } from '../reader/types'
import styles from './Toolbar.module.css'
import panels from '../ReaderTile.module.css'

interface Props {
  quote: string | null
  color: HighlightColor | null
  initial: string
  onSave: (note: string) => void
  onCancel: () => void
}

export function NoteSheet({ quote, color, initial, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = field.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      onSave(value.trim())
    }
  }

  return (
    <>
      <div className={styles.noteScrim} onClick={onCancel} aria-hidden="true" />
      <div
        className={styles.noteSheet}
        role="dialog"
        aria-label="Note"
        onKeyDown={onKeyDown}
        style={color ? ({ '--mark': PAPER_STOCK.highlightBase[color] } as CSSProperties) : undefined}
      >
        <h2 className={styles.noteTitle}>Note</h2>
        {quote && <p className={styles.noteQuote}>{quote}</p>}
        <textarea
          ref={field}
          className={styles.noteField}
          value={value}
          placeholder="Write a note for this passage…"
          aria-label="Note"
          onChange={(e) => setValue(e.target.value)}
        />
        <div className={styles.noteActions}>
          <span className={styles.noteHint}>{comboLabel('Mod+Enter')} to save</span>
          <div className={styles.noteButtons}>
            <button type="button" className={panels.secondaryButton} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className={panels.primaryButton} onClick={() => onSave(value.trim())}>
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
