/**
 * Single source of truth for every app action: the global key handler, the
 * command palette, the shortcuts sheet and toolbar tooltips all read this.
 *
 * Combo syntax: `Mod+Shift+KeyP` — tokens are Mod (⌘ on Mac, Ctrl elsewhere),
 * Ctrl, Alt, Shift and a KeyboardEvent.code. Matching is by physical key code
 * so Option-dead-keys on Mac and non-Latin layouts still work.
 *
 * Browser-reserved combos (⌘/Ctrl + N, W, T, 1–9) never reach a web page, so
 * every such action also has a working alternative on the ⌃⌥ "window layer".
 */
import { useEditorStore } from '../store/editorStore'
import { useGroupStore } from '../store/groupStore'
import { useLayoutStore } from '../store/layoutStore'
import { useUiStore } from '../store/uiStore'
import { displayTitle } from './noteMeta'
import { isMac } from './platform'
import { findLeaf, leaves } from './tiling'
import * as ws from './workspace'

export type CommandSection = 'Notes' | 'Navigate' | 'Tiles' | 'View' | 'App'

export interface Command {
  id: string
  title: string
  section: CommandSection
  /** First combo is the one shown in menus and tooltips. */
  keys?: string[]
  run: () => void
  /** Hidden from the palette (e.g. "go to tab 3" — covered by one sheet row). */
  paletteHidden?: boolean
  /** Extra words the palette matches on. */
  keywords?: string
  enabled?: () => boolean
}

const hasNote = () => ws.currentNoteId() != null
const multipleTiles = () => leaves(useLayoutStore.getState().root).length > 1
const focusedIsNote = () => {
  const { root, focusedId } = useLayoutStore.getState()
  return findLeaf(root, focusedId)?.content.kind === 'note'
}

const tabCommands: Command[] = Array.from({ length: 9 }, (_, i) => ({
  id: `tab.go${i + 1}`,
  title: i === 8 ? 'Go to Last Tab' : `Go to Tab ${i + 1}`,
  section: 'Navigate' as const,
  keys: [`Ctrl+Alt+Digit${i + 1}`],
  run: () => ws.goToTab(i + 1),
  paletteHidden: true,
}))

export const COMMANDS: Command[] = [
  // ---- Notes ---------------------------------------------------------------
  {
    id: 'note.new',
    title: 'New Note',
    section: 'Notes',
    keys: ['Ctrl+Alt+KeyN', 'Mod+KeyN'],
    keywords: 'create add compose',
    run: () => ws.newNote(),
  },
  {
    id: 'note.newSplit',
    title: 'New Note in New Tile',
    section: 'Notes',
    keys: ['Ctrl+Alt+Shift+KeyN'],
    keywords: 'create split side',
    run: () => ws.newNote({ split: 'auto' }),
  },
  {
    id: 'note.close',
    title: 'Close Note Tab',
    section: 'Notes',
    keys: ['Ctrl+Alt+KeyW', 'Mod+KeyW'],
    run: () => {
      const { root, focusedId } = useLayoutStore.getState()
      const tile = findLeaf(root, focusedId)
      // An empty tile has no tab of its own — close the tile instead.
      if (tile?.content.kind === 'empty') return ws.closeTile()
      const id = ws.currentNoteId()
      if (id != null) useEditorStore.getState().closeTab(id)
    },
  },
  {
    id: 'note.rename',
    title: 'Rename Note…',
    section: 'Notes',
    keys: ['F2'],
    keywords: 'title',
    run: () => ws.startRename(),
    enabled: hasNote,
  },
  {
    id: 'note.save',
    title: 'Save Now',
    section: 'Notes',
    keys: ['Mod+KeyS'],
    keywords: 'sync persist',
    run: () => void ws.saveNow(),
  },
  {
    id: 'note.duplicate',
    title: 'Duplicate Note',
    section: 'Notes',
    keywords: 'copy clone',
    run: () => ws.duplicateNote(),
    enabled: hasNote,
  },
  {
    id: 'note.export',
    title: 'Export as Markdown',
    section: 'Notes',
    keys: ['Mod+Shift+KeyE'],
    keywords: 'download save file md',
    run: () => ws.exportMarkdown(),
    enabled: hasNote,
  },
  {
    id: 'note.delete',
    title: 'Delete Note…',
    section: 'Notes',
    keys: ['Mod+Shift+Backspace'],
    keywords: 'remove trash discard',
    run: () => ws.requestDelete(),
    enabled: hasNote,
  },
  {
    id: 'folder.new',
    title: 'New Folder',
    section: 'Notes',
    keywords: 'group create',
    run: () => {
      const ui = useUiStore.getState()
      if (!ui.sidebarOpen) ui.setSidebarOpen(true)
      if (!ui.foldersOpen) ui.toggleFolders()
      useGroupStore.getState().addGroup()
    },
  },

  // ---- Navigate ------------------------------------------------------------
  {
    id: 'nav.quickOpen',
    title: 'Search Notes…',
    section: 'Navigate',
    keys: ['Mod+KeyP', 'Mod+Shift+KeyF'],
    keywords: 'find open go to quick switcher global',
    run: () => useUiStore.getState().openPalette('notes'),
  },
  {
    id: 'nav.commands',
    title: 'Command Palette…',
    section: 'Navigate',
    keys: ['Mod+Shift+KeyP', 'F1'],
    run: () => useUiStore.getState().openPalette('commands'),
  },
  {
    id: 'nav.find',
    title: 'Find in Note',
    section: 'Navigate',
    keys: ['Mod+KeyF'],
    keywords: 'search replace',
    run: () => ws.findInNote(),
  },
  {
    id: 'nav.nextTab',
    title: 'Next Tab',
    section: 'Navigate',
    keys: ['Ctrl+Alt+BracketRight'],
    run: () => ws.cycleTab(1),
  },
  {
    id: 'nav.prevTab',
    title: 'Previous Tab',
    section: 'Navigate',
    keys: ['Ctrl+Alt+BracketLeft'],
    run: () => ws.cycleTab(-1),
  },
  ...tabCommands,
  {
    id: 'nav.notesList',
    title: 'Focus Notes List',
    section: 'Navigate',
    keys: ['Ctrl+Alt+Digit0'],
    keywords: 'sidebar browse',
    run: () => ws.focusNotesList(),
  },

  // ---- Tiles ---------------------------------------------------------------
  {
    id: 'tile.split',
    title: 'Split Tile',
    section: 'Tiles',
    keys: ['Mod+Backslash'],
    keywords: 'tiling dwindle side by side',
    run: () => ws.splitTile('auto'),
  },
  {
    id: 'tile.splitRight',
    title: 'Split Right',
    section: 'Tiles',
    keys: ['Ctrl+Alt+Backslash'],
    keywords: 'vertical tiling',
    run: () => ws.splitTile('row'),
  },
  {
    id: 'tile.splitDown',
    title: 'Split Down',
    section: 'Tiles',
    keys: ['Ctrl+Alt+Minus'],
    keywords: 'horizontal tiling',
    run: () => ws.splitTile('column'),
  },
  {
    id: 'tile.close',
    title: 'Close Tile',
    section: 'Tiles',
    keys: ['Ctrl+Alt+KeyQ'],
    run: () => ws.closeTile(),
  },
  ...(
    [
      ['Left', 'ArrowLeft', 'KeyH'],
      ['Right', 'ArrowRight', 'KeyL'],
      ['Up', 'ArrowUp', 'KeyK'],
      ['Down', 'ArrowDown', 'KeyJ'],
    ] as const
  ).flatMap(([name, arrow, vim]): Command[] => [
    {
      id: `tile.focus${name}`,
      title: `Focus Tile ${name}`,
      section: 'Tiles',
      keys: [`Ctrl+Alt+${arrow}`, `Ctrl+Alt+${vim}`],
      run: () => ws.focusDirection(name.toLowerCase() as 'left'),
      enabled: multipleTiles,
    },
    {
      id: `tile.swap${name}`,
      title: `Move Note ${name}`,
      section: 'Tiles',
      keys: [`Ctrl+Alt+Shift+${arrow}`, `Ctrl+Alt+Shift+${vim}`],
      keywords: 'swap',
      run: () => ws.swapDirection(name.toLowerCase() as 'left'),
      enabled: multipleTiles,
    },
  ]),
  {
    id: 'tile.zoom',
    title: 'Zoom Tile',
    section: 'Tiles',
    keys: ['Ctrl+Alt+Enter'],
    keywords: 'maximize monocle fullscreen',
    run: () => useLayoutStore.getState().toggleZoom(),
    enabled: multipleTiles,
  },
  {
    id: 'tile.equalize',
    title: 'Equalize Tiles',
    section: 'Tiles',
    keys: ['Ctrl+Alt+Equal'],
    keywords: 'balance reset sizes',
    run: () => useLayoutStore.getState().equalize(),
    enabled: multipleTiles,
  },
  {
    id: 'tile.rotate',
    title: 'Rotate Split',
    section: 'Tiles',
    keys: ['Ctrl+Alt+KeyR'],
    keywords: 'toggle orientation togglesplit',
    run: () => useLayoutStore.getState().rotate(),
    enabled: multipleTiles,
  },

  // ---- View ----------------------------------------------------------------
  {
    id: 'view.sidebar',
    title: 'Toggle Sidebar',
    section: 'View',
    keys: ['Ctrl+Alt+KeyS', 'Mod+Digit1'],
    run: () => useUiStore.getState().toggleSidebar(),
  },
  {
    id: 'view.folders',
    title: 'Toggle Folders',
    section: 'View',
    keys: ['Ctrl+Alt+Shift+KeyS'],
    run: () => {
      const ui = useUiStore.getState()
      if (!ui.sidebarOpen) ui.setSidebarOpen(true)
      ui.toggleFolders()
    },
  },
  {
    id: 'view.read',
    title: 'Toggle Read Mode',
    section: 'View',
    keys: ['Mod+KeyE'],
    keywords: 'preview markdown render',
    run: () => ws.toggleReadMode(),
    enabled: focusedIsNote,
  },
  {
    id: 'view.board',
    title: 'Toggle Whiteboard',
    section: 'View',
    keys: ['Mod+Shift+KeyD'],
    keywords: 'draw sketch excalidraw canvas',
    run: () => ws.toggleBoard(),
    enabled: hasNote,
  },
  {
    id: 'view.textBigger',
    title: 'Increase Text Size',
    section: 'View',
    keys: ['Mod+Equal'],
    keywords: 'zoom font larger',
    run: () => ws.adjustTextSize(1),
  },
  {
    id: 'view.textSmaller',
    title: 'Decrease Text Size',
    section: 'View',
    keys: ['Mod+Minus'],
    keywords: 'zoom font smaller',
    run: () => ws.adjustTextSize(-1),
  },
  {
    id: 'view.textReset',
    title: 'Actual Text Size',
    section: 'View',
    keys: ['Mod+Digit0'],
    run: () => ws.adjustTextSize(0),
  },
  {
    id: 'view.appearance',
    title: 'Toggle Dark Mode',
    section: 'View',
    keywords: 'theme light appearance',
    run: () => ws.cycleAppearance(),
  },

  // ---- App -----------------------------------------------------------------
  {
    id: 'app.settings',
    title: 'Settings…',
    section: 'App',
    keys: ['Mod+Comma'],
    keywords: 'preferences appearance accent font',
    run: () => useUiStore.getState().setSettingsOpen(true),
  },
  {
    id: 'app.shortcuts',
    title: 'Keyboard Shortcuts',
    section: 'App',
    keys: ['Mod+Slash'],
    keywords: 'help keys',
    run: () => useUiStore.getState().setShortcutsOpen(true),
  },
]

export const COMMAND_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

/** Context-dependent commands (e.g. one "Move to …" per folder). */
export function dynamicCommands(): Command[] {
  const noteId = ws.currentNoteId()
  if (noteId == null) return []
  const paste = useEditorStore.getState().pastes.find((p) => p.id === noteId)
  if (!paste) return []
  const name = displayTitle(paste)
  const groups = useGroupStore.getState().groups
  const move: Command[] = groups
    .filter((g) => g.id !== paste.group_id)
    .map((g) => ({
      id: `note.moveTo.${g.id}`,
      title: `Move “${name}” to ${g.name}`,
      section: 'Notes',
      keywords: 'folder group assign',
      run: () => useEditorStore.getState().assignGroup(noteId, g.id),
    }))
  if (paste.group_id != null) {
    move.push({
      id: 'note.moveTo.none',
      title: `Move “${name}” to Unfiled`,
      section: 'Notes',
      keywords: 'folder group remove',
      run: () => useEditorStore.getState().assignGroup(noteId, null),
    })
  }
  return move
}

// ---------------------------------------------------------------------------
// Key matching
// ---------------------------------------------------------------------------

interface ParsedCombo {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  code: string
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+')
  const code = parts[parts.length - 1]!
  const mods = new Set(parts.slice(0, -1))
  const mod = mods.has('Mod')
  return {
    meta: isMac ? mod : false,
    ctrl: mods.has('Ctrl') || (!isMac && mod),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
    code,
  }
}

const keyTable: Array<{ combo: ParsedCombo; command: Command }> = COMMANDS.flatMap((command) =>
  (command.keys ?? []).map((k) => ({ combo: parseCombo(k), command })),
)

export function matchCommand(e: KeyboardEvent): Command | null {
  if (e.isComposing) return null
  // AltGr (Ctrl+Alt on Windows/Linux international layouts) types characters like @ { [ €.
  if (e.getModifierState?.('AltGraph')) return null
  for (const { combo, command } of keyTable) {
    if (
      combo.code === e.code &&
      combo.meta === e.metaKey &&
      combo.ctrl === e.ctrlKey &&
      combo.alt === e.altKey &&
      combo.shift === e.shiftKey
    ) {
      return command
    }
  }
  return null
}

export function runCommand(command: Command): boolean {
  if (command.enabled && !command.enabled()) return false
  command.run()
  return true
}

export function primaryKey(id: string): string | undefined {
  return COMMAND_BY_ID.get(id)?.keys?.[0]
}
