/**
 * The Books reader tile body: bar, contents drawer, appearance popover, progress track, quote bar and the
 * format engine (lazy). Loaded lazily by ReaderTile.tsx.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Icon } from '../../components/Icon'
import { ToolbarButton } from '../../components/ui/ToolbarButton'
import { useLayoutStore } from '../../store/layoutStore'
import type { PluginContext } from '../types'
import { loadAppearance, saveAppearance } from './appearance'
import { currentTocIndex, progressLabel } from './labels'
import { createPositionSync, pickStartPosition, posKey, type PositionSync, type StoredPosition } from './position'
import { quoteMarkdown } from './quote'
import { AppearancePopover, ContentsDrawer, ProgressTrack, SelectionBar } from './ReaderParts'
import type {
  ReaderAppearance,
  ReaderHandle,
  ReaderLocation,
  ReaderReadyInfo,
  ReaderSelection,
  TocItem,
} from './reader/types'
import { useReaderColors } from './useReaderColors'
import type { Book, ReaderHost } from './types'
import styles from './ReaderTile.module.css'

const EpubView = lazy(() => import('./reader/epub/EpubView'))
const PdfView = lazy(() => import('./reader/pdf/PdfView'))

interface Props {
  noteId: number
  ctx: PluginContext
  host: ReaderHost
}

export default function ReaderView({ noteId, ctx, host }: Props) {
  const book = host.useBookForNote(noteId)
  if (book === undefined) {
    return (
      <div className={styles.root}>
        <Loading label="Opening…" />
      </div>
    )
  }
  if (book === null) {
    return (
      <div className={styles.root}>
        <div className={styles.centered}>
          <Icon name="book" size={30} className={styles.centeredIcon} />
          <p className={styles.centeredTitle}>This note isn’t linked to a book</p>
        </div>
      </div>
    )
  }
  return <BookReader key={book.id} book={book} noteId={noteId} ctx={ctx} host={host} />
}

function Loading({ label }: { label: string }) {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('button, input, select, textarea, a, [role="slider"], [role="dialog"], aside, [contenteditable="true"]')

function BookReader({ book, noteId, ctx, host }: Props & { book: Book }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ReaderHandle>(null)
  const contentsButton = useRef<HTMLButtonElement>(null)
  const appearanceButton = useRef<HTMLButtonElement>(null)
  const bookRef = useRef(book)
  bookRef.current = book

  const [appearance, setAppearance] = useState<ReaderAppearance>(() => loadAppearance(ctx.storage))
  const colors = useReaderColors(appearance.theme)

  const [startAt] = useState(() => pickStartPosition(book, ctx.storage.get<StoredPosition>(posKey(book.id))))
  const [openAt, setOpenAt] = useState<string | null>(startAt)
  const resumeRef = useRef<string | null>(startAt)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const [selection, setSelection] = useState<{ value: ReaderSelection; bounds: DOMRect } | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [popover, setPopover] = useState(false)
  const openedRef = useRef(false)
  const lastPositionRef = useRef<string | null>(null)
  const locationRef = useRef<ReaderLocation | null>(null)

  // Local-first position sync: created per mount (StrictMode-safe), flushed with keepalive on unmount / pagehide.
  const syncRef = useRef<PositionSync | null>(null)
  useEffect(() => {
    const sync = createPositionSync({
      bookId: book.id,
      host,
      storage: ctx.storage,
      finished: bookRef.current.status === 'finished',
      startPosition: startAt,
    })
    syncRef.current = sync
    return () => {
      sync.dispose()
      if (syncRef.current === sync) syncRef.current = null
    }
  }, [book.id, host, ctx, startAt])

  const onReady = useCallback(
    (info: ReaderReadyInfo) => {
      setToc(info.toc)
      setReady(true)
      if (!openedRef.current) {
        openedRef.current = true
        host.markOpened(book.id)
        // Take the keyboard when this tile is the focused one (not when a restored layout opens several readers).
        const tileId = rootRef.current?.closest<HTMLElement>('[data-tile-id]')?.dataset.tileId
        if (!tileId || useLayoutStore.getState().focusedId === tileId) handleRef.current?.focus()
      }
    },
    [host, book.id],
  )

  const onLocation = useCallback((loc: ReaderLocation) => {
    locationRef.current = loc
    setLocation(loc)
    resumeRef.current = loc.position
    // A repeated CFI (better progress) is not a page turn; a new position clears the quote bar.
    if (lastPositionRef.current !== null && lastPositionRef.current !== loc.position) setSelection(null)
    lastPositionRef.current = loc.position
    syncRef.current?.update({ position: loc.position, progress: loc.progress })
  }, [])

  const onSelection = useCallback((sel: ReaderSelection | null) => {
    if (!sel || !sel.text.trim()) {
      setSelection(null)
      return
    }
    const bounds = rootRef.current?.getBoundingClientRect()
    if (bounds) setSelection({ value: sel, bounds })
  }, [])

  const onError = useCallback((err: Error) => {
    console.error('[books] reader error', err)
    setError(err.message || 'The file could not be read.')
    setReady(false)
    setSelection(null)
  }, [])

  const retry = () => {
    setError(null)
    setReady(false)
    setToc([])
    setLocation(null)
    lastPositionRef.current = null
    setOpenAt(resumeRef.current)
    setAttempt((n) => n + 1)
  }

  const changeAppearance = (patch: Partial<ReaderAppearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch }
      saveAppearance(ctx.storage, next)
      return next
    })
    setSelection(null)
  }

  const closeDrawer = useCallback(() => {
    setDrawer(false)
    contentsButton.current?.focus({ preventScroll: true })
  }, [])
  const closePopover = useCallback(() => setPopover(false), [])

  const quote = () => {
    if (!selection) return
    const loc = locationRef.current
    const where = selection.value.where || loc?.chapter || ''
    const markdown = quoteMarkdown({
      text: selection.value.text,
      where,
      format: book.format,
      progress: loc?.progress ?? bookRef.current.progress,
    })
    setSelection(null)
    ctx.notes
      .append(noteId, markdown)
      .then(() => ctx.flash(`Quoted in “${ctx.notes.title(noteId) || book.title}”`))
      .catch((err) => console.error('[books] could not quote into the note', err))
  }

  const copy = () => {
    if (!selection) return
    const text = selection.value.text
    setSelection(null)
    navigator.clipboard
      .writeText(text)
      .then(() => ctx.flash('Copied'))
      .catch((err) => console.error('[books] could not copy', err))
  }

  const pageBy = (dir: 'next' | 'prev') => {
    setSelection(null)
    handleRef.current?.[dir]()
    handleRef.current?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (drawer) {
        e.preventDefault()
        closeDrawer()
      } else if (selection) {
        setSelection(null)
      }
      return
    }
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
    const handle = handleRef.current
    if (!handle || !ready || drawer) return
    let handled = true
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        handle.next()
        break
      case 'ArrowLeft':
      case 'PageUp':
        handle.prev()
        break
      case ' ':
        if (e.shiftKey) handle.prev()
        else handle.next()
        break
      case 'Home':
        handle.goToProgress(0)
        break
      case 'End':
        handle.goToProgress(1)
        break
      default:
        handled = false
    }
    if (handled) {
      e.preventDefault()
      setSelection(null)
    }
  }

  const label = location?.chapter || book.title
  const progressText = progressLabel(book.format, location)
  const progress = location?.progress ?? book.progress
  const Engine = book.format === 'epub' ? EpubView : PdfView
  const stageStyle = {
    '--reader-bg': colors.background,
    '--reader-fg': colors.text,
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={styles.root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDownCapture={(e) => {
        // Clicks in our chrome never reach the engine, so they have to clear the quote bar themselves.
        if (selection && !(e.target as HTMLElement).closest(`.${styles.selectionBar}`)) setSelection(null)
      }}
    >
      <div className={styles.bar}>
        <ToolbarButton
          ref={contentsButton}
          size="small"
          icon="list.bullet"
          label="Contents"
          active={drawer}
          disabled={!ready}
          onClick={() => {
            setPopover(false)
            if (drawer) closeDrawer()
            else setDrawer(true)
          }}
        />
        <span className={styles.label} title={label}>
          {label}
        </span>
        <span className={styles.spacer} />
        <ToolbarButton
          size="small"
          icon="chevron.left"
          label={book.format === 'pdf' ? 'Previous Page' : 'Previous'}
          disabled={!ready || !location || location.atStart}
          onClick={() => pageBy('prev')}
        />
        <ToolbarButton
          size="small"
          icon="chevron.right"
          label={book.format === 'pdf' ? 'Next Page' : 'Next'}
          disabled={!ready || !location || location.atEnd}
          onClick={() => pageBy('next')}
        />
        <span className={styles.progressLabel} aria-live="polite">
          {progressText}
        </span>
        <ToolbarButton
          ref={appearanceButton}
          size="small"
          icon="textformat.size"
          label="Appearance"
          active={popover}
          aria-haspopup="dialog"
          aria-expanded={popover}
          onClick={() => {
            setDrawer(false)
            setPopover((v) => !v)
          }}
        />
        <ToolbarButton
          size="small"
          icon="square.and.pencil"
          label="Open Notes"
          onClick={() => ctx.notes.open(noteId, { split: true })}
        />
      </div>

      <div className={styles.stage} style={stageStyle}>
        <div className={styles.surface}>
          {error === null && (
            <Suspense fallback={null}>
              <Engine
                key={`${book.id}:${attempt}`}
                ref={handleRef}
                url={host.fileUrl(book)}
                initialPosition={openAt}
                appearance={appearance}
                colors={colors}
                onReady={onReady}
                onLocation={onLocation}
                onSelection={onSelection}
                onError={onError}
              />
            </Suspense>
          )}
          {error === null && !ready && <Loading label={`Opening ${book.title}…`} />}
          {error !== null && (
            <div className={styles.centered}>
              <Icon name="exclamationmark.triangle" size={30} className={styles.errorIcon} />
              <p className={styles.centeredTitle}>This book couldn’t be opened</p>
              <p className={styles.centeredDetail}>{error}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} onClick={retry}>
                  Try Again
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => host.downloadOriginal(book)}>
                  Download Original
                </button>
              </div>
            </div>
          )}
          {drawer && (
            <ContentsDrawer
              toc={toc}
              current={currentTocIndex(toc, book.format, location)}
              onClose={closeDrawer}
              onPick={(item) => {
                setSelection(null)
                handleRef.current?.goTo(item.target)
                setDrawer(false)
                handleRef.current?.focus()
              }}
            />
          )}
        </div>
        <ProgressTrack
          progress={progress}
          label={progressText}
          onSeek={(p) => {
            setSelection(null)
            handleRef.current?.goToProgress(p)
          }}
        />
      </div>

      {popover && (
        <AppearancePopover
          format={book.format}
          appearance={appearance}
          onChange={changeAppearance}
          onClose={closePopover}
          anchorRef={appearanceButton}
        />
      )}
      {selection && <SelectionBar selection={selection.value} bounds={selection.bounds} onQuote={quote} onCopy={copy} />}
    </div>
  )
}
