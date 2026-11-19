/**
 * Exports a book's highlights, quotes and bookmarks as a Markdown note (see highlightsNote.ts), on request only.
 * The database is the source of truth (the reader's drawer reads it); the note is a snapshot the user asks for,
 * refreshed each time it is exported, never rewritten behind their back.
 */
import { useEditorStore } from '../../store/editorStore'
import { useGroupStore } from '../../store/groupStore'
import { cachedContent } from '../../store/searchStore'
import type { PluginContext } from '../types'
import { loadAnnotations, NO_ANNOTATIONS, useAnnotationsStore } from './annotations'
import { highlightsNoteContent, highlightsTitle } from './highlightsNote'
import { findBookNote, highlightsBookIdOf, lookupBookNote } from './note'
import { useBooksStore } from './store'

export interface Highlights {
  /** The highlights note id if it is known to exist (no loading). */
  noteIdFor(bookId: number): number | null
  /**
   * The note id once it is certain: a number, null when there is none, undefined when it cannot be told
   * yet (notes in the Books folder that did not load).
   */
  resolve(bookId: number): Promise<number | null | undefined>
  /** Rebuild the note now. Creates it when the book has annotations; never for a book without any. */
  regenerate(bookId: number): Promise<number | null | undefined>
  /** Open the note in Read mode beside the current tile (creating it first when needed). */
  open(bookId: number): void
  /** Fetch the book's annotations so counts and the note are ready. */
  prefetch(bookId: number): void
  /** Delete the note (the book is being removed). */
  deleteNote(noteId: number): void
  /** Forget pending rebuilds for a book that is going away. */
  cancel(bookId: number): void
  dispose(): void
}

export function createHighlights(ctx: PluginContext): Highlights {
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const chains = new Map<number, Promise<unknown>>()
  const known = new Map<number, number>()
  let disposed = false

  const editor = () => useEditorStore.getState()
  const folderName = () => ctx.setting<string>('folder').trim() || 'Books'
  const folderId = (): number | null => {
    const wanted = folderName().toLowerCase()
    return useGroupStore.getState().groups.find((g) => g.name.trim().toLowerCase() === wanted)?.id ?? null
  }

  const noteIdFor = (bookId: number): number | null => {
    const cached = known.get(bookId)
    if (cached != null && ctx.notes.exists(cached)) return cached
    const found = findBookNote(bookId, editor().pastes, cachedContent, highlightsBookIdOf)
    if (found != null) known.set(bookId, found)
    return found
  }

  const lookup = (bookId: number) => lookupBookNote(bookId, editor().pastes, folderId(), cachedContent, highlightsBookIdOf)

  const resolve = async (bookId: number): Promise<number | null | undefined> => {
    const cached = noteIdFor(bookId)
    if (cached != null) return cached
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = lookup(bookId)
      if (result.status === 'found') return result.id
      if (result.status === 'missing') return null
      await Promise.all(result.candidates.map((id) => editor().ensureContent(id)))
    }
    const last = lookup(bookId)
    return last.status === 'found' ? last.id : last.status === 'missing' ? null : undefined
  }

  const rebuild = async (bookId: number): Promise<number | null | undefined> => {
    const book = useBooksStore.getState().books[bookId]
    if (!book || disposed) return undefined
    await loadAnnotations(bookId)
    // Without the server's list, only the unsynced rows are known: writing now would drop the rest.
    if (!useAnnotationsStore.getState().loaded[bookId]) return undefined
    const list = useAnnotationsStore.getState().byBook[bookId] ?? NO_ANNOTATIONS
    let noteId = await resolve(bookId)
    if (noteId === undefined || disposed) return undefined
    if (noteId == null && list.length === 0) return null

    const content = highlightsNoteContent(book, list)
    const title = highlightsTitle(book)
    if (noteId == null) {
      // reveal: false keeps the new note out of the tabs and tiles.
      noteId = editor().addPaste(ctx.folders.ensure(folderName()), { reveal: false })
      known.set(bookId, noteId)
      editor().setTitle(noteId, title)
      editor().setContent(content, noteId)
      return noteId
    }
    await editor().ensureContent(noteId)
    const current = editor().pastes.find((p) => p.id === noteId)
    if (!current) return noteId
    if (current.title !== title) editor().setTitle(noteId, title)
    if (current.content !== content) editor().setContent(content, noteId)
    return noteId
  }

  const cancel = (bookId: number) => {
    const timer = timers.get(bookId)
    if (timer) clearTimeout(timer)
    timers.delete(bookId)
  }

  // One rebuild at a time per book, so two quick changes can never create two notes.
  const regenerate = (bookId: number): Promise<number | null | undefined> => {
    cancel(bookId)
    const job = (chains.get(bookId) ?? Promise.resolve()).catch(() => undefined).then(() => rebuild(bookId))
    const tracked = job.finally(() => {
      if (chains.get(bookId) === tracked) chains.delete(bookId)
    })
    chains.set(bookId, tracked)
    tracked.catch((err) => console.error('[books] could not update the highlights note', err))
    return job
  }

  return {
    noteIdFor,
    resolve,
    regenerate,
    cancel,
    prefetch: (bookId) => void loadAnnotations(bookId),
    open: (bookId) => {
      void (async () => {
        const noteId = await regenerate(bookId)
        if (disposed) return
        if (noteId == null) {
          ctx.flash(noteId === null ? 'No highlights yet' : 'Couldn’t check this book’s highlights yet. Try again in a moment')
          return
        }
        ctx.notes.open(noteId, { split: true, mode: 'read' })
      })()
    },
    deleteNote: (noteId) => {
      known.forEach((id, bookId) => {
        if (id === noteId) known.delete(bookId)
      })
      editor().deletePaste(noteId)
    },
    dispose: () => {
      disposed = true
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    },
  }
}
