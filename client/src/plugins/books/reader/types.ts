/**
 * Contract between the Books reader shell (ReaderTile) and the format engines (EPUB, PDF).
 * Engines are pure React components: no plugin context, notes or server API. See docs/specs/books-plugin.md §2.4.
 */

export type BookFormat = 'epub' | 'pdf'

/** One entry of a book's table of contents / PDF outline, flattened in reading order. */
export interface TocItem {
  id: string
  label: string
  /** Opaque target passed back to `ReaderHandle.goTo` (EPUB href, PDF 'page:<n>'). */
  target: string
  /** 0 for top level, 1 for its children, … */
  level: number
}

/** Where the reader is. Emitted on open and on every page / scroll change. */
export interface ReaderLocation {
  /** Opaque, persisted position: an EPUB CFI, or 'page:<n>' (1-based) for PDF. */
  position: string
  /** 0..1 through the whole book. */
  progress: number
  /** Current chapter (EPUB) or outline entry (PDF), when known. */
  chapter: string | null
  /** PDF: 1-based page and total. EPUB: undefined. */
  page?: number
  pageCount?: number
  atStart: boolean
  atEnd: boolean
  /** v2 (EPUB paged): page within the current chapter and the chapter's page count, for the status line. */
  chapterPage?: number
  chapterPages?: number
}

/** 'paper' (default in v2): ink on a warm paper stock derived from the active Velocity theme, with a subtle grain. */
export type ReaderTheme = 'paper' | 'auto' | 'light' | 'sepia' | 'dark'

/** How a page turn is animated in the paged layout (v2). 'none' is used whenever prefers-reduced-motion is set. */
export type PageTurnEffect = 'curl' | 'slide' | 'fade' | 'none'

export interface ReaderAppearance {
  theme: ReaderTheme
  /** EPUB text scale, 0.8..1.6. */
  fontScale: number
  /** EPUB font family. 'publisher' keeps the book's own fonts. */
  fontFamily: 'serif' | 'sans' | 'publisher'
  /** EPUB flow. */
  layout: 'paginated' | 'scrolled'
  /** PDF zoom: a preset or a scale factor (0.5..4). */
  pdfZoom: 'fit-width' | 'fit-page' | number
  // v2 typography and paging (docs/specs/books-reading-experience.md §3). Optional so older stored
  // preferences stay valid; read them through `withAppearanceDefaults`.
  /** Line height, 1.2..2.2. */
  lineHeight?: number
  /** Space between paragraphs in em, 0..1.5. */
  paragraphSpacing?: number
  /** Page margins. */
  margins?: 'narrow' | 'normal' | 'wide'
  /** Text alignment; 'justify' always pairs with hyphenation so there are no rivers. */
  align?: 'left' | 'justify'
  /** Page-turn animation in the paged layout (EPUB and PDF). */
  pageTurn?: PageTurnEffect
}

export const DEFAULT_APPEARANCE: Required<ReaderAppearance> = {
  theme: 'paper',
  fontScale: 1,
  fontFamily: 'serif',
  layout: 'paginated',
  pdfZoom: 'fit-width',
  lineHeight: 1.6,
  paragraphSpacing: 0.6,
  margins: 'normal',
  align: 'left',
  pageTurn: 'slide',
}

/** Fill v2 fields that older stored preferences lack. */
export function withAppearanceDefaults(a: ReaderAppearance): Required<ReaderAppearance> {
  return { ...DEFAULT_APPEARANCE, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) } as Required<ReaderAppearance>
}

/** Highlight colours and styles (Moon+ Reader style). */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange']
export type HighlightStyle = 'highlight' | 'underline' | 'strike' | 'squiggle'

/**
 * A highlight the engine draws (bookmarks are not drawn by engines; the shell shows a ribbon).
 * `locator` is engine-specific and opaque to everyone else:
 *  - EPUB: a CFI range, `epubcfi(/6/4!/4/2,/1:0,/1:42)`
 *  - PDF:  `pdf:` + JSON `{"page":12,"rects":[[x,y,w,h],...]}` with rects normalised 0..1 to the page box
 */
export interface ReaderAnnotation {
  id: string
  locator: string
  color: HighlightColor
  style: HighlightStyle
  /** True when the highlight carries a note (engines may show a small marker). */
  hasNote?: boolean
}

/** Concrete colours the shell resolves from the theme (Auto = Velocity tokens). Engines never read CSS variables. */
export interface ReaderColors {
  background: string
  text: string
  link: string
  /** Selection highlight, with alpha. */
  selection: string
  /** True when the background is dark (PDF pages are then dimmed / inverted). */
  dark: boolean
  /** v2: CSS background-image for the page (the paper grain), or null. Applied over `background`. */
  backgroundImage?: string | null
  /** v2: secondary text for running heads and status (muted ink). */
  muted?: string
  /** v2: fill colour per highlight colour, already tuned for this background (alpha included). */
  highlights?: Record<HighlightColor, string>
}

export interface ReaderSelection {
  text: string
  /** Human label of where it is: chapter name (EPUB) or 'p. 12' (PDF). */
  where: string
  /** Bounding rect of the selection in viewport coordinates, to place the floating quote bar. */
  rect: { x: number; y: number; width: number; height: number }
  /** v2: annotation locator of the selected range (see ReaderAnnotation.locator). */
  locator?: string
  /** v2: progress 0..1 at the start of the selection. */
  progress?: number
  /** v2: PDF page of the selection. */
  page?: number
}

export interface ReaderReadyInfo {
  toc: TocItem[]
  /** PDF page count; EPUB undefined. */
  pageCount?: number
}

export interface ReaderEngineProps {
  /** Absolute URL of the book file (server supports Range requests). */
  url: string
  /** Saved `ReaderLocation.position`, or null for the beginning. */
  initialPosition: string | null
  appearance: ReaderAppearance
  colors: ReaderColors
  onReady: (info: ReaderReadyInfo) => void
  onLocation: (location: ReaderLocation) => void
  /** Non-empty text selection, or null when it is cleared. */
  onSelection: (selection: ReaderSelection | null) => void
  onError: (error: Error) => void
  /** v2: highlights to draw. The engine diffs by id; changes must not move the reading position. */
  annotations?: ReaderAnnotation[]
  /** v2: the user clicked/tapped a drawn highlight (rect in viewport coordinates). */
  onAnnotationClick?: (id: string, rect: ReaderSelection['rect']) => void
  /**
   * v2: a click/tap that is not a selection, link or highlight. Paged layout: left 30% → 'prev', right 30% →
   * 'next', middle → 'center' (the engine turns the page itself for prev/next and still reports it).
   * Scroll layout: always 'center'. The shell toggles its chrome on 'center' (immersive reading).
   */
  onTap?: (zone: 'prev' | 'next' | 'center') => void
}

/** Imperative handle exposed by both engines through `forwardRef`. */
export interface ReaderHandle {
  next(): void
  prev(): void
  /** A `TocItem.target`, a saved `ReaderLocation.position`, or an annotation locator. */
  goTo(target: string): void
  /** Jump to a fraction of the book (0..1), for the progress track. */
  goToProgress(progress: number): void
  /** Move keyboard focus into the reading surface. */
  focus(): void
  /** v2: clear the current text selection inside the book. */
  clearSelection?(): void
}

/** Metadata read from a file at import time (engines export `readEpubMeta` / `readPdfMeta`). */
export interface BookFileMeta {
  title: string | null
  author: string | null
  pageCount: number | null
  /** Cover image (EPUB cover, or PDF page 1 rendered ~600px wide), or null. */
  cover: Blob | null
}
