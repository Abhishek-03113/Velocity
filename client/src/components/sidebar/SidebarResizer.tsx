import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { clampSidebarWidth, SIDEBAR_WIDTHS, useUiStore } from '../../store/uiStore'
import styles from './Sidebar.module.css'

const PREF = { folders: 'foldersWidth', notes: 'notesWidth' } as const
const VAR = { folders: '--folders-width', notes: '--notes-width' } as const
const LABEL = { folders: 'Resize folders', notes: 'Resize notes list' } as const
const STEP = 16

/**
 * Drag handle on the right edge of a sidebar column. While dragging, the width is written straight to the sidebar's
 * CSS variable (no React render per pointer move); the preference is saved once on release. Double-click restores the
 * default; arrow keys resize a focused handle.
 */
export function SidebarResizer({ which, asideRef }: { which: 'folders' | 'notes'; asideRef: RefObject<HTMLElement> }) {
  const width = useUiStore((s) => s.prefs[PREF[which]])
  const { min, max, initial } = SIDEBAR_WIDTHS[which]
  const save = (px: number) => useUiStore.getState().setPref(PREF[which], clampSidebarWidth(which, px))

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const aside = asideRef.current
    if (!aside || e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const start = width
    let latest = start
    aside.dataset.resizing = ''
    const onMove = (ev: globalThis.PointerEvent) => {
      latest = clampSidebarWidth(which, start + ev.clientX - startX)
      aside.style.setProperty(VAR[which], `${latest}px`)
    }
    const onUp = () => {
      delete aside.dataset.resizing
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      save(latest)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      save(width + (e.key === 'ArrowRight' ? STEP : -STEP))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      save(e.key === 'Home' ? min : max)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={LABEL[which]}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-sidebar-resizer={which}
      className={`${styles.resizer} ${which === 'folders' ? styles.resizerFolders : styles.resizerNotes}`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => save(initial)}
      onKeyDown={onKeyDown}
    />
  )
}
