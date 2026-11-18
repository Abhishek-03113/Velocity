import { create } from 'zustand'
import { useEditorStore } from '../../store/editorStore'
import { cachedContent } from '../../store/searchStore'
import { bookIdOf } from './note'
import { parseServerTime, type Book, type ProgressPatch } from './types'

export type SortKey = 'recent' | 'title' | 'author' | 'added' | 'progress'
export type FilterKey = 'all' | 'reading' | 'unread' | 'finished'
export type FormatKey = 'all' | 'epub' | 'pdf'

export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recently opened',
  title: 'Title',
  author: 'Author',
  added: 'Date added',
  progress: 'Progress',
}
export const FILTER_LABELS: Record<FilterKey, string> = { all: 'All', reading: 'Reading', unread: 'Unread', finished: 'Finished' }
export const FORMAT_LABELS: Record<FormatKey, string> = { all: 'All formats', epub: 'EPUB', pdf: 'PDF' }

export interface UploadItem {
  key: string
  name: string
  /** 0..1 */
  progress: number
  status: 'uploading' | 'processing' | 'error'
  error?: string
  file: File
}

interface BooksState {
  books: Record<number, Book>
  /** The first list request has finished (successfully). */
  loaded: boolean
  loading: boolean
  loadError: string | null
  /** Book ids the server said do not exist (a note whose book was removed elsewhere). */
  missing: Record<number, true>
  uploads: UploadItem[]
  sort: SortKey
  filter: FilterKey
  format: FormatKey
  /** Book the shelf should scroll to and focus (set after a duplicate upload). */
  focusBookId: number | null
  /** bookId → note id, kept in step with the notes by `scanNotes`. */
  noteIdByBook: Record<number, number>

  setBooks: (list: Book[]) => void
  upsertBook: (book: Book) => void
  patchLocal: (id: number, patch: Partial<Book>) => void
  removeBook: (id: number) => void
  setLoading: (loading: boolean, error?: string | null) => void
  markMissing: (id: number) => void
  addUpload: (item: UploadItem) => void
  patchUpload: (key: string, patch: Partial<UploadItem>) => void
  removeUpload: (key: string) => void
  setShelfPrefs: (prefs: Partial<Pick<BooksState, 'sort' | 'filter' | 'format'>>) => void
  setFocusBook: (id: number | null) => void
  applyProgress: (id: number, patch: ProgressPatch) => void
}

export const useBooksStore = create<BooksState>((set) => ({
  books: {},
  loaded: false,
  loading: false,
  loadError: null,
  missing: {},
  uploads: [],
  sort: 'recent',
  filter: 'all',
  format: 'all',
  focusBookId: null,
  noteIdByBook: {},

  setBooks: (list) =>
    set((s) => {
      const books: Record<number, Book> = {}
      for (const b of list) books[b.id] = b
      // A book uploaded while the list was in flight stays.
      for (const b of Object.values(s.books)) books[b.id] ??= b
      return { books, loaded: true, loading: false, loadError: null }
    }),
  upsertBook: (book) => set((s) => ({ books: { ...s.books, [book.id]: book }, missing: omit(s.missing, book.id) })),
  patchLocal: (id, patch) =>
    set((s) => (s.books[id] ? { books: { ...s.books, [id]: { ...s.books[id]!, ...patch } } } : s)),
  removeBook: (id) =>
    set((s) => {
      const books = { ...s.books }
      delete books[id]
      return { books, noteIdByBook: omit(s.noteIdByBook, id) }
    }),
  setLoading: (loading, error = null) => set({ loading, loadError: error }),
  markMissing: (id) => set((s) => ({ missing: { ...s.missing, [id]: true } })),
  addUpload: (item) => set((s) => ({ uploads: [...s.uploads, item] })),
  patchUpload: (key, patch) => set((s) => ({ uploads: s.uploads.map((u) => (u.key === key ? { ...u, ...patch } : u)) })),
  removeUpload: (key) => set((s) => ({ uploads: s.uploads.filter((u) => u.key !== key) })),
  setShelfPrefs: (prefs) => set(prefs),
  setFocusBook: (id) => set({ focusBookId: id }),
  applyProgress: (id, patch) =>
    set((s) => (s.books[id] ? { books: { ...s.books, [id]: { ...s.books[id]!, ...patch } } } : s)),
}))

function omit<T extends Record<number, unknown>>(record: T, id: number): T {
  if (!(id in record)) return record
  const next = { ...record }
  delete next[id]
  return next
}

// ── Shelf selection (pure) ────────────────────────────────────────────────────

export interface ShelfOptions {
  sort: SortKey
  filter: FilterKey
  format: FormatKey
  query: string
}

/** Lower-case, diacritics stripped, whitespace collapsed. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function byRecent(a: Book, b: Book): number {
  return (
    parseServerTime(b.last_opened_at) - parseServerTime(a.last_opened_at) ||
    parseServerTime(b.created_at) - parseServerTime(a.created_at) ||
    b.id - a.id
  )
}

/** Filter, search and sort the library for the shelf. Does not mutate `books`. */
export function selectShelf(books: Record<number, Book> | readonly Book[], opts: ShelfOptions): Book[] {
  const list = Array.isArray(books) ? [...(books as readonly Book[])] : Object.values(books as Record<number, Book>)
  const query = foldText(opts.query)
  const matched = list.filter((b) => {
    if (opts.filter !== 'all' && b.status !== opts.filter) return false
    if (opts.format !== 'all' && b.format !== opts.format) return false
    if (query && !foldText(`${b.title} ${b.author ?? ''}`).includes(query)) return false
    return true
  })
  switch (opts.sort) {
    case 'title':
      return matched.sort((a, b) => collator.compare(a.title, b.title) || byRecent(a, b))
    case 'author':
      return matched.sort((a, b) => {
        // Books without an author go last.
        if (!a.author !== !b.author) return a.author ? -1 : 1
        return collator.compare(a.author ?? '', b.author ?? '') || collator.compare(a.title, b.title)
      })
    case 'added':
      return matched.sort((a, b) => parseServerTime(b.created_at) - parseServerTime(a.created_at) || b.id - a.id)
    case 'progress':
      return matched.sort((a, b) => b.progress - a.progress || byRecent(a, b))
    default:
      return matched.sort(byRecent)
  }
}

// ── Notes ↔ books ─────────────────────────────────────────────────────────────

/** Rebuild the book → note map from the notes (content may be unloaded: the search cache stands in). */
export function scanNotes(): void {
  const next: Record<number, number> = {}
  for (const paste of useEditorStore.getState().pastes) {
    const bookId = bookIdOf(paste.content ?? cachedContent(paste.id))
    if (bookId == null) continue
    const existing = next[bookId]
    if (existing == null || paste.id > existing) next[bookId] = paste.id
  }
  const current = useBooksStore.getState().noteIdByBook
  const keys = Object.keys(next)
  if (keys.length === Object.keys(current).length && keys.every((k) => current[Number(k)] === next[Number(k)])) return
  useBooksStore.setState({ noteIdByBook: next })
}

// ── Shelf preferences persisted per browser ───────────────────────────────────

const SORTS = Object.keys(SORT_LABELS) as SortKey[]
const FILTERS = Object.keys(FILTER_LABELS) as FilterKey[]
const FORMATS = Object.keys(FORMAT_LABELS) as FormatKey[]

interface Storage {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

/** Restore sort / filter / format from plugin storage and keep it written. Returns an unsubscribe. */
export function bindShelfPrefs(storage: Storage): () => void {
  const saved = storage.get<Partial<Record<'sort' | 'filter' | 'format', string>>>('shelf')
  if (saved) {
    useBooksStore.setState({
      sort: SORTS.find((v) => v === saved.sort) ?? 'recent',
      filter: FILTERS.find((v) => v === saved.filter) ?? 'all',
      format: FORMATS.find((v) => v === saved.format) ?? 'all',
    })
  }
  return useBooksStore.subscribe((s, prev) => {
    if (s.sort !== prev.sort || s.filter !== prev.filter || s.format !== prev.format) {
      storage.set('shelf', { sort: s.sort, filter: s.filter, format: s.format })
    }
  })
}

export function resetBooksStore(): void {
  useBooksStore.setState({
    books: {},
    loaded: false,
    loading: false,
    loadError: null,
    missing: {},
    uploads: [],
    focusBookId: null,
    noteIdByBook: {},
  })
}
