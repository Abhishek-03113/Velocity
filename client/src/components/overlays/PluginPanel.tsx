import { useEffect, useRef } from 'react'
import { useUiStore } from '../../store/uiStore'
import styles from './Overlays.module.css'

/** A plugin's large panel (e.g. the herdr Agents board), over the workspace. Escape closes it. */
export default function PluginPanel() {
  const panel = useUiStore((s) => s.pluginPanel)
  const close = useUiStore((s) => s.closePluginPanel)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  if (!panel) return null
  return (
    <div className={`${styles.backdrop} ${styles.backdropPanel}`} onMouseDown={close}>
      <div
        ref={ref}
        tabIndex={-1}
        className={styles.pluginPanel}
        role="dialog"
        aria-modal="true"
        aria-label={panel.title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.stopPropagation()
            close()
          }
        }}
      >
        <div className={styles.pluginPanelBody}>{panel.render()}</div>
      </div>
    </div>
  )
}
