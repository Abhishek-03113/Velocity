import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Icon } from '../../components/Icon'
import { ContextMenu, type MenuItem, type MenuState } from '../../components/ui/ContextMenu'
import { BookCover } from './BookCover'
import styles from './Bookshelf.module.css'
import type { BooksLibrary } from './metadata'
import {
  FILTER_LABELS,
  FORMAT_LABELS,
  selectShelf,
  SORT_LABELS,
  useBooksStore,
  type FilterKey,
  type FormatKey,
  type SortKey,
  type UploadItem,
} from './store'
import type { Book } from './types'

interface Props {
  library: BooksLibrary
  /** Opens the file picker (and the shelf stays where it is). */
  pickFiles: () => void
}

const hasFiles = (e: { dataTransfer: DataTransfer | null }) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export default function Bookshelf({ library, pickFiles }: Props) {
  const books = useBooksStore((s) => s.books)
  const uploads = useBooksStore((s) => s.uploads)
  const loaded = useBooksStore((s) => s.loaded)
  const loadError = useBooksStore((s) => s.loadError)
  const sort = useBooksStore((s) => s.sort)
  const filter = useBooksStore((s) => s.filter)
  const format = useBooksStore((s) => s.format)
  const focusBookId = useBooksStore((s) => s.focusBookId)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragging, setDragging] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)

  const total = Object.keys(books).length
  const visible = useMemo(() => selectShelf(books, { sort, filter, format, query }), [books, sort, filter, format, query])
  const filtered = query.trim() !== '' || filter !== 'all' || format !== 'all'

  useEffect(() => {
    const s = useBooksStore.getState()
    if (!s.loaded && !s.loading) void library.loadBooks()
  }, [library])

  // Files dropped anywhere in the workspace while the shelf is open.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (e.defaultPrevented || !hasFiles(e)) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) library.add(files)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [library])

  // Bring a book into view (after a duplicate upload).
  useEffect(() => {
    if (focusBookId == null) return
    if (!visible.some((b) => b.id === focusBookId)) {
      if (!books[focusBookId]) return useBooksStore.getState().setFocusBook(null)
      setQuery('')
      useBooksStore.getState().setShelfPrefs({ filter: 'all', format: 'all' })
      return
    }
    const card = gridRef.current?.querySelector<HTMLElement>(`[data-book-id="${focusBookId}"]`)
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    card?.focus({ preventScroll: true })
    setActiveId(focusBookId)
    setFlashId(focusBookId)
    useBooksStore.getState().setFocusBook(null)
    const t = window.setTimeout(() => setFlashId(null), 1600)
    return () => window.clearTimeout(t)
  }, [focusBookId, visible, books])

  const openMenu = useCallback((x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }), [])
  const below = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.bottom + 4 }
  }

  const sortMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const { x, y } = below(e.currentTarget)
    openMenu(
      x,
      y,
      (Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({
        label: SORT_LABELS[key],
        checked: sort === key,
        onSelect: () => useBooksStore.getState().setShelfPrefs({ sort: key }),
      })),
    )
  }

  const filterMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const { x, y } = below(e.currentTarget)
    openMenu(x, y, [
      ...(Object.keys(FILTER_LABELS) as FilterKey[]).map((key): MenuItem => ({
        label: FILTER_LABELS[key],
        checked: filter === key,
        onSelect: () => useBooksStore.getState().setShelfPrefs({ filter: key }),
      })),
      { separator: true },
      ...(Object.keys(FORMAT_LABELS) as FormatKey[]).map((key): MenuItem => ({
        label: FORMAT_LABELS[key],
        checked: format === key,
        onSelect: () => useBooksStore.getState().setShelfPrefs({ format: key }),
      })),
    ])
  }

  const bookMenu = (book: Book, x: number, y: number) => {
    const items: MenuItem[] = [
      { label: 'Open', icon: 'book', onSelect: () => library.openBook(book.id) },
      { label: 'Open Notes', icon: 'square.and.pencil', onSelect: () => library.openNotes(book.id) },
      { separator: true },
    ]
    if (book.status !== 'unread') items.push({ label: 'Mark as Unread', onSelect: () => library.markUnread(book) })
    if (book.status !== 'finished') items.push({ label: 'Mark as Finished', icon: 'checkmark.circle', onSelect: () => library.markFinished(book) })
    items.push(
      { label: 'Rename…', icon: 'pencil', onSelect: () => library.rename(book) },
      { label: 'Download Original', icon: 'square.and.arrow.down', onSelect: () => library.download(book) },
      { separator: true },
      { label: 'Remove from Library…', icon: 'trash', destructive: true, onSelect: () => library.remove(book) },
    )
    openMenu(x, y, items)
  }

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const id = Number(target.dataset.bookId)
    if (!target.dataset.bookId || Number.isNaN(id)) return
    const book = books[id]
    if (!book) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      library.openBook(id)
      return
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      const r = target.getBoundingClientRect()
      bookMenu(book, r.left + 24, r.top + r.height / 2)
      return
    }
    const dirs: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2, Home: -3, End: 3 }
    const dir = dirs[e.key]
    if (!dir) return
    e.preventDefault()
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-book-id]') ?? [])
    const at = cards.indexOf(target)
    if (at < 0) return
    // Resolved grid-template-columns lists one track per column.
    const columns = Math.max(1, getComputedStyle(gridRef.current!).gridTemplateColumns.split(' ').length)
    const next =
      dir === -3 ? 0 : dir === 3 ? cards.length - 1 : dir === 1 ? at + 1 : dir === -1 ? at - 1 : at + Math.sign(dir) * columns
    const card = cards[Math.min(cards.length - 1, Math.max(0, next))]
    card?.focus()
  }

  const count = total === 1 ? '1 book' : `${total} books`

  return (
    <div
      className={styles.root}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        dragDepth.current = 0
        setDragging(false)
        if (!hasFiles(e)) return
        e.preventDefault()
        const files = Array.from(e.dataTransfer.files)
        if (files.length) library.add(files)
      }}
    >
      <div className={styles.bar}>
        <span className={styles.title}>Bookshelf</span>
        {loaded && (
          <span className={styles.count}>{filtered ? `${visible.length} of ${count}` : count}</span>
        )}
        <span className={styles.spacer} />
        <button type="button" className={styles.barButton} onClick={sortMenu} aria-haspopup="menu" title={`Sort: ${SORT_LABELS[sort]}`}>
          <Icon name="arrow.up.arrow.down" size={14} />
          <span className={styles.barLabel}>Sort</span>
          <Icon name="chevron.down" size={11} />
        </button>
        <button
          type="button"
          className={`${styles.barButton} ${filter !== 'all' || format !== 'all' ? styles.barButtonOn : ''}`}
          onClick={filterMenu}
          aria-haspopup="menu"
          title="Filter"
        >
          <Icon name="line.3.horizontal.decrease" size={14} />
          <span className={styles.barLabel}>Filter</span>
          <Icon name="chevron.down" size={11} />
        </button>
        <label className={styles.search}>
          <Icon name="magnifyingglass" size={13} />
          <input
            type="search"
            value={query}
            placeholder="Search books"
            aria-label="Search books"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                e.stopPropagation()
                setQuery('')
              }
            }}
          />
        </label>
        <button type="button" className={styles.add} onClick={pickFiles}>
          <Icon name="plus" size={14} />
          <span>Add Books</span>
        </button>
      </div>

      <div className={styles.scroll}>
        {!loaded && loadError ? (
          <div className={styles.state} role="alert">
            <Icon name="wifi.slash" size={34} />
            <h2>Couldn’t reach your library</h2>
            <p>Check that the Velocity server is running, then try again.</p>
            <button type="button" className={styles.add} onClick={() => void library.loadBooks()}>
              Try Again
            </button>
          </div>
        ) : !loaded ? (
          <div className={styles.grid} aria-busy="true" aria-label="Loading books">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.card}>
                <div className={`${styles.cover} ${styles.skeleton}`} />
                <div className={`${styles.skeletonLine} ${styles.skeleton}`} />
                <div className={`${styles.skeletonLine} ${styles.skeletonShort} ${styles.skeleton}`} />
              </div>
            ))}
          </div>
        ) : total === 0 && uploads.length === 0 ? (
          <div className={styles.state}>
            <Icon name="books.vertical" size={40} />
            <h2>Your bookshelf is empty</h2>
            <p>Add EPUB or PDF files, or drop them here.</p>
            <button type="button" className={styles.add} onClick={pickFiles}>
              <Icon name="plus" size={14} />
              <span>Add Books…</span>
            </button>
          </div>
        ) : (
          <div ref={gridRef} className={styles.grid} role="list" aria-label="Books" onKeyDown={onGridKey}>
            {uploads.map((u) => (
              <UploadCard key={u.key} item={u} library={library} />
            ))}
            {visible.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                tabbable={(activeId ?? visible[0]?.id) === book.id}
                flash={flashId === book.id}
                onActive={() => setActiveId(book.id)}
                onOpen={() => library.openBook(book.id)}
                onMenu={(x, y) => bookMenu(book, x, y)}
              />
            ))}
            {visible.length === 0 && total > 0 && (
              <div className={styles.noMatch}>
                <p>No books match.</p>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    setQuery('')
                    useBooksStore.getState().setShelfPrefs({ filter: 'all', format: 'all' })
                  }}
                >
                  Clear search and filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {dragging && (
        <div className={styles.drop} aria-hidden="true">
          <Icon name="books.vertical" size={30} />
          <span>Drop to add to Books</span>
        </div>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

function BookCard({
  book,
  tabbable,
  flash,
  onActive,
  onOpen,
  onMenu,
}: {
  book: Book
  tabbable: boolean
  flash: boolean
  onActive: () => void
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}) {
  const percent = Math.min(99, Math.max(1, Math.round(book.progress * 100)))
  const label = [book.title, book.author, book.status === 'finished' ? 'Finished' : book.status === 'reading' ? `${percent}% read` : null]
    .filter(Boolean)
    .join(', ')
  return (
    <div
      role="listitem"
      tabIndex={tabbable ? 0 : -1}
      data-book-id={book.id}
      aria-label={label}
      className={`${styles.card} ${styles.bookCard} ${flash ? styles.flash : ''}`}
      onFocus={onActive}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <div className={styles.coverWrap}>
        <BookCover book={book} />
        <button
          type="button"
          tabIndex={-1}
          className={styles.more}
          aria-label={`More actions for ${book.title}`}
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(r.left, r.bottom + 4)
          }}
        >
          <Icon name="ellipsis.circle" size={18} />
        </button>
      </div>
      <div className={styles.cardTitle}>{book.title}</div>
      {book.author && <div className={styles.cardAuthor}>{book.author}</div>}
      {book.status === 'reading' && (
        <div className={styles.progress} role="progressbar" aria-label={`${percent}% read`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      {book.status === 'finished' && (
        <div className={styles.finished}>
          <Icon name="checkmark.circle" size={13} />
          <span>Finished</span>
        </div>
      )}
    </div>
  )
}

function UploadCard({ item, library }: { item: UploadItem; library: BooksLibrary }) {
  const failed = item.status === 'error'
  const text =
    item.status === 'uploading'
      ? `Uploading ${Math.round(item.progress * 100)}%`
      : item.status === 'processing'
        ? 'Reading cover…'
        : (item.error ?? 'Couldn’t add this book')
  const retryable = /\.(epub|pdf)$/i.test(item.name) || item.file.type === 'application/epub+zip' || item.file.type === 'application/pdf'
  return (
    <div className={styles.card} data-upload="" role="listitem" aria-label={`${item.name}: ${text}`}>
      <div className={`${styles.cover} ${styles.uploadCover} ${failed ? styles.uploadFailed : ''}`}>
        <Icon name={failed ? 'exclamationmark.triangle' : 'doc.text'} size={26} />
        <span className={styles.uploadName}>{item.name}</span>
        {!failed && (
          <div className={styles.uploadTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
            <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className={`${styles.uploadText} ${failed ? styles.uploadTextError : ''}`} role={failed ? 'alert' : undefined}>
        {text}
      </div>
      {failed && (
        <div className={styles.uploadActions}>
          {retryable && (
            <button type="button" className={styles.linkButton} onClick={() => library.retry(item.key)}>
              Retry
            </button>
          )}
          <button type="button" className={styles.linkButton} onClick={() => library.dismiss(item.key)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
