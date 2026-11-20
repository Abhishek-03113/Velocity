import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { restoreFocus } from '../../lib/focus'
import { useOverlayMotion } from '../../hooks/useOverlayMotion'
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
  const backdropRef = useRef<HTMLDivElement>(null)
  // Opens out of the button that was pressed and returns into it (interruptible).
  const { requestClose } = useOverlayMotion(ref, backdropRef)
  const close = () => requestClose(onClose)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    return () => restoreFocus(previous)
  }, [])

  return (
    <div ref={backdropRef} className={styles.backdrop} onMouseDown={close}>
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
            close()
          }
        }}
      >
        <header className={styles.sheetHeader}>
          <h2 className={styles.sheetTitle}>{title}</h2>
          <button type="button" className={styles.sheetClose} aria-label="Close" onClick={close}>
            <Icon name="xmark" size={14} strokeWidth={2} />
          </button>
        </header>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>
  )
}
