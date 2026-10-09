import { comboTokens } from '../../lib/platform'
import styles from './ui.module.css'

/** Renders a key combo as macOS-style glyphs (⌘⇧P) or PC words (Ctrl Shift P). */
export function Kbd({ combo, subtle = false }: { combo: string; subtle?: boolean }) {
  const tokens = comboTokens(combo)
  return (
    <kbd className={`${styles.kbd} ${subtle ? styles.kbdSubtle : ''}`} aria-label={tokens.join(' ')}>
      {tokens.map((t, i) => (
        <span key={i} className={styles.kbdKey}>
          {t}
        </span>
      ))}
    </kbd>
  )
}
