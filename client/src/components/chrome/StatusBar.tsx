import { useDeferredValue, useMemo } from 'react'
import { useThrottledValue } from '../../hooks/useThrottledValue'
import { countWords, formatBytes } from '../../lib/noteMeta'
import { useEditorStore } from '../../store/editorStore'
import { focusedNoteId, useLayoutStore } from '../../store/layoutStore'
import { useUiStore } from '../../store/uiStore'
import { Icon } from '../Icon'
import styles from './Chrome.module.css'

const SOFT_CAP_BYTES = 1024 * 1024

/** Footer: counts, 1 MB soft-cap warning and the only save indicator (no toasts). */
export default function StatusBar() {
  const noteId = useLayoutStore(focusedNoteId)
  const content = useEditorStore((s) => s.pastes.find((p) => p.id === noteId)?.content)
  const status = useEditorStore((s) => (noteId == null ? undefined : s.syncStatus[noteId]))
  const anyError = useEditorStore((s) => Object.values(s.syncStatus).includes('error'))
  const flash = useUiStore((s) => s.flash)
  const deferred = useDeferredValue(useThrottledValue(content ?? '', 150))

  const stats = useMemo(() => {
    // Byte size via length is exact for ASCII and a close lower bound otherwise; cheap per keystroke.
    const approxBytes = deferred.length > SOFT_CAP_BYTES / 4 ? new Blob([deferred]).size : deferred.length
    return { words: countWords(deferred), chars: deferred.length, bytes: approxBytes }
  }, [deferred])

  const overCap = stats.bytes > SOFT_CAP_BYTES

  let saveLabel = 'Saved'
  let saveIcon: 'checkmark.circle' | 'arrow.triangle.2.circlepath' | 'wifi.slash' = 'checkmark.circle'
  let saveClass = styles.statusOk
  if (status === 'saving' || status === 'pending') {
    saveLabel = status === 'saving' ? 'Saving…' : 'Edited'
    saveIcon = 'arrow.triangle.2.circlepath'
    saveClass = styles.statusPending
  }
  if (status === 'error' || anyError) {
    saveLabel = 'Offline. Changes kept, retrying'
    saveIcon = 'wifi.slash'
    saveClass = styles.statusError
  }

  return (
    <footer className={styles.statusBar}>
      <div className={styles.statusLeading}>
        {noteId != null && content !== undefined && (
          <>
            <span>
              {stats.words.toLocaleString()} {stats.words === 1 ? 'word' : 'words'}
            </span>
            <span className={styles.statusDim}>{stats.chars.toLocaleString()} characters</span>
          </>
        )}
        {overCap && (
          <span className={styles.statusWarn} title="Notes over 1 MB may feel slower to edit and sync">
            <Icon name="exclamationmark.triangle" size={12} />
            Large note ({formatBytes(stats.bytes)})
          </span>
        )}
      </div>
      <div className={styles.statusTrailing} aria-live="polite">
        {flash ? (
          <span className={styles.statusFlash}>{flash}</span>
        ) : (
          noteId != null && (
            <span className={`${styles.statusSave} ${saveClass}`}>
              <Icon name={saveIcon} size={12} />
              {saveLabel}
            </span>
          )
        )}
      </div>
    </footer>
  )
}
