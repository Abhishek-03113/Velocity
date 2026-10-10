import { useEffect, useRef } from 'react'
import { useUiStore } from '../../store/uiStore'
import { Icon } from '../Icon'
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

  const confirm = () => {
    dismiss()
    alert.onConfirm()
  }

  return (
    <div className={styles.backdrop} onMouseDown={dismiss}>
      <div
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
            dismiss()
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
          <button ref={cancelRef} type="button" className={styles.button} onClick={dismiss}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
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
