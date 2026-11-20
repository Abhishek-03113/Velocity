import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThrottledValue } from '../../hooks/useThrottledValue'
import { EASE, animate } from '../../lib/motion'
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
  const flashTone = useUiStore((s) => s.flashTone)
  const activity = useUiStore((s) => s.activity)
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

  const saveState = status === 'error' || anyError ? 'error' : status ?? 'saved'
  const saveRef = useRef<HTMLSpanElement>(null)
  const flashRef = useRef<HTMLSpanElement>(null)
  const prevSave = useRef(saveState)
  const wasOffline = useRef(false)
  // Peak-end: recovering from offline ends on a clear "All changes saved" moment.
  const [recovered, setRecovered] = useState(false)

  useLayoutEffect(() => {
    const prev = prevSave.current
    prevSave.current = saveState
    if (saveState === 'error') wasOffline.current = true
    if (prev === saveState || saveState !== 'saved') return
    if (wasOffline.current) {
      wasOffline.current = false
      setRecovered(true)
      return
    }
    // Autosave is the hot path: the check pops and the label cross-fades, nothing more.
    const el = saveRef.current
    animate(el?.querySelector('svg'), [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1.15)', offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 240,
      easing: EASE.out,
    })
    animate(el, [{ opacity: 0.4 }, { opacity: 1 }], { tier: 'hot' })
  }, [saveState])

  useEffect(() => {
    if (!recovered) return
    const t = setTimeout(() => setRecovered(false), 2200)
    return () => clearTimeout(t)
  }, [recovered])

  const peak = recovered && saveState === 'saved'
  useLayoutEffect(() => {
    // Exaggeration for a deliberate save (⌘S) and for coming back online.
    const el = peak ? saveRef.current : flash && flashTone === 'success' ? flashRef.current : null
    if (!el) return
    el.style.transformOrigin = 'right center'
    animate(el, [{ transform: 'scale(1)' }, { transform: `scale(${peak ? 1.1 : 1.08})`, offset: 0.4 }, { transform: 'scale(1)' }], {
      duration: 280,
      easing: EASE.out,
    })
    animate(el.querySelector('svg'), [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1.15)', offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 240,
      delay: 40,
      easing: EASE.out,
    })
  }, [peak, flash, flashTone])

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
          flashTone === 'success' ? (
            <span ref={flashRef} className={`${styles.statusSave} ${styles.statusPeak}`}>
              <Icon name="checkmark.circle" size={12} />
              {flash}
            </span>
          ) : (
            <span className={styles.statusFlash}>{flash}</span>
          )
        ) : activity ? (
          <span className={`${styles.statusSave} ${styles.statusPending}`} data-status-activity>
            <Icon name="arrow.triangle.2.circlepath" size={12} />
            {activity}
          </span>
        ) : (
          noteId != null && (
            <span ref={saveRef} className={`${styles.statusSave} ${peak ? styles.statusPeak : saveClass}`}>
              <Icon name={saveIcon} size={12} />
              {peak ? 'All changes saved' : saveLabel}
            </span>
          )
        )}
      </div>
    </footer>
  )
}
