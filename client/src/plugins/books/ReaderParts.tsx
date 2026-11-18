/** Pieces of the reader chrome: contents drawer, appearance popover, progress track and selection bar. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Segmented } from '../../components/ui/Segmented'
import { FIXED_PALETTES, FONT_SCALE, PDF_ZOOM, stepFontScale, stepPdfZoom, THEMES } from './appearance'
import type { BookFormat, ReaderAppearance, ReaderSelection, ReaderTheme, TocItem } from './reader/types'
import styles from './ReaderTile.module.css'

/* ---- Contents drawer ---------------------------------------------------- */

interface ContentsProps {
  toc: TocItem[]
  current: number
  onPick: (item: TocItem) => void
  onClose: () => void
}

export function ContentsDrawer({ toc, current, onPick, onClose }: ContentsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Focus moves into the drawer (the current entry, else the first); the shell puts it back on close.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const target = list.querySelector<HTMLElement>('[aria-current="true"]') ?? list.querySelector<HTMLElement>('button')
    ;(target ?? list).focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'center' })
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('button') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.drawer} aria-label="Contents" onKeyDown={onKeyDown}>
        <div className={styles.drawerTitle}>Contents</div>
        <div ref={listRef} className={styles.toc} tabIndex={-1}>
          {toc.length === 0 ? (
            <p className={styles.tocEmpty}>No contents in this book</p>
          ) : (
            toc.map((item, i) => (
              <button
                key={`${item.id}-${i}`}
                type="button"
                className={`${styles.tocItem} ${i === current ? styles.tocItemCurrent : ''}`}
                style={{ paddingLeft: 12 + item.level * 12 }}
                aria-current={i === current ? 'true' : undefined}
                onClick={() => onPick(item)}
              >
                <span className={styles.tocLabel}>{item.label}</span>
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  )
}

/* ---- Appearance popover ------------------------------------------------- */

const THEME_LABEL: Record<ReaderTheme, string> = { auto: 'Auto', light: 'Light', sepia: 'Sepia', dark: 'Dark' }

function swatchStyle(theme: ReaderTheme): CSSProperties {
  if (theme === 'auto') {
    const { light, dark } = FIXED_PALETTES
    return { background: `linear-gradient(135deg, ${light.background} 50%, ${dark.background} 50%)`, color: 'var(--system-gray)' }
  }
  const p = FIXED_PALETTES[theme]
  return { background: p.background, color: p.text }
}

interface AppearanceProps {
  format: BookFormat
  appearance: ReaderAppearance
  onChange: (patch: Partial<ReaderAppearance>) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

export function AppearancePopover({ format, appearance, onChange, onClose, anchorRef }: AppearanceProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside clicks (including clicks into the book iframe, which blur this window) and Escape.
  useEffect(() => {
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node | null
      if (!target || ref.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose, anchorRef])

  const zoom = appearance.pdfZoom
  const zoomCustom = typeof zoom === 'number'

  return (
    <div ref={ref} className={styles.popover} role="dialog" aria-label="Appearance">
      <div className={styles.row}>
        <span className={styles.rowLabel}>Theme</span>
        <div className={styles.chips} role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={appearance.theme === t}
              className={`${styles.chip} ${appearance.theme === t ? styles.chipSelected : ''}`}
              onClick={() => onChange({ theme: t })}
            >
              <span className={styles.swatch} style={swatchStyle(t)}>
                Aa
              </span>
              <span>{THEME_LABEL[t]}</span>
            </button>
          ))}
        </div>
      </div>

      {format === 'epub' ? (
        <>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Text Size</span>
            <Stepper
              label="Text size"
              value={`${Math.round(appearance.fontScale * 100)}%`}
              canDec={appearance.fontScale > FONT_SCALE.min + 1e-6}
              canInc={appearance.fontScale < FONT_SCALE.max - 1e-6}
              onDec={() => onChange({ fontScale: stepFontScale(appearance.fontScale, -1) })}
              onInc={() => onChange({ fontScale: stepFontScale(appearance.fontScale, 1) })}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Font</span>
            <Segmented<ReaderAppearance['fontFamily']>
              size="small"
              label="Font"
              value={appearance.fontFamily}
              onChange={(fontFamily) => onChange({ fontFamily })}
              options={[
                { value: 'serif', label: 'Serif' },
                { value: 'sans', label: 'Sans' },
                { value: 'publisher', label: 'Original', title: 'Keep the book’s own fonts' },
              ]}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Layout</span>
            <Segmented<ReaderAppearance['layout']>
              size="small"
              label="Layout"
              value={appearance.layout}
              onChange={(layout) => onChange({ layout })}
              options={[
                { value: 'paginated', label: 'Pages' },
                { value: 'scrolled', label: 'Scroll' },
              ]}
            />
          </div>
        </>
      ) : (
        <>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Fit</span>
            <Segmented<'fit-width' | 'fit-page' | 'custom'>
              size="small"
              label="Fit"
              value={zoomCustom ? 'custom' : zoom}
              onChange={(v) => {
                if (v !== 'custom') onChange({ pdfZoom: v })
              }}
              options={[
                { value: 'fit-width', label: 'Fit Width' },
                { value: 'fit-page', label: 'Fit Page' },
                ...(zoomCustom ? [{ value: 'custom' as const, label: `${Math.round(zoom * 100)}%` }] : []),
              ]}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Zoom</span>
            <Stepper
              label="Zoom"
              value={zoomCustom ? `${Math.round(zoom * 100)}%` : 'Fit'}
              canDec={!zoomCustom || zoom > PDF_ZOOM.min + 1e-6}
              canInc={!zoomCustom || zoom < PDF_ZOOM.max - 1e-6}
              onDec={() => onChange({ pdfZoom: stepPdfZoom(zoom, -1) })}
              onInc={() => onChange({ pdfZoom: stepPdfZoom(zoom, 1) })}
            />
          </div>
        </>
      )}
    </div>
  )
}

function Stepper({
  label,
  value,
  canDec,
  canInc,
  onDec,
  onInc,
}: {
  label: string
  value: string
  canDec: boolean
  canInc: boolean
  onDec: () => void
  onInc: () => void
}) {
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <button type="button" className={styles.stepButton} aria-label={`Decrease ${label.toLowerCase()}`} title={`Decrease ${label.toLowerCase()}`} disabled={!canDec} onClick={onDec}>
        <Icon name="minus" size={14} />
      </button>
      <span className={styles.stepValue} aria-live="polite">
        {value}
      </span>
      <button type="button" className={styles.stepButton} aria-label={`Increase ${label.toLowerCase()}`} title={`Increase ${label.toLowerCase()}`} disabled={!canInc} onClick={onInc}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  )
}

/* ---- Progress track ----------------------------------------------------- */

interface TrackProps {
  progress: number
  label: string
  onSeek: (progress: number) => void
}

export function ProgressTrack({ progress, label, onSeek }: TrackProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const lastSeek = useRef(0)

  const fractionAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const f = fractionAt(e.clientX)
    setDrag(f)
    lastSeek.current = Date.now()
    onSeek(f)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    const f = fractionAt(e.clientX)
    setDrag(f)
    // Jumping through an EPUB is not free: while dragging, seek at most every 150 ms.
    if (Date.now() - lastSeek.current > 150) {
      lastSeek.current = Date.now()
      onSeek(f)
    }
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    const f = fractionAt(e.clientX)
    setDrag(null)
    onSeek(f)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = progress + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = progress - step
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 1
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onSeek(Math.min(1, Math.max(0, next)))
  }

  const shown = drag ?? progress
  return (
    <div
      ref={ref}
      className={styles.track}
      role="slider"
      tabIndex={0}
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      aria-valuetext={label || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={onKeyDown}
    >
      <div className={styles.trackFill} style={{ width: `${shown * 100}%` }} />
    </div>
  )
}

/* ---- Selection bar ------------------------------------------------------ */

interface SelectionBarProps {
  selection: ReaderSelection
  /** The tile's bounding rect, to turn viewport coordinates into tile-relative ones. */
  bounds: DOMRect
  onQuote: () => void
  onCopy: () => void
}

const PILL_HALF = 104
const PILL_HEIGHT = 34
const BAR_HEIGHT = 38

export function SelectionBar({ selection, bounds, onQuote, onCopy }: SelectionBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(PILL_HALF * 2)
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth)
  }, [])

  const { rect } = selection
  const half = width / 2
  const centre = rect.x + rect.width / 2 - bounds.left
  const left = Math.min(Math.max(centre, half + 8), Math.max(half + 8, bounds.width - half - 8))
  const above = rect.y - bounds.top - PILL_HEIGHT - 8
  const top = above >= BAR_HEIGHT + 4 ? above : Math.min(rect.y + rect.height - bounds.top + 8, bounds.height - PILL_HEIGHT - 8)

  return (
    <div
      ref={ref}
      className={styles.selectionBar}
      style={{ left, top }}
      role="toolbar"
      aria-label="Selection"
      // Keep the book's selection alive while pressing the buttons.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className={styles.selectionButton} onClick={onQuote} title="Quote in Notes" aria-label="Quote in Notes">
        <Icon name="quote.bubble" size={15} />
        <span>Quote in Notes</span>
      </button>
      <span className={styles.selectionDivider} aria-hidden="true" />
      <button type="button" className={styles.selectionButton} onClick={onCopy} title="Copy" aria-label="Copy">
        <Icon name="doc.on.doc" size={15} />
        <span>Copy</span>
      </button>
    </div>
  )
}
