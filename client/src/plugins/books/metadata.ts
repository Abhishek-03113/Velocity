/**
 * The library controller: the import pipeline (upload → meta → cover → PATCH → note) and every
 * action the shelf, commands and badges run on books. One instance per activation.
 */
import { useEditorStore } from '../../store/editorStore'
import { cachedContent } from '../../store/searchStore'
import { useUiStore } from '../../store/uiStore'
import type { PluginContext } from '../types'
import {
  BooksApiError,
  bookFileUrl,
  deleteBook,
  getBook,
  isBookFile,
  listBooks,
  MSG_NOT_A_BOOK,
  patchBook,
  uploadBook,
  uploadCover,
  type BookPatch,
} from './api'
import { findLeaf, leaves, pluginLeafFor } from '../../lib/tiling'
import { useGroupStore } from '../../store/groupStore'
import { useLayoutStore } from '../../store/layoutStore'
import { forgetBook } from './annotations'
import { createHighlights, type Highlights } from './highlights'
import { bookNoteContent, findBookNote, lookupBookNote } from './note'
import { scanNotes, useBooksStore, type UploadItem } from './store'
import type { Book } from './types'

const CONCURRENCY = 2
export const READER_VIEW = 'reader'
export const SHELF_VIEW = 'shelf'

export interface BooksLibrary {
  loadBooks(): Promise<void>
  /** Fetch one book the list does not have (e.g. a note whose book was added on another device). */
  fetchBook(id: number): Promise<void>
  add(files: File[]): void
  retry(key: string): void
  dismiss(key: string): void
  noteIdFor(bookId: number): number | null
  /** The note for a book, created in the Books folder (without opening it) when missing. */
  ensureNote(book: Book): number
  /** `fit`: a link opened it (not the user choosing a tile), so keep the reader readable by not adding yet another narrow split. */
  openBook(bookId: number, opts?: { fit?: boolean }): void
  openNotes(bookId: number): void
  markUnread(book: Book): void
  markFinished(book: Book): void
  rename(book: Book): void
  download(book: Book): void
  remove(book: Book): void
  /** The book's highlights note (see highlights.ts). */
  highlights: Highlights
  dispose(): void
}

export function createLibrary(ctx: PluginContext): BooksLibrary {
  const store = () => useBooksStore.getState()
  const aborts = new Set<AbortController>()
  const queue: string[] = []
  let running = 0
  let counter = 0
  let disposed = false
  const highlights = createHighlights(ctx)

  const folderName = () => ctx.setting<string>('folder').trim() || 'Books'
  const fail = (message: string, err: unknown) => console.error(`[books] ${message}`, err)

  // ── Loading ────────────────────────────────────────────────────────────────

  const loadBooks = async () => {
    if (store().loading) return
    store().setLoading(true)
    try {
      const list = await listBooks()
      if (!disposed) store().setBooks(list)
    } catch (err) {
      fail('could not load the library', err)
      if (!disposed) store().setLoading(false, err instanceof Error ? err.message : 'Failed to load')
    }
  }

  const fetchBook = async (id: number) => {
    try {
      store().upsertBook(await getBook(id))
    } catch (err) {
      if (err instanceof BooksApiError && err.status === 404) store().markMissing(id)
      else fail(`could not load book ${id}`, err)
    }
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  const noteIdFor = (bookId: number): number | null => {
    const known = store().noteIdByBook[bookId]
    if (known != null && ctx.notes.exists(known)) return known
    return findBookNote(bookId, useEditorStore.getState().pastes, cachedContent)
  }

  const folderId = (): number | null => {
    const wanted = folderName().toLowerCase()
    return useGroupStore.getState().groups.find((g) => g.name.trim().toLowerCase() === wanted)?.id ?? null
  }

  const lookup = (bookId: number) => lookupBookNote(bookId, useEditorStore.getState().pastes, folderId(), cachedContent)

  /**
   * The book's note id, once it is certain: a number when found, null when it really is gone, and
   * undefined when it cannot be told yet (notes in the folder that failed to load). Right after a
   * reload note content may be unloaded, so the Books folder's unknown notes are loaded first.
   */
  const resolveNote = async (bookId: number): Promise<number | null | undefined> => {
    const known = noteIdFor(bookId)
    if (known != null) return known
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = lookup(bookId)
      if (result.status === 'found') return result.id
      if (result.status === 'missing') return null
      await Promise.all(result.candidates.map((id) => useEditorStore.getState().ensureContent(id)))
    }
    const last = lookup(bookId)
    return last.status === 'found' ? last.id : last.status === 'missing' ? null : undefined
  }

  /** Resolve, then create the note when it is certainly missing. One at a time per book. */
  const pendingNotes = new Map<number, Promise<number | undefined>>()
  const noteForBook = (bookId: number): Promise<number | undefined> => {
    const inflight = pendingNotes.get(bookId)
    if (inflight) return inflight
    const job = (async () => {
      const id = await resolveNote(bookId)
      if (id === undefined) return undefined
      if (id != null) return id
      const book = store().books[bookId]
      return book ? ensureNote(book) : undefined
    })().finally(() => pendingNotes.delete(bookId))
    pendingNotes.set(bookId, job)
    return job
  }

  const NOTE_NOT_READY = 'Couldn’t check this book’s note yet. Try again in a moment'

  const ensureNote = (book: Book): number => {
    const existing = noteIdFor(book.id)
    if (existing != null) return existing
    const editor = useEditorStore.getState()
    // reveal: false keeps the note out of the tabs and tiles, so importing never takes the shelf's place.
    const id = editor.addPaste(ctx.folders.ensure(folderName()), { reveal: false })
    editor.setTitle(id, book.title)
    editor.setContent(bookNoteContent(book), id)
    scanNotes()
    return id
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  const updateActivity = () => {
    const open = store().uploads.filter((u) => u.status !== 'error').length
    ctx.activity(open === 0 ? null : open === 1 ? 'Adding 1 book…' : `Adding ${open} books…`)
  }

  const finishCard = (key: string) => {
    store().removeUpload(key)
    updateActivity()
  }

  const processBook = async (item: UploadItem, book: Book): Promise<Book> => {
    store().patchUpload(item.key, { status: 'processing', progress: 1 })
    const patch: BookPatch = {}
    try {
      const data = await item.file.arrayBuffer()
      const meta =
        book.format === 'epub'
          ? await (await import('./reader/epub/meta')).readEpubMeta(data)
          : await (await import('./reader/pdf/meta')).readPdfMeta(data)
      if (meta.title?.trim()) patch.title = meta.title.trim().slice(0, 300)
      if (meta.author?.trim()) patch.author = meta.author.trim().slice(0, 300)
      if (meta.pageCount != null) patch.page_count = meta.pageCount
      if (meta.cover) {
        try {
          patch.cover_url = await uploadCover(meta.cover)
        } catch (err) {
          fail('cover upload failed', err)
        }
      }
    } catch (err) {
      // A book we cannot read here still belongs on the shelf, under the title the server chose.
      fail('could not read book metadata', err)
    }
    if (Object.keys(patch).length === 0) return book
    try {
      const updated = await patchBook(book.id, patch)
      store().upsertBook(updated)
      return updated
    } catch (err) {
      fail('could not save book metadata', err)
      return book
    }
  }

  const run = async (item: UploadItem) => {
    const controller = new AbortController()
    aborts.add(controller)
    try {
      store().patchUpload(item.key, { status: 'uploading', progress: 0, error: undefined })
      const { book, duplicate } = await uploadBook(item.file, (p) => store().patchUpload(item.key, { progress: p }), controller.signal)
      if (disposed) return
      store().upsertBook(book)
      if (duplicate) {
        ctx.flash(`“${book.title}” is already on your shelf`)
        finishCard(item.key)
        store().setFocusBook(book.id)
        return
      }
      const finished = await processBook(item, book)
      if (disposed) return
      ensureNote(finished)
      ctx.flash(`Added “${finished.title}”`)
      finishCard(item.key)
    } catch (err) {
      if (disposed || controller.signal.aborted) return
      const message = err instanceof BooksApiError ? err.message : 'Something went wrong while adding this book'
      if (!(err instanceof BooksApiError)) fail('import failed', err)
      store().patchUpload(item.key, { status: 'error', error: message })
      updateActivity()
    } finally {
      aborts.delete(controller)
    }
  }

  const pump = () => {
    while (running < CONCURRENCY && queue.length) {
      const key = queue.shift()!
      const item = store().uploads.find((u) => u.key === key)
      if (!item) continue
      running++
      void run(item).finally(() => {
        running--
        pump()
      })
    }
  }

  const add = (files: File[]) => {
    if (disposed) return
    for (const file of files) {
      const key = `${Date.now()}-${++counter}`
      const ok = isBookFile(file)
      store().addUpload({ key, name: file.name, progress: 0, status: ok ? 'uploading' : 'error', error: ok ? undefined : MSG_NOT_A_BOOK, file })
      if (ok) queue.push(key)
    }
    updateActivity()
    pump()
  }

  const retry = (key: string) => {
    const item = store().uploads.find((u) => u.key === key)
    if (!item || item.status !== 'error' || !isBookFile(item.file)) return
    store().patchUpload(key, { status: 'uploading', progress: 0, error: undefined })
    queue.push(key)
    updateActivity()
    pump()
  }

  const dismiss = (key: string) => {
    const at = queue.indexOf(key)
    if (at >= 0) queue.splice(at, 1)
    finishCard(key)
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** A split would leave every tile narrower than this, which makes a reader unreadable (one word per line). */
  const MIN_READER_WIDTH = 420

  /**
   * Opening from a link in a crowded workspace: instead of splitting again (every tile would get narrower), put the
   * reader in place of an existing tile, the Bookshelf first, then the focused note, then the widest other note, and
   * only one that is wide enough to read in (else the widest there is). Returns false when a normal split is fine
   * (few tiles, or plenty of room).
   */
  const openReaderInPlace = (noteId: number): boolean => {
    const layout = useLayoutStore.getState()
    const all = leaves(layout.root)
    if (all.length < 2 || pluginLeafFor(layout.root, ctx.id, READER_VIEW, noteId)) return false
    const widthOf = (id: string) => document.querySelector<HTMLElement>(`[data-tile-id="${id}"]`)?.getBoundingClientRect().width ?? 0
    const focused = findLeaf(layout.root, layout.focusedId)
    if (!focused) return false
    const focusedWidth = widthOf(focused.id)
    if (focusedWidth === 0 || focusedWidth / 2 >= MIN_READER_WIDTH) return false
    const isShelf = (l: (typeof all)[number]) => l.content.kind === 'view' && l.content.pluginId === ctx.id
    const rank = (l: (typeof all)[number]) => (isShelf(l) ? 0 : l.id === focused.id ? 1 : 2)
    const candidates = all
      .filter((l) => isShelf(l) || l.content.kind === 'note')
      .sort((a, b) => rank(a) - rank(b) || widthOf(b.id) - widthOf(a.id))
    const target = candidates.find((l) => widthOf(l.id) >= MIN_READER_WIDTH) ?? [...candidates].sort((a, b) => widthOf(b.id) - widthOf(a.id))[0]
    if (!target) return false
    layout.setContent(target.id, { kind: 'plugin', pluginId: ctx.id, view: READER_VIEW, noteId })
    layout.focus(target.id)
    return true
  }

  const openBook = (bookId: number, opts: { fit?: boolean } = {}) => {
    void noteForBook(bookId).then((noteId) => {
      if (disposed) return
      if (noteId == null) {
        if (store().books[bookId]) ctx.flash(NOTE_NOT_READY)
        return
      }
      if (opts.fit && openReaderInPlace(noteId)) return
      ctx.tiles.open(READER_VIEW, noteId, { focus: true })
    })
  }

  const openNotes = (bookId: number) => {
    void noteForBook(bookId).then((noteId) => {
      if (disposed) return
      if (noteId == null) {
        if (store().books[bookId]) ctx.flash(NOTE_NOT_READY)
        return
      }
      ctx.notes.open(noteId, { split: true })
    })
  }

  const save = (book: Book, patch: BookPatch, local: Partial<Book>) => {
    store().patchLocal(book.id, local)
    patchBook(book.id, patch).then(
      (updated) => store().upsertBook(updated),
      (err) => {
        fail('could not update the book', err)
        store().patchLocal(book.id, book)
      },
    )
  }

  const rename = (book: Book) => {
    ctx.prompt({
      title: 'Rename book',
      icon: 'books.vertical',
      placeholder: 'Title',
      initialValue: book.title,
      submitLabel: 'Rename',
      validate: (value) => (!value.trim() ? 'Enter a title' : value.trim().length > 300 ? 'Titles can be up to 300 characters' : null),
      onSubmit: (value) => {
        const title = value.trim()
        if (!title || title === book.title) return
        save(book, { title }, { title })
        void resolveNote(book.id).then((noteId) => {
          if (noteId != null) useEditorStore.getState().setTitle(noteId, title)
        })
        // The highlights note's title and header follow the new name (see highlights.ts).
      },
    })
  }

  const download = (book: Book) => {
    void (async () => {
      try {
        const res = await fetch(bookFileUrl(book))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        ctx.files.download(book.file_name, await res.blob())
      } catch (err) {
        fail('download failed', err)
        ctx.flash('Couldn’t download the book')
      }
    })()
  }

  const remove = (book: Book) => {
    useUiStore.getState().confirm({
      title: `Remove “${book.title}”?`,
      message: 'The book file, its note and its highlights are deleted from Velocity.',
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          // Know the note before the book goes: with its content unloaded it could be left behind.
          const noteId = await resolveNote(book.id)
          if (noteId === undefined) {
            ctx.flash(NOTE_NOT_READY)
            return
          }
          const highlightsId = await highlights.resolve(book.id)
          if (highlightsId === undefined) {
            ctx.flash(NOTE_NOT_READY)
            return
          }
          try {
            await deleteBook(book.id)
          } catch (err) {
            if (!(err instanceof BooksApiError && err.status === 404)) {
              fail('could not remove the book', err)
              ctx.flash('Couldn’t remove the book')
              return
            }
          }
          highlights.cancel(book.id)
          store().removeBook(book.id)
          forgetBook(book.id)
          if (noteId != null) useEditorStore.getState().deletePaste(noteId)
          if (highlightsId != null) highlights.deleteNote(highlightsId)
          scanNotes()
          ctx.flash(`Removed “${book.title}”`)
        })()
      },
    })
  }

  return {
    loadBooks,
    fetchBook,
    add,
    retry,
    dismiss,
    noteIdFor,
    ensureNote,
    openBook,
    openNotes,
    markUnread: (book) => save(book, { status: 'unread', progress: 0, position: null }, { status: 'unread', progress: 0, position: null }),
    markFinished: (book) => save(book, { status: 'finished', progress: 1 }, { status: 'finished', progress: 1 }),
    rename,
    download,
    remove,
    highlights,
    dispose: () => {
      disposed = true
      highlights.dispose()
      for (const c of aborts) c.abort()
      aborts.clear()
      queue.length = 0
      ctx.activity(null)
    },
  }
}
