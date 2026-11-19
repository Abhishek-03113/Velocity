/** Moon+ style floating toolbar: styles, colours, then Copy · Note · Quote (and Delete for an existing highlight). */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon, type IconName } from '../../../components/Icon'
import { PAPER_STOCK } from '../paper'
import { HIGHLIGHT_COLORS, type HighlightColor, type HighlightStyle } from '../reader/types'
import { placeToolbar, type Box } from './placement'
import styles from './Toolbar.module.css'

const STYLE_BUTTONS: { value: HighlightStyle; label: string; icon: IconName }[] = [
  { value: 'highlight', label: 'Highlight', icon: 'highlighter' },
  { value: 'underline', label: 'Underline', icon: 'underline' },
  { value: 'strike', label: 'Strikethrough', icon: 'strikethrough' },
  { value: 'squiggle', label: 'Squiggly underline', icon: 'squiggle' },
  { value: 'sketch', label: 'Hand-drawn underline', icon: 'underline.sketch' },
  { value: 'curly', label: 'Curly underline', icon: 'curly' },
  { value: 'double', label: 'Double underline', icon: 'underline.double' },
  { value: 'dotted', label: 'Dotted underline', icon: 'underline.dotted' },
  { value: 'dashed', label: 'Dashed underline', icon: 'underline.dashed' },
]

const COLOR_LABEL: Record<HighlightColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', orange: 'Orange' }

export const DISABLED_HINT = 'Highlighting isn’t available for this selection yet'

interface Props {
  rect: Box
  bounds: Box
  style: HighlightStyle
  color: HighlightColor
  /** The toolbar is for an existing highlight (shows Delete). */
  existing: boolean
  /** Highlight, note and delete need `host.addAnnotation`; Copy and Quote always work. */
  canHighlight: boolean
  onStyle: (style: HighlightStyle) => void
  onColor: (color: HighlightColor) => void
  onCopy: () => void
  onNote: () => void
  onQuote: () => void
  onDelete: () => void
}

export function SelectionToolbar(p: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 248, height: 124 })

  useLayoutEffect(() => {
    const el = ref.current
    if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) {
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    }
  }, [size.width, size.height, p.existing])

  const placement = placeToolbar({ rect: p.rect, bounds: p.bounds, size })
  const hint = p.canHighlight ? undefined : DISABLED_HINT

  return (
    <div
      ref={ref}
      className={`${styles.toolbar} ${placement.side === 'above' ? styles.above : styles.below}`}
      style={{ left: placement.left, top: placement.top, '--notch': `${placement.notch}px` } as CSSProperties}
      role="toolbar"
      aria-label="Selection"
      data-testid="selection-toolbar"
      // Keep the book's selection alive while pressing the buttons.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={styles.styles} role="group" aria-label="Style">
        {STYLE_BUTTONS.map((s) => (
          <button
            key={s.value}
            type="button"
            className={styles.styleButton}
            aria-pressed={p.style === s.value}
            aria-label={s.label}
            title={hint ?? s.label}
            disabled={!p.canHighlight}
            onClick={() => p.onStyle(s.value)}
          >
            <Icon name={s.icon} size={18} />
          </button>
        ))}
      </div>
      <div className={styles.colors} role="group" aria-label="Colour">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.dot}
            style={{ '--dot': PAPER_STOCK.highlightBase[c] } as CSSProperties}
            aria-pressed={p.color === c}
            aria-label={COLOR_LABEL[c]}
            title={hint ?? COLOR_LABEL[c]}
            disabled={!p.canHighlight}
            onClick={() => p.onColor(c)}
          />
        ))}
      </div>
      <div className={styles.rule} />
      <div className={styles.actions}>
        <button type="button" className={styles.action} title="Copy" onClick={p.onCopy}>
          <Icon name="doc.on.doc" size={14} />
          <span>Copy</span>
        </button>
        <button type="button" className={styles.action} title={hint ?? 'Add a note'} disabled={!p.canHighlight} onClick={p.onNote}>
          <Icon name="note.text" size={14} />
          <span>Note</span>
        </button>
        <button type="button" className={styles.action} title="Quote in Notes" onClick={p.onQuote}>
          <Icon name="quote.bubble" size={14} />
          <span>Quote</span>
        </button>
        {p.existing && (
          <button
            type="button"
            className={`${styles.action} ${styles.actionDanger}`}
            title="Delete highlight"
            aria-label="Delete highlight"
            disabled={!p.canHighlight}
            onClick={p.onDelete}
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
