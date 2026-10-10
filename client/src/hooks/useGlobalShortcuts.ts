import { useEffect } from 'react'
import { matchCommand, runCommand } from '../lib/commands'
import { useUiStore } from '../store/uiStore'

/**
 * One capture-phase listener for every app shortcut. Capture runs before
 * CodeMirror's own handlers, so shortcuts behave identically whether focus is
 * in an editor, the sidebar, or nowhere at all.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const ui = useUiStore.getState()
      // Modal surfaces own the keyboard while open.
      if (ui.alert || ui.paletteOpen || ui.settingsOpen || ui.shortcutsOpen) return
      const command = matchCommand(e)
      if (!command) return
      // Plain function keys inside text fields belong to the field (e.g. F2 while renaming).
      const target = e.target as HTMLElement | null
      if (
        command.id === 'note.rename' &&
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return
      }
      if (runCommand(command)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])
}
