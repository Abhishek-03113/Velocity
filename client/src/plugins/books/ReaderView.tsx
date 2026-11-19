/**
 * The Books reader tile body (shell v2): immersive chrome, Visual Options, selection toolbar, bookmarks, the
 * annotations drawer and the format engine (lazy). Loaded lazily by ReaderTile.tsx. The pieces live in reader-ui/.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Icon } from '../../components/Icon'
import { ContextMenu, type MenuState } from '../../components/ui/ContextMenu'
import { useLayoutStore } from '../../store/layoutStore'
import { useUiStore } from '../../store/uiStore'
import type { PluginContext } from '../types'
import { loadAppearance, saveAppearance } from './appearance'
import { currentTocIndex, progressLabel, statusParts } from './labels'
import {
  createPositionSync,
  createRestoreGuard,
  getSessionPosition,
  pickStart,
  posKey,
  type PositionSync,
  type RestoreGuard,
  type StoredPosition,
} from './position'
import { quoteMarkdown } from './quote'
import { bookmarksHere } from './reader-ui/bookmarks'
import { StatusLine, TopBar } from './reader-ui/Chrome'
import { Drawer, type DrawerTab } from './reader-ui/Drawer'
import { loadHighlightDefaults, saveHighlightDefaults, type HighlightDefaults } from './reader-ui/highlightDefaults'
import { NoteSheet } from './reader-ui/NoteSheet'
import type { Box } from './reader-ui/placement'
import { SelectionToolbar } from './reader-ui/SelectionToolbar'
import { useChrome } from './reader-ui/useChrome'
import { VisualOptions } from './reader-ui/VisualOptions'
import {
  DEFAULT_APPEARANCE,
  type HighlightColor,
  type HighlightStyle,
  type ReaderAnnotation,
  type ReaderAppearance,
  type ReaderHandle,
  type ReaderLocation,
  type ReaderReadyInfo,
  type ReaderSelection,
  type TocItem,
} from './reader/types'
import { useReaderColors } from './useReaderColors'
import { clearBookAnnotations } from './annotations'
import { usePendingGoTo } from './store'
import type { Book, BookAnnotation, ReaderHost } from './types'
import styles from './ReaderTile.module.css'

const EpubView = lazy(() => import('./reader/epub/EpubView'))
const PdfView = lazy(() => import('./reader/pdf/PdfView'))

interface Props {
  noteId: number
  ctx: PluginContext
  host: ReaderHost
}

const NO_ANNOTATIONS: BookAnnotation[] = []
/** Stand-in for hosts without annotation support (the core integrates it separately). */
const useNoAnnotations = (_bookId: number) => NO_ANNOTATIONS

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

/** Keys that turn pages: they do not bring the chrome back. */
const PAGING_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', ' ', 'Home', 'End'])

/** The toolbar is for a fresh selection (`locator` null) or for a highlight (its locator). */
interface ToolbarState {
  rect: Box
  bounds: DOMRect
  selection: ReaderSelection | null
  locator: string | null
}

function BookReader({ book, noteId, ctx, host }: Props & { book: Book }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ReaderHandle>(null)
  const contentsButton = useRef<HTMLButtonElement>(null)
  const optionsButton = useRef<HTMLButtonElement>(null)
  const notesButton = useRef<HTMLButtonElement>(null)
  const bookRef = useRef(book)
  bookRef.current = book

  const [appearance, setAppearance] = useState<ReaderAppearance>(() => loadAppearance(ctx.storage))
  const colors = useReaderColors(appearance.theme)
  const paged = appearance.layout === 'paginated'

  // Where to open: this session's position, this browser's, or the server's, newest wins (spec §6).
  const [start] = useState(() => pickStart(book, ctx.storage.get<StoredPosition>(posKey(book.id)), getSessionPosition(book.id)))
  const startAt = start?.position ?? null
  const [openAt, setOpenAt] = useState<string | null>(startAt)
  const resumeRef = useRef<string | null>(startAt)
  const guardRef = useRef<RestoreGuard | null>(null)
  if (!guardRef.current) guardRef.current = createRestoreGuard(start)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('contents')
  const [options, setOptions] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [toolbar, setToolbarState] = useState<ToolbarState | null>(null)
  const [noteSheet, setNoteSheet] = useState<{ locator: string; quote: string | null; color: HighlightColor | null; initial: string } | null>(null)
  const toolbarRef = useRef<ToolbarState | null>(null)
  const setToolbar = useCallback((next: ToolbarState | null) => {
    toolbarRef.current = next
    setToolbarState(next)
  }, [])
  const defaultsRef = useRef<HighlightDefaults>(loadHighlightDefaults(ctx.storage))
  const [defaults, setDefaultsState] = useState(defaultsRef.current)
  const openedRef = useRef(false)
  const lastPositionRef = useRef<string | null>(null)
  const locationRef = useRef<ReaderLocation | null>(null)

  // Annotations (v2 host): highlights drawn by the engine, bookmarks marked on the page and listed in the drawer.
  const useAnnotations = host.useAnnotations ?? useNoAnnotations
  const annotations = useAnnotations(book.id)
  const highlights = useMemo(() => annotations.filter((a) => a.kind === 'highlight'), [annotations])
  const bookmarks = useMemo(() => annotations.filter((a) => a.kind === 'bookmark'), [annotations])
  const highlightsRef = useRef(highlights)
  highlightsRef.current = highlights
  const canEdit = typeof host.addAnnotation === 'function'

  const engineKey = highlights.map((a) => `${a.id}|${a.locator}|${a.color}|${a.style}|${a.note ? 1 : 0}`).join('\n')
  // Stable identity while nothing the engine draws changed, so it never re-diffs for unrelated store updates.
  const engineAnnotations = useMemo<ReaderAnnotation[]>(
    () =>
      highlights.map((a) => ({
        id: String(a.id),
        locator: a.locator,
        color: a.color ?? 'yellow',
        style: a.style ?? 'highlight',
        hasNote: !!a.note,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engineKey],
  )

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

  // A velocity://book link (highlights note, Read mode) asked for a place: it beats the saved position.
  const pending = usePendingGoTo(book.id)
  const pendingLocator = pending.locator
  const hasLocation = location !== null
  const consumePending = pending.consume
  useEffect(() => {
    // Wait for the engine's first location: it is still restoring the saved place before that, and would undo the jump.
    if (!pendingLocator || !ready || error !== null || !hasLocation) return
    guardRef.current?.release()
    handleRef.current?.goTo(pendingLocator)
    consumePending()
  }, [pendingLocator, ready, error, hasLocation, consumePending])

  const chrome = useChrome({ autoHide: paged, ready, hold: drawer || options || !!menu || !!toolbar || !!noteSheet })

  const toggleChrome = chrome.toggle

  const onReady = useCallback(
    (info: ReaderReadyInfo) => {
      setToc(info.toc)
      setReady(true)
      guardRef.current?.ready()
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

  const onLocation = useCallback(
    (loc: ReaderLocation) => {
      locationRef.current = loc
      setLocation(loc)
      // A repeated CFI (better progress) is not a page turn; a new position closes the toolbar.
      if (lastPositionRef.current !== null && lastPositionRef.current !== loc.position) setToolbar(null)
      lastPositionRef.current = loc.position
      // Nothing is saved until the engine has restored the saved place (no drift on reopen).
      if (!guardRef.current?.accept(loc)) return
      resumeRef.current = loc.position
      syncRef.current?.update({ position: loc.position, progress: loc.progress })
    },
    [setToolbar],
  )

  const onSelection = useCallback(
    (sel: ReaderSelection | null) => {
      const current = toolbarRef.current
      if (!sel || !sel.text.trim()) {
        // The toolbar of a highlight we just made outlives the engine clearing its selection.
        if (current && current.locator === null) setToolbar(null)
        return
      }
      if (current?.locator && current.selection?.locator === sel.locator) return
      const bounds = rootRef.current?.getBoundingClientRect()
      if (bounds) setToolbar({ rect: sel.rect, bounds, selection: sel, locator: null })
    },
    [setToolbar],
  )

  const onAnnotationClick = useCallback(
    (id: string, rect: Box) => {
      const a = highlightsRef.current.find((h) => String(h.id) === id)
      const bounds = rootRef.current?.getBoundingClientRect()
      if (a && bounds) setToolbar({ rect, bounds, selection: null, locator: a.locator })
    },
    [setToolbar],
  )

  const onTap = useCallback(
    (zone: 'prev' | 'next' | 'center') => {
      setToolbar(null)
      if (zone === 'center') toggleChrome()
      else guardRef.current?.release() // the engine turns the page itself
    },
    [toggleChrome, setToolbar],
  )

  const onError = useCallback(
    (err: Error) => {
      console.error('[books] reader error', err)
      setError(err.message || 'The file could not be read.')
      setReady(false)
      setToolbar(null)
    },
    [setToolbar],
  )

  const retry = () => {
    setError(null)
    setReady(false)
    setToc([])
    setLocation(null)
    lastPositionRef.current = null
    guardRef.current = createRestoreGuard(
      resumeRef.current ? { position: resumeRef.current, progress: locationRef.current?.progress ?? start?.progress ?? 0 } : null,
    )
    setOpenAt(resumeRef.current)
    setAttempt((n) => n + 1)
  }

  const changeAppearance = (patch: Partial<ReaderAppearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch }
      saveAppearance(ctx.storage, next)
      return next
    })
    setToolbar(null)
  }

  const closeDrawer = useCallback(() => {
    setDrawer(false)
    contentsButton.current?.focus({ preventScroll: true })
  }, [])
  const closeOptions = useCallback(() => setOptions(false), [])

  const userNavigated = () => {
    guardRef.current?.release()
    setToolbar(null)
  }

  /* ---- Bookmarks ---- */
  const hereBookmarks = useMemo(() => bookmarksHere(bookmarks, location, book.format), [bookmarks, location, book.format])
  const bookmarked = hereBookmarks.length > 0

  const toggleBookmark = () => {
    const loc = locationRef.current
    if (!loc || !host.addAnnotation) return
    const here = bookmarksHere(bookmarks, loc, book.format)
    if (here.length > 0) {
      here.forEach((b) => host.removeAnnotation?.(book.id, b.id))
      return
    }
    host.addAnnotation(book.id, {
      kind: 'bookmark',
      locator: loc.position,
      text: null,
      note: null,
      color: null,
      style: null,
      chapter: loc.chapter,
      progress: loc.progress,
      page: loc.page ?? null,
    })
  }

  /* ---- Highlights ---- */
  const annotationFor = (t: ToolbarState | null) => (t?.locator ? highlightsRef.current.find((h) => h.locator === t.locator) : undefined)
  const toolbarAnnotation = annotationFor(toolbar)

  // A highlight deleted elsewhere takes its toolbar with it.
  useEffect(() => {
    if (toolbar?.locator && !toolbarAnnotation && !toolbar.selection) setToolbar(null)
  }, [toolbar, toolbarAnnotation, setToolbar])

  const createHighlight = (sel: ReaderSelection, d: HighlightDefaults): string | null => {
    const loc = locationRef.current
    if (!host.addAnnotation || !sel.locator) return null
    host.addAnnotation(book.id, {
      kind: 'highlight',
      locator: sel.locator,
      text: sel.text,
      note: null,
      color: d.color,
      style: d.style,
      chapter: loc?.chapter ?? null,
      progress: sel.progress ?? loc?.progress ?? bookRef.current.progress,
      page: sel.page ?? null,
    })
    const t = toolbarRef.current
    if (t) setToolbar({ ...t, locator: sel.locator })
    return sel.locator
  }

  const afterAction = () => handleRef.current?.clearSelection?.()

  const chooseDefaults = (patch: Partial<HighlightDefaults>) => {
    const next = { ...defaultsRef.current, ...patch }
    defaultsRef.current = next
    setDefaultsState(next)
    saveHighlightDefaults(ctx.storage, next)
    const t = toolbarRef.current
    const existing = annotationFor(t)
    if (existing) host.updateAnnotation?.(book.id, existing.id, patch)
    else if (t?.selection) createHighlight(t.selection, next)
    afterAction()
  }

  const onStyle = (style: HighlightStyle) => chooseDefaults({ style })
  const onColor = (color: HighlightColor) => chooseDefaults({ color })

  const toolbarText = () => toolbarRef.current?.selection?.text ?? annotationFor(toolbarRef.current)?.text ?? ''

  const copyText = (text: string) => {
    if (!text) return
    navigator.clipboard
      .writeText(text)
      .then(() => ctx.flash('Copied'))
      .catch((err) => console.error('[books] could not copy', err))
  }

  const copy = () => {
    copyText(toolbarText())
    setToolbar(null)
    afterAction()
  }

  const quote = () => {
    const t = toolbarRef.current
    const ann = annotationFor(t)
    const text = t?.selection?.text ?? ann?.text ?? ''
    if (!text) return
    const loc = locationRef.current
    const where = t?.selection?.where || (book.format === 'pdf' && ann?.page != null ? `p. ${ann.page}` : ann?.chapter) || loc?.chapter || ''
    const markdown = quoteMarkdown({
      text,
      where,
      format: book.format,
      progress: ann?.progress ?? t?.selection?.progress ?? loc?.progress ?? bookRef.current.progress,
    })
    setToolbar(null)
    afterAction()
    ctx.notes
      .append(noteId, markdown)
      .then(() => ctx.flash(`Quoted in “${ctx.notes.title(noteId) || book.title}”`))
      .catch((err) => console.error('[books] could not quote into the note', err))
  }

  const openNoteSheet = () => {
    const t = toolbarRef.current
    if (!t) return
    let locator = t.locator
    const ann = annotationFor(t)
    if (!ann && t.selection) locator = createHighlight(t.selection, defaultsRef.current)
    if (!locator) return
    setNoteSheet({
      locator,
      quote: t.selection?.text ?? ann?.text ?? null,
      color: ann?.color ?? defaultsRef.current.color,
      initial: ann?.note ?? '',
    })
    setToolbar(null)
    afterAction()
  }

  const saveNote = (note: string) => {
    const sheet = noteSheet
    setNoteSheet(null)
    if (!sheet) return
    const ann = highlightsRef.current.find((h) => h.locator === sheet.locator)
    if (ann) host.updateAnnotation?.(book.id, ann.id, { note: note || null })
    handleRef.current?.focus()
  }

  const deleteHighlight = () => {
    const ann = annotationFor(toolbarRef.current)
    if (ann) host.removeAnnotation?.(book.id, ann.id)
    setToolbar(null)
    afterAction()
  }

  const highlightSelectionWithDefaults = () => {
    const t = toolbarRef.current
    if (!t?.selection || t.locator) return false
    if (!createHighlight(t.selection, defaultsRef.current)) return false
    afterAction()
    return true
  }

  /* ---- Drawer actions ---- */
  const goTo = (target: string) => {
    userNavigated()
    handleRef.current?.goTo(target)
    setDrawer(false)
    handleRef.current?.focus()
  }

  const clearAll = (kind: 'bookmark' | 'highlight') => {
    const list = kind === 'bookmark' ? bookmarks : highlights
    if (list.length === 0) return
    const noun = kind === 'bookmark' ? 'bookmark' : 'highlight'
    useUiStore.getState().confirm({
      title: `Clear all ${noun}s?`,
      message: `${list.length} ${list.length === 1 ? noun : `${noun}s`} in “${book.title}” will be deleted. This can’t be undone.`,
      confirmLabel: 'Clear All',
      destructive: true,
      onConfirm: () => clearBookAnnotations(book.id, kind),
    })
  }

  /* ---- Notes menu ---- */
  const openNotesMenu = () => {
    const r = notesButton.current?.getBoundingClientRect()
    setOptions(false)
    setMenu({
      x: r ? r.right - 190 : 0,
      y: r ? r.bottom + 4 : 0,
      items: [
        { label: 'Open Notes', icon: 'square.and.pencil', onSelect: () => ctx.notes.open(noteId, { split: true }) },
        ...(host.openHighlightsNote
          ? [
              {
                label: 'Open Highlights',
                icon: 'highlighter' as const,
                disabled: annotations.length === 0,
                onSelect: () => host.openHighlightsNote?.(book.id),
              },
            ]
          : []),
      ],
    })
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!PAGING_KEYS.has(e.key) && e.key !== 'Escape') chrome.show()
    if (e.key === 'Escape') {
      if (drawer) {
        e.preventDefault()
        closeDrawer()
      } else if (toolbar) {
        setToolbar(null)
      }
      return
    }
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
    const handle = handleRef.current
    if (!handle || !ready || drawer) return
    let handled = true
    switch (e.key) {
      case 'b':
      case 'B':
        toggleBookmark()
        break
      case 'h':
      case 'H':
        if (!highlightSelectionWithDefaults()) handled = false
        break
      case 'ArrowRight':
      case 'PageDown':
        userNavigated()
        handle.next()
        break
      case 'ArrowLeft':
      case 'PageUp':
        userNavigated()
        handle.prev()
        break
      case ' ':
        userNavigated()
        if (e.shiftKey) handle.prev()
        else handle.next()
        break
      case 'Home':
        userNavigated()
        handle.goToProgress(0)
        break
      case 'End':
        userNavigated()
        handle.goToProgress(1)
        break
      default:
        handled = false
    }
    if (handled) e.preventDefault()
  }

  const fallbackLabel = book.title
  const parts = statusParts(book.format, appearance.layout, location, fallbackLabel)
  const progressText = progressLabel(book.format, location)
  const progress = location?.progress ?? book.progress
  const Engine = book.format === 'epub' ? EpubView : PdfView
  const rootStyle = {
    '--reader-bg': colors.background,
    '--reader-fg': colors.text,
    '--reader-muted': colors.muted ?? colors.text,
    '--reader-bg-image': colors.backgroundImage ?? 'none',
  } as CSSProperties
  const shownStyle = toolbarAnnotation?.style ?? defaults.style
  const shownColor = toolbarAnnotation?.color ?? defaults.color

  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={rootStyle}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerMove={chrome.onPointerMove}
      onPointerDownCapture={(e) => {
        // Clicks in our chrome never reach the engine, so they have to close the toolbar themselves.
        if (toolbarRef.current && !(e.target as HTMLElement).closest('[data-testid="selection-toolbar"]')) setToolbar(null)
      }}
    >
      <div className={`${styles.stage} ${paged ? '' : styles.stageInset}`}>
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
                annotations={engineAnnotations}
                onReady={onReady}
                onLocation={onLocation}
                onSelection={onSelection}
                onAnnotationClick={onAnnotationClick}
                onTap={onTap}
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
        </div>
      </div>

      {paged && !chrome.visible && error === null && (
        <>
          <div className={`${styles.edge} ${styles.edgeTop}`} onPointerEnter={chrome.show} aria-hidden="true" />
          <div className={`${styles.edge} ${styles.edgeBottom}`} onPointerEnter={chrome.show} aria-hidden="true" />
        </>
      )}

      {/* The ribbon shows while the chrome is hidden; with the chrome up, the filled bookmark button says the same. */}
      {bookmarked && !chrome.visible && (
        <svg className={styles.ribbon} viewBox="0 0 22 40" aria-hidden="true" data-testid="bookmark-ribbon">
          <path d="M0 0h22v40l-11-8.5L0 40z" fill="currentColor" />
        </svg>
      )}

      <TopBar
        visible={chrome.visible}
        solid={!paged}
        hover={chrome.hoverProps}
        chapter={location?.chapter || book.title}
        ready={ready && error === null}
        drawerOpen={drawer}
        optionsOpen={options}
        menuOpen={!!menu}
        bookmarked={bookmarked}
        canBookmark={canEdit}
        contentsRef={contentsButton}
        optionsRef={optionsButton}
        notesRef={notesButton}
        onContents={() => {
          setOptions(false)
          if (drawer) closeDrawer()
          else setDrawer(true)
        }}
        onBookmark={toggleBookmark}
        onOptions={() => {
          setDrawer(false)
          setOptions((v) => !v)
        }}
        onNotes={openNotesMenu}
      />
      {error === null && (
        <StatusLine
          visible={chrome.visible}
          solid={!paged}
          hover={chrome.hoverProps}
          parts={parts}
          progress={progress}
          label={progressText}
          onSeek={(p) => {
            userNavigated()
            handleRef.current?.goToProgress(p)
          }}
        />
      )}

      {drawer && (
        <Drawer
          tab={drawerTab}
          onTab={setDrawerTab}
          toc={toc}
          current={currentTocIndex(toc, book.format, location)}
          bookmarks={bookmarks}
          highlights={highlights}
          canEdit={canEdit}
          onClose={closeDrawer}
          onPickToc={(item) => goTo(item.target)}
          onGoTo={(a) => goTo(a.locator)}
          onEditNote={(a) =>
            setNoteSheet({ locator: a.locator, quote: a.text, color: a.color, initial: a.note ?? '' })
          }
          onCopy={(a) => copyText(a.text ?? '')}
          onDelete={(a) => host.removeAnnotation?.(book.id, a.id)}
          onClearAll={clearAll}
        />
      )}

      {options && (
        <VisualOptions
          format={book.format}
          appearance={appearance}
          colors={colors}
          onChange={changeAppearance}
          onReset={() => changeAppearance({ ...DEFAULT_APPEARANCE })}
          onClose={closeOptions}
          anchorRef={optionsButton}
        />
      )}

      {toolbar && (
        <SelectionToolbar
          rect={toolbar.rect}
          bounds={toolbar.bounds}
          style={shownStyle}
          color={shownColor}
          existing={!!toolbarAnnotation}
          canHighlight={canEdit && (!!toolbar.locator || !!toolbar.selection?.locator)}
          onStyle={onStyle}
          onColor={onColor}
          onCopy={copy}
          onNote={openNoteSheet}
          onQuote={quote}
          onDelete={deleteHighlight}
        />
      )}

      {noteSheet && (
        <NoteSheet
          quote={noteSheet.quote}
          color={noteSheet.color}
          initial={noteSheet.initial}
          onSave={saveNote}
          onCancel={() => {
            setNoteSheet(null)
            handleRef.current?.focus()
          }}
        />
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
