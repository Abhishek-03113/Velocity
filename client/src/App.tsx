import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import StatusBar from './components/chrome/StatusBar'
import TabBar from './components/chrome/TabBar'
import Toolbar from './components/chrome/Toolbar'
import Alert from './components/overlays/Alert'
import CommandPalette from './components/overlays/CommandPalette'
import SettingsSheet from './components/overlays/SettingsSheet'
import ShortcutsSheet from './components/overlays/ShortcutsSheet'
import Sidebar from './components/sidebar/Sidebar'
import Workspace from './components/workspace/Workspace'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { useEditorStore } from './store/editorStore'
import { useGroupStore } from './store/groupStore'
import { useUiStore } from './store/uiStore'
import styles from './App.module.css'

function LaunchState() {
  return (
    <div className={styles.launch} aria-busy="true" aria-label="Loading your notes">
      <div className={styles.launchMark} />
    </div>
  )
}

export default function App() {
  const loaded = useEditorStore((s) => s.loaded)
  const { paletteOpen, settingsOpen, shortcutsOpen } = useUiStore(
    useShallow((s) => ({
      paletteOpen: s.paletteOpen,
      settingsOpen: s.settingsOpen,
      shortcutsOpen: s.shortcutsOpen,
    })),
  )

  useEffect(() => {
    void useEditorStore.getState().initialize()
    void useGroupStore.getState().initialize()
  }, [])

  useGlobalShortcuts()

  return (
    <div className={styles.app}>
      <Sidebar />
      <main className={styles.main}>
        <Toolbar />
        <TabBar />
        {loaded ? <Workspace /> : <LaunchState />}
        <StatusBar />
      </main>
      {paletteOpen && <CommandPalette />}
      {settingsOpen && <SettingsSheet />}
      {shortcutsOpen && <ShortcutsSheet />}
      <Alert />
    </div>
  )
}
