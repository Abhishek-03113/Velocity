import { useEffect } from 'react'
import styles from './ShortcutsModal.module.css'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

const MOD = isMac ? '⌘' : 'Ctrl'
const OPT = isMac ? '⌥' : 'Alt'

const SHORTCUTS = [
  { action: 'New paste', keys: [`${MOD}`, 'N'] },
  { action: 'Close tab', keys: [`${MOD}`, 'W'] },
  { action: 'Global search', keys: [`${MOD}`, '⇧', 'F'] },
  { action: 'Toggle read mode', keys: [`${MOD}`, '⇧', 'P'] },
  { action: 'Multi-cursor', keys: [OPT, 'Click'] },
  { action: 'Undo', keys: [`${MOD}`, 'Z'] },
  { action: 'Redo', keys: [`${MOD}`, '⇧', 'Z'] },
]

interface ShortcutsModalProps {
  onClose: () => void
}

export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Keyboard Shortcuts</span>
          <button className={styles.close} onClick={onClose}>×</button>
        </div>
        <ul className={styles.list}>
          {SHORTCUTS.map(({ action, keys }) => (
            <li key={action} className={styles.row}>
              <span className={styles.action}>{action}</span>
              <span className={styles.keys}>
                {keys.map((k, i) => (
                  <span key={i}>
                    <kbd className={styles.key}>{k}</kbd>
                    {i < keys.length - 1 && <span className={styles.plus}>+</span>}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
