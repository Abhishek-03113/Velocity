import type { EditorView } from '@codemirror/view'

/**
 * Live CodeMirror views keyed by note id (the workspace guarantees at most one
 * editor tile per note). Lets global commands — find, focus, formatting from
 * the toolbar — target the right editor without prop drilling.
 */
const views = new Map<number, EditorView>()
let pendingFocus: number | null = null

/** Focus on the next frame, resolving the view *then* (StrictMode remounts replace it). */
function focusSoon(noteId: number): void {
  requestAnimationFrame(() => {
    const view = views.get(noteId)
    if (!view) return
    // A dialog opened in the meantime (e.g. ⌘P right after opening a note) keeps focus.
    if (document.querySelector('[aria-modal="true"]')) return
    if (pendingFocus === noteId) pendingFocus = null
    view.focus()
  })
}

export function registerEditor(noteId: number, view: EditorView): void {
  views.set(noteId, view)
  if (pendingFocus === noteId) focusSoon(noteId)
}

export function unregisterEditor(noteId: number, view: EditorView): void {
  if (views.get(noteId) === view) views.delete(noteId)
}

export function getEditor(noteId: number | null | undefined): EditorView | null {
  return noteId == null ? null : (views.get(noteId) ?? null)
}

/** Focus a note's editor now, or as soon as it mounts. */
export function focusEditor(noteId: number | null | undefined): void {
  if (noteId == null) return
  pendingFocus = noteId
  if (views.has(noteId)) focusSoon(noteId)
}

export function remapEditor(from: number, to: number): void {
  const view = views.get(from)
  if (view) {
    views.delete(from)
    views.set(to, view)
  }
  if (pendingFocus === from) pendingFocus = to
}
