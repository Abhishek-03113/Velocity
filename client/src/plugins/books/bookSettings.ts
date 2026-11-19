/**
 * Per-book reader settings (appearance, layout, highlight defaults) saved on the book row (`plugin_books.settings`),
 * so a book reopens the way it was read, on any device. The browser-wide values stay as the defaults for books
 * that have none yet. Writes are local-first: the store updates at once, the server write is debounced.
 */
import { patchBook } from './api'
import { sanitizeAppearance } from './appearance'
import type { HighlightDefaults } from './reader-ui/highlightDefaults'
import { HIGHLIGHT_STYLES } from './reader-ui/highlightDefaults'
import { HIGHLIGHT_COLORS, type HighlightColor, type HighlightStyle, type ReaderAppearance } from './reader/types'
import { useBooksStore } from './store'
import type { Book } from './types'

export interface BookSettings {
  appearance?: ReaderAppearance
  highlight?: HighlightDefaults
}

const SAVE_DELAY_MS = 600

/** The book's saved settings, validated; empty when it has none or they are unreadable. */
export function readBookSettings(book: Pick<Book, 'settings'>): BookSettings {
  if (!book.settings) return {}
  try {
    const raw = JSON.parse(book.settings) as Record<string, unknown>
    const out: BookSettings = {}
    if (raw.appearance && typeof raw.appearance === 'object') out.appearance = sanitizeAppearance(raw.appearance)
    const h = raw.highlight as Partial<HighlightDefaults> | undefined
    if (h && HIGHLIGHT_STYLES.includes(h.style as HighlightStyle) && HIGHLIGHT_COLORS.includes(h.color as HighlightColor)) {
      out.highlight = { style: h.style as HighlightStyle, color: h.color as HighlightColor }
    }
    return out
  } catch {
    return {}
  }
}

const timers = new Map<number, ReturnType<typeof setTimeout>>()

/** Merge `patch` into the book's settings: in the store now, on the server shortly after. */
export function saveBookSettings(bookId: number, patch: BookSettings): void {
  const store = useBooksStore.getState()
  const book = store.books[bookId]
  if (!book) return
  const settings = JSON.stringify({ ...readBookSettings(book), ...patch })
  if (settings === book.settings) return
  store.patchLocal(bookId, { settings })
  const pending = timers.get(bookId)
  if (pending) clearTimeout(pending)
  timers.set(
    bookId,
    setTimeout(() => {
      timers.delete(bookId)
      const latest = useBooksStore.getState().books[bookId]?.settings
      if (latest == null) return
      patchBook(bookId, { settings: latest }).catch((err) => console.error('[books] could not save book settings', err))
    }, SAVE_DELAY_MS),
  )
}

/** Send pending writes now (the reader is closing or the page is going away). */
export function flushBookSettings(bookId: number): void {
  const pending = timers.get(bookId)
  if (!pending) return
  clearTimeout(pending)
  timers.delete(bookId)
  const latest = useBooksStore.getState().books[bookId]?.settings
  if (latest == null) return
  patchBook(bookId, { settings: latest }, { keepalive: true }).catch((err) => console.error('[books] could not save book settings', err))
}
