/** Reader chrome: the top bar, the status line and the seekable progress track (spec §3.3). */
import { useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type Ref } from 'react'
import { ToolbarButton } from '../../../components/ui/ToolbarButton'
import type { StatusParts } from '../labels'
import styles from './Chrome.module.css'

type Hover = Pick<HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onPointerLeave'>

/** `inert` keeps hidden chrome out of the tab order and the accessibility tree. */
const inertProps = (hidden: boolean) => (hidden ? ({ inert: '', 'aria-hidden': true } as object) : {})

interface TopBarProps {
  visible: boolean
  /** Bars own their space (scroll layout) instead of floating over the page. */
  solid: boolean
  hover: Hover
  chapter: string
  ready: boolean
  drawerOpen: boolean
  optionsOpen: boolean
  menuOpen: boolean
  bookmarked: boolean
  canBookmark: boolean
  contentsRef: Ref<HTMLButtonElement>
  optionsRef: Ref<HTMLButtonElement>
  notesRef: Ref<HTMLButtonElement>
  onContents: () => void
  onBookmark: () => void
  onOptions: () => void
  onNotes: () => void
}

export function TopBar(p: TopBarProps) {
  return (
    <header
      className={`${styles.top} ${p.solid ? styles.solid : ''} ${p.visible ? '' : styles.hiddenTop}`}
      {...p.hover}
      {...inertProps(!p.visible)}
    >
      <ToolbarButton
        ref={p.contentsRef}
        size="small"
        icon="line.3.horizontal"
        label="Contents"
        active={p.drawerOpen}
        disabled={!p.ready}
        onClick={p.onContents}
      />
      <span className={styles.chapter} title={p.chapter}>
        {p.chapter}
      </span>
      <div className={styles.group}>
        <ToolbarButton
          size="small"
          icon={p.bookmarked ? 'bookmark.fill' : 'bookmark'}
          label={p.bookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
          shortcut="B"
          className={p.bookmarked ? styles.bookmarkOn : undefined}
          disabled={!p.ready || !p.canBookmark}
          onClick={p.onBookmark}
        />
        <ToolbarButton
          ref={p.optionsRef}
          size="small"
          icon="textformat.size"
          label="Visual Options"
          active={p.optionsOpen}
          aria-haspopup="dialog"
          aria-expanded={p.optionsOpen}
          onClick={p.onOptions}
        />
        <ToolbarButton
          ref={p.notesRef}
          size="small"
          icon="square.and.pencil"
          label="Notes"
          active={p.menuOpen}
          aria-haspopup="menu"
          aria-expanded={p.menuOpen}
          onClick={p.onNotes}
        />
      </div>
    </header>
  )
}

interface StatusProps {
  visible: boolean
  solid: boolean
  hover: Hover
  parts: StatusParts
  progress: number
  label: string
  onSeek: (progress: number) => void
}

export function StatusLine({ visible, solid, hover, parts, progress, label, onSeek }: StatusProps) {
  return (
    <footer
      className={`${styles.bottom} ${solid ? styles.solid : ''} ${visible ? '' : styles.hiddenBottom}`}
      {...hover}
      {...inertProps(!visible)}
    >
      <div className={styles.status} aria-live="off">
        <span className={styles.statusChapter} title={parts.chapter}>
          {parts.chapter}
        </span>
        <span className={styles.statusPage}>{parts.page}</span>
        <span className={styles.statusPercent}>{parts.percent}</span>
      </div>
      <ProgressTrack progress={progress} label={label} onSeek={onSeek} />
    </footer>
  )
}

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
