/**
 * How a note opens in a tile. Most notes open in the editor; a plugin can claim a note so that opening it anywhere
 * (notes list, tabs, drag to a tile, links) shows the plugin's view instead, e.g. a book note opens the reader.
 * The plugin host installs the resolver; the layout code only asks it, so core never imports a plugin.
 */
import { findLeafBy, type LayoutNode, type LeafNode, type TileContent, type TileMode } from './tiling'

export interface NoteView {
  pluginId: string
  view: string
}

let resolver: (noteId: number) => NoteView | null = () => null

export function setNoteViewResolver(fn: (noteId: number) => NoteView | null) {
  resolver = fn
}

/** The plugin view a note opens in, or null for the editor. */
export function noteViewFor(noteId: number): NoteView | null {
  try {
    return resolver(noteId)
  } catch (err) {
    console.error('[layout] note view resolver failed:', err)
    return null
  }
}

/** What a tile shows when this note is opened. `raw` forces the editor (e.g. "Open Notes" from a book). */
export function contentForNote(noteId: number, mode: TileMode = 'edit', raw = false): TileContent {
  const view = raw ? null : noteViewFor(noteId)
  return view ? { kind: 'plugin', pluginId: view.pluginId, view: view.view, noteId } : { kind: 'note', noteId, mode }
}

/** True when the tile is the note's primary view: the editor, or the plugin view the note opens in. */
export function isPrimaryContent(content: TileContent): boolean {
  if (content.kind === 'note') return true
  if (content.kind !== 'plugin') return false
  const view = noteViewFor(content.noteId)
  return view != null && view.pluginId === content.pluginId && view.view === content.view
}

/** The tile showing this note as it opens: its plugin view when it has one (unless `raw`), else its editor tile. */
export function primaryLeafFor(root: LayoutNode, noteId: number, raw = false): LeafNode | null {
  const view = raw ? null : noteViewFor(noteId)
  return findLeafBy(root, (l) => {
    const c = l.content
    if (view) return c.kind === 'plugin' && c.noteId === noteId && c.pluginId === view.pluginId && c.view === view.view
    return c.kind === 'note' && c.noteId === noteId
  })
}
