import { useEffect, useRef } from 'react'
import { useUiStore } from '../../store/uiStore'
import { Icon } from '../Icon'
import { useOverlayMotion } from '../../hooks/useOverlayMotion'
import type { AlertSpec } from '../../store/uiStore'
import styles from './Overlays.module.css'

/**
 * HIG alert. Destructive confirmations default to Cancel (Return is safe),
 * ⌘⌫ / ⌫ confirm, Escape cancels.
 */
export default function Alert() {
  const alert = useUiStore((s) => s.alert)
  const dismiss = useUiStore((s) => s.dismissAlert)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previous = useRef<Element | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { requestClose, closing } = useOverlayMotion(panelRef, backdropRef, alert)

  useEffect(() => {
    if (!alert) return
    previous.current = document.activeElement
    ;(alert.destructive ? cancelRef : confirmRef).current?.focus()
    return () => {
      const el = previous.current
      if (el instanceof HTMLElement && document.contains(el)) el.focus({ preventScroll: true })
    }
  }, [alert])

  if (!alert) return null

  // Only dismiss the alert this exit belongs to (onConfirm may have opened another one).
  const finish = (spec: AlertSpec) => () => {
    if (useUiStore.getState().alert === spec) dismiss()
  }
  const cancel = () => requestClose(finish(alert))
  const confirm = () => {
    if (closing()) return
    const spec = alert
    requestClose(finish(spec))
    // The action runs now; the exit animation never delays it.
    spec.onConfirm()
  }

  return (
    <div ref={backdropRef} className={styles.backdrop} onMouseDown={cancel}>
      <div
        ref={panelRef}
        className={styles.alert}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-title"
        aria-describedby="alert-message"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault()
            confirm()
          } else if (e.key === 'Tab') {
            // Two buttons — keep focus trapped between them.
            e.preventDefault()
            const next = document.activeElement === cancelRef.current ? confirmRef : cancelRef
            next.current?.focus()
          }
        }}
      >
        <div className={`${styles.alertIcon} ${alert.destructive ? styles.alertIconDestructive : ''}`}>
          <Icon name={alert.destructive ? 'trash' : 'exclamationmark.triangle'} size={26} strokeWidth={1.5} />
        </div>
        <h2 id="alert-title" className={styles.alertTitle}>
          {alert.title}
        </h2>
        {alert.message && (
          <p id="alert-message" className={styles.alertMessage}>
            {alert.message}
          </p>
        )}
        <div className={styles.alertButtons}>
          <button ref={cancelRef} type="button" data-press="" className={styles.button} onClick={cancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-press=""
            className={`${styles.button} ${alert.destructive ? styles.buttonDestructive : styles.buttonPrimary}`}
            onClick={confirm}
          >
            {alert.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
