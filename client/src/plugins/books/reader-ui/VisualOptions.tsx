/** Visual Options (spec §3.3): every reading setting in one sheet, applied live under it. */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Icon } from '../../../components/Icon'
import { Segmented } from '../../../components/ui/Segmented'
import {
  domTokens,
  FONT_SCALE,
  LINE_HEIGHT,
  PARAGRAPH_SPACING,
  PDF_ZOOM,
  resolveColors,
  stepFontScale,
  stepPdfZoom,
  stepRange,
  THEMES,
} from '../appearance'
import type { BookFormat, PageTurnEffect, ReaderAppearance, ReaderColors, ReaderTheme } from '../reader/types'
import { withAppearanceDefaults } from '../reader/types'
import styles from './Panels.module.css'

const THEME_LABEL: Record<ReaderTheme, string> = { paper: 'Paper', auto: 'Auto', light: 'Light', sepia: 'Sepia', dark: 'Dark' }

interface Props {
  format: BookFormat
  appearance: ReaderAppearance
  /** The current reader colours; a change means the app theme changed, so the swatches are recomputed. */
  colors: ReaderColors
  onChange: (patch: Partial<ReaderAppearance>) => void
  onReset: () => void
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

export function VisualOptions({ format, appearance, colors, onChange, onReset, onClose, anchorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const a = withAppearanceDefaults(appearance)

  // Close on outside clicks (including clicks into the book iframe, which blur this window) and Escape.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target || ref.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
      anchorRef.current?.focus({ preventScroll: true })
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

  // Real swatches: each stock resolved against the live theme, grain included.
  const swatches = useMemo(
    () => Object.fromEntries(THEMES.map((t) => [t, resolveColors(t, domTokens())])) as Record<ReaderTheme, ReaderColors>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors],
  )
  const swatchStyle = (t: ReaderTheme): CSSProperties => ({
    backgroundColor: swatches[t].background,
    backgroundImage: swatches[t].backgroundImage ?? undefined,
    color: swatches[t].text,
  })

  const scrolled = a.layout === 'scrolled'
  const zoom = a.pdfZoom
  const zoomCustom = typeof zoom === 'number'

  return (
    <div ref={ref} className={styles.panel} role="dialog" aria-label="Visual Options">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Visual Options</h2>
        <button type="button" className={styles.linkButton} onClick={onReset}>
          Reset
        </button>
      </div>
      <div className={styles.panelBody}>
        <Row label="Theme" tall>
          <div className={styles.chips} role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={a.theme === t}
                className={`${styles.chip} ${a.theme === t ? styles.chipSelected : ''}`}
                onClick={() => onChange({ theme: t })}
              >
                <span className={styles.swatch} style={swatchStyle(t)}>
                  Aa
                </span>
                <span>{THEME_LABEL[t]}</span>
              </button>
            ))}
          </div>
        </Row>

        <Row label="Layout">
          <Segmented<ReaderAppearance['layout']>
            size="small"
            label="Layout"
            value={a.layout}
            onChange={(layout) => onChange({ layout })}
            options={[
              { value: 'paginated', label: 'Pages' },
              { value: 'scrolled', label: 'Scroll' },
            ]}
          />
        </Row>

        <Row label="Page turn" disabled={scrolled}>
          <Segmented<PageTurnEffect>
            size="small"
            label="Page turn"
            value={a.pageTurn}
            onChange={(pageTurn) => onChange({ pageTurn })}
            options={[
              { value: 'curl', label: 'Curl' },
              { value: 'slide', label: 'Slide' },
              { value: 'fade', label: 'Fade' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Row>

        {format === 'epub' ? (
          <>
            <Row label="Font">
              <Segmented<ReaderAppearance['fontFamily']>
                size="small"
                label="Font"
                value={a.fontFamily}
                onChange={(fontFamily) => onChange({ fontFamily })}
                options={[
                  { value: 'serif', label: 'Serif' },
                  { value: 'sans', label: 'Sans' },
                  { value: 'publisher', label: 'Original', title: 'Keep the book’s own fonts' },
                ]}
              />
            </Row>
            <Row label="Size">
              <Stepper
                label="Text size"
                value={`${Math.round(a.fontScale * 100)}%`}
                canDec={a.fontScale > FONT_SCALE.min + 1e-6}
                canInc={a.fontScale < FONT_SCALE.max - 1e-6}
                onDec={() => onChange({ fontScale: stepFontScale(a.fontScale, -1) })}
                onInc={() => onChange({ fontScale: stepFontScale(a.fontScale, 1) })}
              />
            </Row>
            <Row label="Line spacing">
              <Stepper
                label="Line spacing"
                value={a.lineHeight.toFixed(1)}
                canDec={a.lineHeight > LINE_HEIGHT.min + 1e-6}
                canInc={a.lineHeight < LINE_HEIGHT.max - 1e-6}
                onDec={() => onChange({ lineHeight: stepRange(a.lineHeight, -1, LINE_HEIGHT) })}
                onInc={() => onChange({ lineHeight: stepRange(a.lineHeight, 1, LINE_HEIGHT) })}
              />
            </Row>
            <Row label="Paragraphs">
              <Stepper
                label="Paragraph spacing"
                value={a.paragraphSpacing.toFixed(1)}
                canDec={a.paragraphSpacing > PARAGRAPH_SPACING.min + 1e-6}
                canInc={a.paragraphSpacing < PARAGRAPH_SPACING.max - 1e-6}
                onDec={() => onChange({ paragraphSpacing: stepRange(a.paragraphSpacing, -1, PARAGRAPH_SPACING) })}
                onInc={() => onChange({ paragraphSpacing: stepRange(a.paragraphSpacing, 1, PARAGRAPH_SPACING) })}
              />
            </Row>
            <Row label="Margins">
              <Segmented<NonNullable<ReaderAppearance['margins']>>
                size="small"
                label="Margins"
                value={a.margins}
                onChange={(margins) => onChange({ margins })}
                options={[
                  { value: 'narrow', label: 'Narrow' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'wide', label: 'Wide' },
                ]}
              />
            </Row>
            <Row label="Align">
              <Segmented<NonNullable<ReaderAppearance['align']>>
                size="small"
                label="Align"
                value={a.align}
                onChange={(align) => onChange({ align })}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'justify', label: 'Justify', title: 'Justified text is hyphenated' },
                ]}
              />
            </Row>
          </>
        ) : (
          <>
            <Row label="Fit">
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
            </Row>
            <Row label="Zoom">
              <Stepper
                label="Zoom"
                value={zoomCustom ? `${Math.round(zoom * 100)}%` : 'Fit'}
                canDec={!zoomCustom || zoom > PDF_ZOOM.min + 1e-6}
                canInc={!zoomCustom || zoom < PDF_ZOOM.max - 1e-6}
                onDec={() => onChange({ pdfZoom: stepPdfZoom(zoom, -1) })}
                onInc={() => onChange({ pdfZoom: stepPdfZoom(zoom, 1) })}
              />
            </Row>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, tall, disabled, children }: { label: string; tall?: boolean; disabled?: boolean; children: ReactNode }) {
  const body = disabled ? (
    <div className={styles.disabled} aria-disabled="true" title="Page turns apply to the Pages layout" {...({ inert: '' } as object)}>
      {children}
    </div>
  ) : (
    children
  )
  return (
    <div className={`${styles.row} ${tall ? styles.rowTall : ''}`}>
      <span className={styles.rowLabel}>{label}</span>
      {body}
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
