import { createElement, lazy, Suspense } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { useGroupStore } from '../../store/groupStore'
import type { NoteBadge, PluginContext, VelocityPlugin } from '../types'
import { createReaderHost } from './host'
import { createLibrary, READER_VIEW, SHELF_VIEW } from './metadata'
import { bindShelfPrefs, resetBooksStore, scanNotes, useBooksStore } from './store'
import { readerTileView } from './ReaderTile'
import type { Book } from './types'

// The shelf (and its styles) load only when it is first opened.
const Bookshelf = lazy(() => import('./Bookshelf'))

// Ctrl+Alt+(Shift+)L is taken by the built-in vim-style tile focus / swap, and built-in keys win over plugin keys.
const KEYS = { shelf: 'Ctrl+Alt+KeyO', add: 'Ctrl+Alt+Shift+KeyO' } as const
const ACCEPT = '.epub,.pdf,application/epub+zip,application/pdf'

/** The notes-list badge for a book: format while unread, percent while reading, Finished when done. */
export function badgeFor(book: Book, open: () => void): NoteBadge {
  const base = { title: 'Open in Reader', onClick: open }
  if (book.status === 'finished') return { ...base, label: 'Finished', tone: 'green' }
  if (book.status === 'reading') return { ...base, label: `${Math.min(99, Math.max(1, Math.round(book.progress * 100)))}%`, tone: 'blue' }
  return { ...base, label: book.format.toUpperCase(), tone: 'purple' }
}

const plugin: VelocityPlugin = {
  manifest: {
    id: 'books',
    name: 'Books',
    description: 'Read EPUB and PDF books beside your notes, with a bookshelf in the Books folder.',
    icon: 'books.vertical',
    version: '1.0.0',
  },
  settings: [
    { key: 'folder', type: 'text', label: 'Books folder', hint: 'The folder that holds your book notes and offers the Bookshelf.', default: 'Books', placeholder: 'Books' },
    {
      key: 'badges',
      type: 'toggle',
      label: 'Mark books in the notes list',
      hint: 'An EPUB / PDF, percent or Finished pill on book notes; click it to open the book in the reader.',
      default: true,
    },
  ],

  activate(ctx: PluginContext) {
    const library = createLibrary(ctx)
    const host = createReaderHost(ctx, library)
    const cleanups: (() => void)[] = []
    let input: HTMLInputElement | null = null
    let badgeTimer: ReturnType<typeof setTimeout> | null = null

    cleanups.push(bindShelfPrefs(ctx.storage))

    // ── Notes ↔ books ──
    scanNotes()
    cleanups.push(
      useEditorStore.subscribe((s, prev) => {
        if (s.pastes !== prev.pastes) scanNotes()
      }),
    )
    let reverseSource: Record<number, number> | null = null
    let reverse = new Map<number, number>()
    const bookIdForNote = (noteId: number): number | undefined => {
      const source = useBooksStore.getState().noteIdByBook
      if (source !== reverseSource) {
        reverseSource = source
        reverse = new Map(Object.entries(source).map(([bookId, id]) => [id, Number(bookId)]))
      }
      return reverse.get(noteId)
    }

    // ── Badges follow the library (debounced: progress changes with every page turn) ──
    cleanups.push(
      useBooksStore.subscribe((s, prev) => {
        if (s.books === prev.books && s.noteIdByBook === prev.noteIdByBook) return
        if (badgeTimer) clearTimeout(badgeTimer)
        badgeTimer = setTimeout(() => {
          badgeTimer = null
          ctx.refreshBadges()
        }, 150)
      }),
    )
    cleanups.push(() => {
      if (badgeTimer) clearTimeout(badgeTimer)
    })

    // ── Files ──
    const pickFiles = () => {
      if (!input) {
        input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = ACCEPT
        input.hidden = true
        input.setAttribute('aria-hidden', 'true')
        input.addEventListener('change', () => {
          const files = Array.from(input?.files ?? [])
          if (input) input.value = ''
          if (files.length) library.add(files)
        })
        document.body.appendChild(input)
      }
      input.click()
    }
    const openShelf = () => {
      ctx.views.open(SHELF_VIEW, { focus: true })
    }

    // ── Startup: library in the background, the Books folder once per browser ──
    void library.loadBooks()
    if (!ctx.storage.get('folderEnsured')) {
      const ensure = () => {
        try {
          ctx.folders.ensure(ctx.setting<string>('folder').trim() || 'Books')
          ctx.storage.set('folderEnsured', true)
        } catch (err) {
          console.error('[books] could not create the Books folder:', err)
        }
      }
      const groups = useGroupStore.getState()
      if (groups.initialized && groups.groups.length > 0) ensure()
      else {
        // Folders are still loading: creating "Books" now could duplicate one that exists on the server.
        const stop = useGroupStore.subscribe((s, prev) => {
          if (s.groups === prev.groups || !s.initialized) return
          stop()
          ensure()
        })
        cleanups.push(stop)
      }
    }

    return {
      commands: [
        { id: 'shelf', title: 'Open Bookshelf', keys: [KEYS.shelf], keywords: 'books library covers epub pdf shelf', run: openShelf },
        {
          id: 'add',
          title: 'Add Books…',
          keys: [KEYS.add],
          keywords: 'import upload epub pdf book file',
          run: () => {
            openShelf()
            pickFiles()
          },
        },
        {
          id: 'open',
          title: 'Open in Reader',
          keywords: 'read book epub pdf reader',
          enabled: () => {
            const id = ctx.notes.current()
            return id != null && bookIdForNote(id) != null
          },
          run: () => {
            const id = ctx.notes.current()
            const bookId = id == null ? undefined : bookIdForNote(id)
            if (bookId != null) library.openBook(bookId)
          },
        },
      ],

      views: {
        [SHELF_VIEW]: {
          title: 'Bookshelf',
          icon: 'books.vertical',
          render: () => createElement(Suspense, { fallback: null }, createElement(Bookshelf, { library, pickFiles })),
        },
      },

      tiles: { [READER_VIEW]: readerTileView(ctx, host) },

      folderAction: (folder) =>
        folder.name.trim().toLowerCase() === (ctx.setting<string>('folder').trim() || 'Books').toLowerCase()
          ? { label: 'Open Bookshelf', icon: 'books.vertical', run: openShelf }
          : null,

      noteBadge: (noteId) => {
        if (!ctx.setting<boolean>('badges')) return null
        const bookId = bookIdForNote(noteId)
        const book = bookId == null ? undefined : useBooksStore.getState().books[bookId]
        return book ? badgeFor(book, () => library.openBook(book.id)) : null
      },

      dispose: () => {
        for (const stop of cleanups.splice(0)) stop()
        library.dispose()
        input?.remove()
        input = null
        resetBooksStore()
      },
    }
  },
}

export default plugin
