import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { COMPACT_QUERY, useMediaQuery, WIDE_QUERY } from '../../hooks/useMediaQuery'
import { useUiStore } from '../../store/uiStore'
import { ContextMenu, type MenuState } from '../ui/ContextMenu'
import { FoldersColumn } from './FoldersColumn'
import { NotesColumn } from './NotesColumn'
import { SidebarResizer } from './SidebarResizer'
import styles from './Sidebar.module.css'

/**
 * Two-column source list (Apple Notes): folders on a vibrancy material, then the
 * note list. Below 1180px the folders column folds into a picker; below 760px
 * the whole sidebar becomes an overlay sheet.
 */
export default function Sidebar() {
  const { sidebarOpen, foldersOpen, setSidebarOpen, foldersWidth, notesWidth } = useUiStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      foldersOpen: s.foldersOpen,
      setSidebarOpen: s.setSidebarOpen,
      foldersWidth: s.prefs.foldersWidth,
      notesWidth: s.prefs.notesWidth,
    })),
  )
  const asideRef = useRef<HTMLElement>(null)
  const wide = useMediaQuery(WIDE_QUERY)
  const compact = useMediaQuery(COMPACT_QUERY)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const showFolders = foldersOpen && wide && !compact

  // Crossing into phone width turns the sidebar into a closed overlay; crossing
  // back restores whatever the desktop layout had.
  const desktopOpen = useRef(compact ? true : sidebarOpen)
  useEffect(() => {
    if (compact) {
      desktopOpen.current = useUiStore.getState().sidebarOpen
      useUiStore.setState({ sidebarOpen: false })
    } else {
      useUiStore.setState({ sidebarOpen: desktopOpen.current })
    }
  }, [compact])

  return (
    <>
      {compact && sidebarOpen && (
        <div className={styles.scrim} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.open : styles.closed} ${
          compact ? styles.overlay : ''
        }`}
        aria-label="Sidebar"
        ref={asideRef}
        style={
          compact
            ? undefined
            : ({
                '--folders-width': `${foldersWidth}px`,
                '--notes-width': `${notesWidth}px`,
                width: showFolders ? 'calc(var(--folders-width) + var(--notes-width))' : 'var(--notes-width)',
              } as CSSProperties)
        }
        aria-hidden={!sidebarOpen || undefined}
        {...(sidebarOpen ? {} : ({ inert: '' } as object))}
      >
        {showFolders && <FoldersColumn onMenu={setMenu} />}
        <NotesColumn
          onMenu={setMenu}
          showFolderPicker={!showFolders}
          canShowFolders={wide && !compact && !foldersOpen}
          compact={compact}
        />
        {!compact && sidebarOpen && showFolders && <SidebarResizer which="folders" asideRef={asideRef} />}
        {!compact && sidebarOpen && <SidebarResizer which="notes" asideRef={asideRef} />}
      </aside>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </>
  )
}
