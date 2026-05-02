import styles from './ModeToggle.module.css'

const MODES = ['plain', 'markdown']

export default function ModeToggle({ mode, onChange }) {
  return (
    <div className={styles.toggle}>
      {MODES.map((m) => (
        <button
          key={m}
          className={`${styles.btn} ${mode === m ? styles.active : ''}`}
          onClick={() => onChange(m)}
        >
          {m === 'plain' ? 'Plain' : 'Markdown'}
        </button>
      ))}
    </div>
  )
}
