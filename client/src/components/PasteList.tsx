import type { Paste } from '../types'
import styles from './PasteList.module.css'

interface PasteListProps {
  pastes: Paste[]
  activeId: number | null
  onSelect: (id: number) => void
}

export default function PasteList({ pastes, activeId, onSelect }: PasteListProps) {
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
            {paste.title || 'Untitled'}
          </li>
        ))}
      </ul>
    </div>
  )
}
