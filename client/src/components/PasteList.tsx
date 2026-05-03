import type { Paste } from '../types'
import styles from './PasteList.module.css'

interface PasteListProps {
  pastes: Paste[]
  activeId: number | null
  onSelect: (id: number) => void
  onDiscard: (id: number) => void
}

export default function PasteList({ pastes, activeId, onSelect, onDiscard }: PasteListProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>PASTES</div>
      <ul className={styles.list}>
        {pastes.map((paste) => (
          <li
            key={paste.id}
            className={`${styles.item} ${activeId === paste.id ? styles.active : ''}`}
            onClick={() => onSelect(paste.id)}
          >
            <span className={styles.title}>{paste.title || 'Untitled'}</span>
            <button
              className={styles.discard}
              title="Discard paste"
              onClick={(e) => {
                e.stopPropagation()
                onDiscard(paste.id)
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
