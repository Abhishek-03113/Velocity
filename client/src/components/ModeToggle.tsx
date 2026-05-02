import styles from './ModeToggle.module.css'

type Mode = 'plain' | 'markdown'

const MODES: Mode[] = ['plain', 'markdown']

interface ModeToggleProps {
  mode: Mode
  onChange: (mode: Mode) => void
}

export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
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
