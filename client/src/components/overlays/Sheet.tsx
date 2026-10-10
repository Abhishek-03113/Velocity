import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../Icon'
import styles from './Overlays.module.css'

/** HIG sheet: centred modal panel on a dimmed backdrop, Escape to dismiss. */
export function Sheet({
  title,
  onClose,
  children,
  width = 560,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className={styles.sheet}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <header className={styles.sheetHeader}>
          <h2 className={styles.sheetTitle}>{title}</h2>
          <button type="button" className={styles.sheetClose} aria-label="Close" onClick={onClose}>
            <Icon name="xmark" size={14} strokeWidth={2} />
          </button>
        </header>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>
  )
}
