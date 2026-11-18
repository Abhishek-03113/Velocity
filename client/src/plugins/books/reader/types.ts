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
}

export type ReaderTheme = 'auto' | 'light' | 'sepia' | 'dark'

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
}

export const DEFAULT_APPEARANCE: ReaderAppearance = {
  theme: 'auto',
  fontScale: 1,
  fontFamily: 'serif',
  layout: 'paginated',
  pdfZoom: 'fit-width',
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
}

export interface ReaderSelection {
  text: string
  /** Human label of where it is: chapter name (EPUB) or 'p. 12' (PDF). */
  where: string
  /** Bounding rect of the selection in viewport coordinates, to place the floating quote bar. */
  rect: { x: number; y: number; width: number; height: number }
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
}

/** Imperative handle exposed by both engines through `forwardRef`. */
export interface ReaderHandle {
  next(): void
  prev(): void
  /** A `TocItem.target` or a saved `ReaderLocation.position`. */
  goTo(target: string): void
  /** Jump to a fraction of the book (0..1), for the progress track. */
  goToProgress(progress: number): void
  /** Move keyboard focus into the reading surface. */
  focus(): void
}

/** Metadata read from a file at import time (engines export `readEpubMeta` / `readPdfMeta`). */
export interface BookFileMeta {
  title: string | null
  author: string | null
  pageCount: number | null
  /** Cover image (EPUB cover, or PDF page 1 rendered ~600px wide), or null. */
  cover: Blob | null
}
