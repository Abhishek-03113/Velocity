import { useDeferredValue, useMemo } from 'react'
import { useThrottledValue } from '../../hooks/useThrottledValue'
import { countWords, formatBytes } from '../../lib/noteMeta'
import { BROWSER_ONLY } from '../../lib/runtime'
import { useEditorStore } from '../../store/editorStore'
import { focusedNoteId, useLayoutStore } from '../../store/layoutStore'
import { useStorageStore } from '../../store/storageStore'
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
  const storageFull = useStorageStore((s) => s.full)
  const flash = useUiStore((s) => s.flash)
  const activity = useUiStore((s) => s.activity)
  const deferred = useDeferredValue(useThrottledValue(content ?? '', 150))

  const stats = useMemo(() => {
    // Byte size via length is exact for ASCII and a close lower bound otherwise; cheap per keystroke.
    const approxBytes = deferred.length > SOFT_CAP_BYTES / 4 ? new Blob([deferred]).size : deferred.length
    return { words: countWords(deferred), chars: deferred.length, bytes: approxBytes }
  }, [deferred])

  const overCap = stats.bytes > SOFT_CAP_BYTES

  let saveLabel = 'Saved'
  let saveIcon: 'checkmark.circle' | 'arrow.triangle.2.circlepath' | 'wifi.slash' | 'exclamationmark.triangle' = 'checkmark.circle'
  let saveClass = styles.statusOk
  if (status === 'saving' || status === 'pending') {
    saveLabel = status === 'saving' ? 'Saving…' : 'Edited'
    saveIcon = 'arrow.triangle.2.circlepath'
    saveClass = styles.statusPending
  }
  if (status === 'error' || anyError) {
    saveLabel = BROWSER_ONLY ? 'Couldn’t save' : 'Offline. Changes kept, retrying'
    saveIcon = 'wifi.slash'
    saveClass = styles.statusError
  }
  if (BROWSER_ONLY && storageFull) {
    saveLabel = 'Browser storage full. Export a backup and delete notes or images'
    saveIcon = 'exclamationmark.triangle'
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
        ) : activity ? (
          <span className={`${styles.statusSave} ${styles.statusPending}`} data-status-activity>
            <Icon name="arrow.triangle.2.circlepath" size={12} />
            {activity}
          </span>
        ) : (
          (noteId != null || (BROWSER_ONLY && storageFull)) && (
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
