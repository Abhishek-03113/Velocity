import { beforeEach, describe, expect, it } from 'vitest'
import { bindShelfPrefs, foldText, resetBooksStore, selectShelf, useBooksStore } from './store'
import type { Book } from './types'

function book(id: number, over: Partial<Book> = {}): Book {
  return {
    id,
    format: 'epub',
    title: `Book ${id}`,
    author: null,
    file_name: `b${id}.epub`,
    byte_size: 1,
    sha256: String(id),
    cover_url: null,
    position: null,
    progress: 0,
    status: 'unread',
    page_count: null,
    last_opened_at: null,
    created_at: '2026-11-01 10:00:00',
    updated_at: '2026-11-01 10:00:00',
    file_url: `/api/plugins/books/${id}/file`,
    ...over,
  }
}

const base = { sort: 'recent', filter: 'all', format: 'all', query: '' } as const
const ids = (list: Book[]) => list.map((b) => b.id)

const library = [
  book(1, { title: 'Zen and the Art', author: 'Pirsig', created_at: '2026-11-01 10:00:00', last_opened_at: '2026-11-10 09:00:00', progress: 0.4, status: 'reading' }),
  book(2, { title: 'Émile', author: 'Rousseau', format: 'pdf', created_at: '2026-11-05 10:00:00', last_opened_at: '2026-11-12 09:00:00', progress: 1, status: 'finished' }),
  book(3, { title: 'Alpha', author: null, created_at: '2026-11-09 10:00:00' }),
  book(4, { title: 'beta', author: 'Adams', created_at: '2026-11-09 10:00:00', progress: 0.7, status: 'reading', format: 'pdf' }),
]

describe('selectShelf', () => {
  it('sorts recently opened first, then newest added', () => {
    expect(ids(selectShelf(library, base))).toEqual([2, 1, 4, 3])
  })

  it('sorts by title ignoring case and accents, author with blanks last, added, progress', () => {
    expect(ids(selectShelf(library, { ...base, sort: 'title' }))).toEqual([3, 4, 2, 1])
    expect(ids(selectShelf(library, { ...base, sort: 'author' }))).toEqual([4, 1, 2, 3])
    expect(ids(selectShelf(library, { ...base, sort: 'added' }))).toEqual([4, 3, 2, 1])
    expect(ids(selectShelf(library, { ...base, sort: 'progress' }))).toEqual([2, 4, 1, 3])
  })

  it('filters by status and format', () => {
    expect(ids(selectShelf(library, { ...base, filter: 'reading' }))).toEqual([1, 4])
    expect(ids(selectShelf(library, { ...base, filter: 'unread' }))).toEqual([3])
    expect(ids(selectShelf(library, { ...base, filter: 'finished' }))).toEqual([2])
    expect(ids(selectShelf(library, { ...base, format: 'pdf' }))).toEqual([2, 4])
    expect(ids(selectShelf(library, { ...base, format: 'pdf', filter: 'reading' }))).toEqual([4])
  })

  it('searches title and author, case and diacritic insensitive', () => {
    expect(ids(selectShelf(library, { ...base, query: 'emile' }))).toEqual([2])
    expect(ids(selectShelf(library, { ...base, query: 'ADAMS' }))).toEqual([4])
    expect(ids(selectShelf(library, { ...base, query: '  art  ' }))).toEqual([1])
    expect(selectShelf(library, { ...base, query: 'nothing here' })).toEqual([])
  })

  it('accepts the store record and does not mutate it', () => {
    const record = Object.fromEntries(library.map((b) => [b.id, b]))
    const before = Object.keys(record).join()
    expect(selectShelf(record, base)).toHaveLength(4)
    expect(Object.keys(record).join()).toBe(before)
    expect(ids(library)).toEqual([1, 2, 3, 4])
  })
})

describe('foldText', () => {
  it('folds case, accents and spacing', () => {
    expect(foldText('  Crème   BRÛLÉE ')).toBe('creme brulee')
  })
})

describe('shelf preferences', () => {
  beforeEach(() => resetBooksStore())

  it('restores and persists sort, filter and format (not the search text)', () => {
    const bag: Record<string, unknown> = { shelf: { sort: 'title', filter: 'reading', format: 'bogus' } }
    const storage = { get: <T,>(k: string) => bag[k] as T | undefined, set: (k: string, v: unknown) => void (bag[k] = v) }
    const stop = bindShelfPrefs(storage)
    expect(useBooksStore.getState()).toMatchObject({ sort: 'title', filter: 'reading', format: 'all' })
    useBooksStore.getState().setShelfPrefs({ format: 'pdf' })
    expect(bag.shelf).toEqual({ sort: 'title', filter: 'reading', format: 'pdf' })
    stop()
    useBooksStore.getState().setShelfPrefs({ sort: 'recent' })
    expect((bag.shelf as { sort: string }).sort).toBe('title')
  })
})

describe('books store', () => {
  beforeEach(() => resetBooksStore())

  it('keeps books uploaded while the list was loading', () => {
    useBooksStore.getState().upsertBook(book(9))
    useBooksStore.getState().setBooks([book(1)])
    expect(Object.keys(useBooksStore.getState().books).sort()).toEqual(['1', '9'])
    expect(useBooksStore.getState().loaded).toBe(true)
  })

  it('applies reading progress locally', () => {
    useBooksStore.getState().setBooks([book(1)])
    useBooksStore.getState().applyProgress(1, { position: 'page:3', progress: 0.3, status: 'reading' })
    expect(useBooksStore.getState().books[1]).toMatchObject({ position: 'page:3', progress: 0.3, status: 'reading' })
  })
})
