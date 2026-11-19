/** The ReaderHost the reader tile (ACC-24) gets: books from the store, progress back to the server. */
import { useEffect } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { cachedContent } from '../../store/searchStore'
import type { PluginContext } from '../types'
import { addAnnotation, removeAnnotation, updateAnnotation, useAnnotations } from './annotations'
import { bookFileUrl, patchBook } from './api'
import type { BooksLibrary } from './metadata'
import { bookIdOf } from './note'
import { useBooksStore } from './store'
import type { Book, ProgressPatch, ReaderHost } from './types'

export function createReaderHost(ctx: PluginContext, library: BooksLibrary): ReaderHost {
  const opened = new Set<number>()
  const requested = new Set<number>()

  return {
    useBookForNote(noteId: number): Book | null | undefined {
      const live = useEditorStore((s) => s.pastes.find((p) => p.id === noteId)?.content)
      const content = live ?? cachedContent(noteId)
      const bookId = bookIdOf(content)
      const loaded = useBooksStore((s) => s.loaded)
      const book = useBooksStore((s) => (bookId == null ? undefined : s.books[bookId]))
      const missing = useBooksStore((s) => (bookId == null ? false : s.missing[bookId] === true))

      useEffect(() => {
        if (live === undefined && ctx.notes.exists(noteId)) void useEditorStore.getState().ensureContent(noteId)
      }, [live, noteId])
      useEffect(() => {
        if (!loaded) void library.loadBooks()
      }, [loaded])
      // A note whose book the list does not have (added on another device since the last load).
      const wanted = bookId != null && !book && !missing && loaded
      useEffect(() => {
        if (wanted && bookId != null && !requested.has(bookId)) {
          requested.add(bookId)
          void library.fetchBook(bookId)
        }
      }, [wanted, bookId])

      if (content === undefined) return undefined
      if (bookId == null) return null
      if (book) return book
      return missing ? null : undefined
    },

    fileUrl: (book) => bookFileUrl(book),

    setLocalProgress: (bookId, patch) => useBooksStore.getState().applyProgress(bookId, patch),

    async saveProgress(bookId: number, patch: ProgressPatch, opts) {
      const updated = await patchBook(bookId, patch, opts)
      // A newer position may have been recorded while this request was in flight: keep it.
      const current = useBooksStore.getState().books[bookId]
      if (!current || current.position === updated.position) useBooksStore.getState().upsertBook(updated)
    },

    markOpened(bookId) {
      if (opened.has(bookId)) return
      opened.add(bookId)
      patchBook(bookId, { opened: true }).then(
        (updated) => useBooksStore.getState().patchLocal(bookId, { last_opened_at: updated.last_opened_at, updated_at: updated.updated_at }),
        (err) => {
          opened.delete(bookId)
          console.error('[books] could not mark the book opened', err)
        },
      )
    },

    downloadOriginal: (book) => library.download(book),

    useAnnotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    openHighlightsNote: (bookId) => library.highlights.open(bookId),
  }
}
