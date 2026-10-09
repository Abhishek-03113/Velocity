import { COMMANDS, type CommandSection } from '../../lib/commands'
import { isMac } from '../../lib/platform'
import { useUiStore } from '../../store/uiStore'
import { Kbd } from '../ui/Kbd'
import { Sheet } from './Sheet'
import styles from './Overlays.module.css'

const SECTIONS: CommandSection[] = ['Notes', 'Navigate', 'Tiles', 'View', 'App']

const FORMATTING: Array<[string, string[]]> = [
  ['Bold', ['Mod+KeyB']],
  ['Italic', ['Mod+KeyI']],
  ['Strikethrough', ['Mod+Shift+KeyX']],
  ['Inline code', ['Mod+Shift+KeyM']],
  ['Link', ['Mod+KeyK']],
  ['Cycle heading', ['Mod+Shift+KeyH']],
  ['Checklist', ['Mod+Shift+KeyL']],
  ['Undo / Redo', ['Mod+KeyZ', 'Mod+Shift+KeyZ']],
  ['Add cursor', [isMac ? 'Alt+Click' : 'Alt+Click']],
  ['Column select', [isMac ? 'Alt+Drag' : 'Alt+Drag']],
]

/** Every shortcut, generated from the command registry so it can never drift. */
export default function ShortcutsSheet() {
  const close = () => useUiStore.getState().setShortcutsOpen(false)
  return (
    <Sheet title="Keyboard Shortcuts" onClose={close} width={860}>
      <p className={styles.sheetLead}>
        Browsers reserve {isMac ? '⌘N, ⌘W and ⌘1–9' : 'Ctrl+N, Ctrl+W and Ctrl+1–9'}, so window-level actions also live on{' '}
        <Kbd combo="Ctrl+Alt" subtle /> (the tiling layer, like Hyprland&apos;s Super key).
      </p>
      <div className={styles.shortcutGrid}>
        {SECTIONS.map((section) => (
          <section key={section} className={styles.shortcutSection}>
            <h3 className={styles.shortcutHeading}>{section}</h3>
            <ul>
              {COMMANDS.filter((c) => c.section === section && c.keys?.length && !c.id.startsWith('tab.go'))
                // Directional variants collapse into one row each below.
                .filter((c) => !/^tile\.(focus|swap)(Right|Up|Down)$/.test(c.id))
                .map((c) => (
                  <li key={c.id} className={styles.shortcutRow}>
                    <span>
                      {c.id === 'tile.focusLeft'
                        ? 'Focus tile ←↑→↓'
                        : c.id === 'tile.swapLeft'
                          ? 'Move note ←↑→↓'
                          : c.title.replace(/…$/, '')}
                    </span>
                    <span className={styles.shortcutKeys}>
                      {c.id === 'tile.focusLeft' || c.id === 'tile.swapLeft' ? (
                        <Kbd combo={c.id === 'tile.focusLeft' ? 'Ctrl+Alt+Arrows' : 'Ctrl+Alt+Shift+Arrows'} />
                      ) : (
                        c.keys!.slice(0, 2).map((k) => <Kbd key={k} combo={k} />)
                      )}
                    </span>
                  </li>
                ))}
              {section === 'Navigate' && (
                <li className={styles.shortcutRow}>
                  <span>Go to tab 1–9</span>
                  <span className={styles.shortcutKeys}>
                    <Kbd combo="Ctrl+Alt+1…9" />
                  </span>
                </li>
              )}
            </ul>
          </section>
        ))}
        <section className={styles.shortcutSection}>
          <h3 className={styles.shortcutHeading}>Formatting</h3>
          <ul>
            {FORMATTING.map(([label, keys]) => (
              <li key={label} className={styles.shortcutRow}>
                <span>{label}</span>
                <span className={styles.shortcutKeys}>
                  {keys.map((k) => (
                    <Kbd key={k} combo={k} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  )
}
