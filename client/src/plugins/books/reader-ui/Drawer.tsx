/** The reader drawer: Contents · Bookmarks · Highlights · Quotes (Moon+ style lists, spec §4), all from the database. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Icon } from '../../../components/Icon'
import { ContextMenu, type MenuState } from '../../../components/ui/ContextMenu'
import { Segmented } from '../../../components/ui/Segmented'
import { percentLabel } from '../labels'
import { hexToRgba, PAPER_STOCK } from '../paper'
import { HIGHLIGHT_COLORS, type HighlightColor, type TocItem } from '../reader/types'
import { parseServerTime, type BookAnnotation } from '../types'
import { byPosition } from './bookmarks'
import styles from './Panels.module.css'

export type DrawerTab = 'contents' | 'bookmarks' | 'highlights' | 'quotes'

const STYLE_CLASS = {
  highlight: styles.styleHighlight,
  underline: styles.styleUnderline,
  strike: styles.styleStrike,
  squiggle: styles.styleSquiggle,
  sketch: styles.styleSketch,
  double: styles.styleDouble,
  dotted: styles.styleDotted,
  dashed: styles.styleDashed,
  curly: styles.styleCurly,
} as const

const COLOR_LABEL: Record<HighlightColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', orange: 'Orange' }

interface Props {
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  toc: TocItem[]
  current: number
  bookmarks: BookAnnotation[]
  highlights: BookAnnotation[]
  /** Passages sent to the book's note with Quote in Notes. */
  quotes: BookAnnotation[]
  /** Open the book's attached Markdown note. */
  onOpenNotes: () => void
  /** Highlight actions need the annotations host (ACC-39). */
  canEdit: boolean
  onPickToc: (item: TocItem) => void
  onGoTo: (annotation: BookAnnotation) => void
  onEditNote: (annotation: BookAnnotation) => void
  onCopy: (annotation: BookAnnotation) => void
  onDelete: (annotation: BookAnnotation) => void
  onClearAll: (kind: 'bookmark' | 'highlight' | 'quote') => void
  onClose: () => void
}

export function Drawer(p: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<HighlightColor | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const bookmarks = useMemo(() => byPosition(p.bookmarks), [p.bookmarks])
  const highlights = useMemo(() => byPosition(p.highlights), [p.highlights])
  const quotes = useMemo(() => byPosition(p.quotes), [p.quotes])
  const shownHighlights = filter ? highlights.filter((h) => h.color === filter) : highlights

  // Focus moves into the list (the current contents entry, else the first row); the shell puts it back on close.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const target = list.querySelector<HTMLElement>('[aria-current="true"]') ?? list.querySelector<HTMLElement>('button')
    ;(target ?? list).focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'center' })
  }, [p.tab])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (menu) setMenu(null)
      else p.onClose()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  const rowMenu = (a: BookAnnotation, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: 'Go to', icon: 'arrow.right.square', onSelect: () => p.onGoTo(a) },
        ...(a.kind === 'quote' ? ([{ label: 'Copy', icon: 'doc.on.doc', onSelect: () => p.onCopy(a) }] as const) : []),
        ...(a.kind === 'highlight'
          ? ([
              { label: a.note ? 'Edit Note' : 'Add Note', icon: 'note.text', disabled: !p.canEdit, onSelect: () => p.onEditNote(a) },
              { label: 'Copy', icon: 'doc.on.doc', onSelect: () => p.onCopy(a) },
            ] as const)
          : []),
        { separator: true },
        { label: 'Delete', icon: 'trash', destructive: true, disabled: !p.canEdit, onSelect: () => p.onDelete(a) },
      ],
    })

  const count =
    p.tab === 'bookmarks' ? bookmarks.length : p.tab === 'highlights' ? highlights.length : p.tab === 'quotes' ? quotes.length : 0
  const noun = p.tab === 'bookmarks' ? 'bookmark' : p.tab === 'quotes' ? 'quote' : 'highlight'

  return (
    <>
      <div className={styles.scrim} onClick={p.onClose} aria-hidden="true" />
      <aside className={styles.drawer} aria-label="Contents, bookmarks, highlights and quotes" onKeyDown={onKeyDown}>
        <div className={styles.tabs}>
          <Segmented<DrawerTab>
            size="small"
            label="Drawer"
            value={p.tab}
            onChange={p.onTab}
            options={[
              { value: 'contents', label: 'Contents' },
              { value: 'bookmarks', label: bookmarks.length ? `Bookmarks ${bookmarks.length}` : 'Bookmarks' },
              { value: 'highlights', label: highlights.length ? `Highlights ${highlights.length}` : 'Highlights' },
              { value: 'quotes', label: quotes.length ? `Quotes ${quotes.length}` : 'Quotes' },
            ]}
          />
        </div>

        {p.tab === 'highlights' && highlights.length > 0 && (
          <div className={styles.filter} role="group" aria-label="Filter by colour">
            <span className={styles.filterLabel}>Colour</span>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.filterDot}
                style={{ '--dot': PAPER_STOCK.highlightBase[c] } as CSSProperties}
                aria-pressed={filter === c}
                aria-label={`${COLOR_LABEL[c]} highlights`}
                title={COLOR_LABEL[c]}
                onClick={() => setFilter((f) => (f === c ? null : c))}
              />
            ))}
          </div>
        )}

        <div ref={listRef} className={styles.list} tabIndex={-1}>
          {p.tab === 'contents' &&
            (p.toc.length === 0 ? (
              <p className={styles.empty}>No contents in this book</p>
            ) : (
              p.toc.map((item, i) => (
                <button
                  key={`${item.id}-${i}`}
                  type="button"
                  data-nav
                  className={`${styles.tocItem} ${i === p.current ? styles.tocItemCurrent : ''}`}
                  style={{ paddingLeft: 12 + item.level * 12 }}
                  aria-current={i === p.current ? 'true' : undefined}
                  onClick={() => p.onPickToc(item)}
                >
                  <span className={styles.tocLabel}>{item.label}</span>
                </button>
              ))
            ))}

          {p.tab === 'bookmarks' &&
            (bookmarks.length === 0 ? (
              <p className={styles.empty}>
                <span className={styles.emptyTitle}>No bookmarks yet</span>
                Press B or tap the ribbon in the top bar to bookmark a page.
              </p>
            ) : (
              bookmarks.map((a) => <AnnotationRow key={a.id} a={a} onGoTo={p.onGoTo} onMenu={rowMenu} />)
            ))}

          {p.tab === 'highlights' &&
            (highlights.length === 0 ? (
              <p className={styles.empty}>
                <span className={styles.emptyTitle}>No highlights yet</span>
                Select text in the book to highlight it, add a note or quote it.
              </p>
            ) : shownHighlights.length === 0 ? (
              <p className={styles.empty}>No {filter ? COLOR_LABEL[filter].toLowerCase() : ''} highlights</p>
            ) : (
              shownHighlights.map((a) => <AnnotationRow key={a.id} a={a} onGoTo={p.onGoTo} onMenu={rowMenu} />)
            ))}

          {p.tab === 'quotes' &&
            (quotes.length === 0 ? (
              <p className={styles.empty}>
                <span className={styles.emptyTitle}>No quotes yet</span>
                Select text and choose Quote to send it to this book’s notes.
              </p>
            ) : (
              quotes.map((a) => <AnnotationRow key={a.id} a={a} onGoTo={p.onGoTo} onMenu={rowMenu} />)
            ))}
        </div>

        {p.tab !== 'contents' && (
          <div className={styles.drawerFoot}>
            <button type="button" className={styles.linkButton} onClick={p.onOpenNotes}>
              Open Notes
            </button>
            {count > 0 && (
              <>
                <span>
                  {count} {count === 1 ? noun : `${noun}s`}
                </span>
                <button
                  type="button"
                  className={`${styles.linkButton} ${styles.danger}`}
                  disabled={!p.canEdit}
                  onClick={() => p.onClearAll(p.tab === 'bookmarks' ? 'bookmark' : p.tab === 'quotes' ? 'quote' : 'highlight')}
                >
                  Clear All
                </button>
              </>
            )}
          </div>
        )}
      </aside>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  )
}

function AnnotationRow({
  a,
  onGoTo,
  onMenu,
}: {
  a: BookAnnotation
  onGoTo: (a: BookAnnotation) => void
  onMenu: (a: BookAnnotation, x: number, y: number) => void
}) {
  const where = a.page != null ? `p. ${a.page}` : percentLabel(a.progress)
  const time = parseServerTime(a.created_at)
  const dateText = time ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const meta = [a.kind !== 'bookmark' ? a.chapter : null, where, dateText].filter(Boolean).join(' · ')
  const base = a.color ? PAPER_STOCK.highlightBase[a.color] : undefined
  const vars = base ? ({ '--mark': base, '--fill': hexToRgba(base, 0.35) } as CSSProperties) : undefined

  return (
    <div className={styles.annRow} style={vars}>
      <button type="button" data-nav className={styles.annMain} onClick={() => onGoTo(a)}>
        {a.kind === 'bookmark' ? (
          <Icon name="bookmark.fill" size={15} className={styles.annBookmarkIcon} />
        ) : a.kind === 'quote' ? (
          <Icon name="quote.bubble" size={15} className={styles.annBookmarkIcon} />
        ) : (
          <span className={styles.annMark} aria-hidden="true" />
        )}
        <span className={styles.annBody}>
          {a.kind === 'bookmark' ? (
            <span className={styles.annTitle}>{a.chapter || 'Bookmark'}</span>
          ) : (
            <span className={styles.annText}>
              <span className={STYLE_CLASS[a.style ?? 'highlight']}>{a.text}</span>
            </span>
          )}
          <span className={styles.annMeta}>{meta}</span>
          {a.note && <span className={styles.annNote}>{a.note}</span>}
        </span>
      </button>
      <button
        type="button"
        className={styles.annMenu}
        aria-label="More actions"
        title="More actions"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onMenu(a, r.left, r.bottom + 4)
        }}
      >
        <Icon name="ellipsis" size={16} />
      </button>
    </div>
  )
}
