import styles from './PasteList.module.css'

export default function PasteList({ pastes, activeId, onSelect }) {
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
