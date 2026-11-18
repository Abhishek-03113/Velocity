/**
 * EPUB reading surface (epub.js). Pure engine: renders the book into 100% of its parent and reports through
 * the callbacks in `ReaderEngineProps`. All chrome (toolbar, contents, progress bar) belongs to the shell.
 * epub.js is only ever loaded through a dynamic import so it stays out of the main chunk.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type {
  ReaderAppearance,
  ReaderColors,
  ReaderEngineProps,
  ReaderHandle,
  ReaderLocation,
  TocItem,
} from '../types'
import { buildThemeRules, chapterLabelForHref, flattenToc, rulesToCss, type NavLike } from './helpers'
import styles from './EpubView.module.css'

/* ---- Narrow views of the epub.js objects we touch (its d.ts is loose / incomplete). ---- */

interface RenditionLocation {
  start: { cfi: string; href: string }
  end?: { cfi: string }
  atStart: boolean
  atEnd: boolean
}

interface EpubContents {
  document: Document
  window: Window
}

interface EpubLocations {
  length(): number
  generate(chars: number): Promise<unknown>
  load(json: string): unknown
  save(): string
  percentageFromCfi(cfi: string): number
  cfiFromPercentage(p: number): string
}

interface EpubSpineItem {
  href: string
  index: number
}

interface EpubSpine {
  length: number
  get(target: string | number): EpubSpineItem | null
  spineItems?: EpubSpineItem[]
}

interface EpubBook {
  ready: Promise<unknown>
  loaded: { navigation: Promise<{ toc: NavLike[] }> }
  locations: EpubLocations
  spine: EpubSpine
  renderTo(el: HTMLElement, options: Record<string, unknown>): EpubRendition
  destroy(): void
}

interface EpubRendition {
  display(target?: string): Promise<unknown>
  currentLocation(): RenditionLocation | undefined
  next(): Promise<unknown>
  prev(): Promise<unknown>
  resize(): void
  destroy(): void
  on(event: string, cb: (...args: never[]) => void): void
  off(event: string, cb: (...args: never[]) => void): void
  getContents(): EpubContents[] | EpubContents
  hooks: {
    render: { register(cb: (view: { iframe?: HTMLIFrameElement }) => void): void }
    content: { register(cb: (contents: EpubContents) => void): void }
  }
}

type CfiCompare = (a: string, b: string) => number

/**
 * epub.js can land one page early when a saved CFI sits right on a page boundary. After displaying a CFI, step
 * forward while the page it ended up on finishes before the target (at most two pages).
 */
async function displayAt(rendition: EpubRendition, target: string | undefined, compare: CfiCompare | null): Promise<void> {
  await rendition.display(target)
  if (!target || !compare || !target.startsWith('epubcfi(')) return
  for (let i = 0; i < 2; i++) {
    const end = rendition.currentLocation()?.end?.cfi
    if (!end) return
    let behind = false
    try {
      behind = compare(target, end) > 0
    } catch {
      return
    }
    if (!behind) return
    await rendition.next()
  }
}

const STYLE_ID = 'velocity-reader-style'
const LOCATIONS_PREFIX = 'velocity.books.locations.'
const LOCATION_CHARS = 1600

function friendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  if (/404|not found/i.test(raw)) return new Error('The book file could not be found on the server.')
  if (/network|failed to fetch|load failed/i.test(raw)) return new Error('The book could not be downloaded. Check your connection and try again.')
  return new Error(`This file could not be read as an EPUB${raw ? ` (${raw})` : ''}.`)
}

function readCachedLocations(url: string): string | null {
  try {
    return localStorage.getItem(LOCATIONS_PREFIX + url)
  } catch {
    return null
  }
}

function writeCachedLocations(url: string, json: string): void {
  try {
    localStorage.setItem(LOCATIONS_PREFIX + url, json)
  } catch {
    /* quota or storage disabled: locations are just regenerated next time */
  }
}

function asContentsList(c: EpubContents[] | EpubContents): EpubContents[] {
  return Array.isArray(c) ? c : c ? [c] : []
}

/**
 * Book scripts must never run. epub.js creates the iframe with `sandbox="allow-same-origin"` unless
 * `allowScriptedContent` is set; we re-assert that on every render so a future option change can't open it.
 */
function enforceSandbox(iframe: HTMLIFrameElement | undefined): void {
  if (!iframe) return
  const tokens = (iframe.getAttribute('sandbox') ?? '').split(/\s+/).filter((t) => t && t !== 'allow-scripts')
  if (!tokens.includes('allow-same-origin')) tokens.push('allow-same-origin')
  const next = tokens.join(' ')
  if (iframe.getAttribute('sandbox') !== next) iframe.setAttribute('sandbox', next)
}

function applyStyle(contents: EpubContents, css: string): void {
  const doc = contents.document
  if (!doc?.head) return
  let el = doc.getElementById(STYLE_ID)
  if (!el) {
    el = doc.createElement('style')
    el.id = STYLE_ID
    doc.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
}

function cssFor(appearance: ReaderAppearance, colors: ReaderColors): string {
  return rulesToCss(buildThemeRules(appearance, colors))
}

type KeyAction = 'next' | 'prev' | 'start' | 'end'

function keyAction(e: KeyboardEvent, layout: ReaderAppearance['layout']): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
      return 'next'
    case 'ArrowLeft':
    case 'PageUp':
      return 'prev'
    case ' ':
    case 'Spacebar':
      return e.shiftKey ? 'prev' : 'next'
    case 'Home':
      return layout === 'paginated' ? 'start' : null
    case 'End':
      return layout === 'paginated' ? 'end' : null
    default:
      return null // ArrowUp / ArrowDown scroll natively in scrolled mode
  }
}

const EpubView = forwardRef<ReaderHandle, ReaderEngineProps>(function EpubView(props, ref) {
  const { url, appearance, colors } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)

  // Always-current props for long-lived callbacks.
  const propsRef = useRef(props)
  propsRef.current = props

  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<EpubRendition | null>(null)
  const tocRef = useRef<TocItem[]>([])
  const lastLocRef = useRef<RenditionLocation | null>(null)
  const lastCfiRef = useRef<string | null>(null)
  const cfiCompareRef = useRef<CfiCompare | null>(null)
  const locationsReadyRef = useRef(false)
  const readyForUrlRef = useRef<string | null>(null)
  const [book, setBook] = useState<EpubBook | null>(null)

  const chapterFor = useCallback((href: string | undefined): string | null => {
    const b = bookRef.current
    const spineHrefs = b?.spine.spineItems?.map((s) => s.href) ?? []
    return chapterLabelForHref(href, tocRef.current, spineHrefs)
  }, [])

  const emitLocation = useCallback(() => {
    const loc = lastLocRef.current
    const b = bookRef.current
    if (!loc || !b) return
    // epub.js reports atStart/atEnd in scrolled flow as soon as the first/last section is partly visible
    // (every section is one "page"), so confirm them against the scroll position.
    let { atStart, atEnd } = loc
    if (propsRef.current.appearance.layout === 'scrolled') {
      const scroller = mountRef.current?.querySelector<HTMLElement>('.epub-container')
      if (scroller) {
        atStart = atStart && scroller.scrollTop <= 2
        atEnd = atEnd && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      }
    }
    let progress = 0
    if (atEnd) progress = 1
    else if (atStart && !locationsReadyRef.current) progress = 0
    else if (locationsReadyRef.current) {
      try {
        progress = b.locations.percentageFromCfi(loc.start.cfi)
      } catch {
        progress = 0
      }
    } else {
      const idx = b.spine.get(loc.start.href)?.index ?? 0
      progress = b.spine.length > 0 ? idx / b.spine.length : 0
    }
    if (!Number.isFinite(progress)) progress = 0
    lastCfiRef.current = loc.start.cfi
    propsRef.current.onLocation({
      position: loc.start.cfi,
      progress: Math.min(1, Math.max(0, progress)),
      chapter: chapterFor(loc.start.href),
      atStart,
      atEnd,
    } satisfies ReaderLocation)
  }, [chapterFor])

  /* ---- 1. Open the book whenever the URL changes. ---- */
  useEffect(() => {
    let cancelled = false
    let opened: EpubBook | null = null
    lastCfiRef.current = null
    lastLocRef.current = null
    locationsReadyRef.current = false
    tocRef.current = []
    readyForUrlRef.current = null
    setBook(null)

    void (async () => {
      try {
        const { default: ePub, EpubCFI } = await import('epubjs')
        if (cancelled) return
        const cfi = new EpubCFI()
        cfiCompareRef.current = (a, b) => cfi.compare(a, b)
        // The server URL has no .epub extension, so say what it is.
        const b = ePub(url, { openAs: 'epub' }) as unknown as EpubBook
        opened = b
        await b.ready
        if (cancelled) {
          b.destroy()
          opened = null
          return
        }
        bookRef.current = b
        setBook(b)
      } catch (err) {
        if (!cancelled) propsRef.current.onError(friendlyError(err))
      }
    })()

    return () => {
      cancelled = true
      if (opened) {
        try {
          opened.destroy()
        } catch {
          /* already torn down */
        }
      }
      if (bookRef.current === opened) bookRef.current = null
    }
  }, [url])

  /* ---- 2. (Re)create the rendition when the book or the layout changes; the position survives. ---- */
  const layout = appearance.layout
  useEffect(() => {
    const mount = mountRef.current
    if (!book || !mount) return
    let cancelled = false
    const paginated = layout === 'paginated'

    const rendition = book.renderTo(mount, {
      width: '100%',
      height: '100%',
      flow: paginated ? 'paginated' : 'scrolled-doc',
      manager: paginated ? 'default' : 'continuous',
      spread: 'auto',
      minSpreadWidth: 900,
      allowScriptedContent: false,
    })
    renditionRef.current = rendition

    rendition.hooks.render.register((view) => enforceSandbox(view.iframe))
    rendition.hooks.content.register((contents) => {
      const { appearance: a, colors: c } = propsRef.current
      applyStyle(contents, cssFor(a, c))
      const frame = contents.document.defaultView?.frameElement as HTMLIFrameElement | null
      if (frame) frame.style.background = 'transparent'
      contents.document.addEventListener('selectionchange', () => {
        const sel = contents.window.getSelection()
        if (!sel || sel.isCollapsed || !sel.toString().trim()) propsRef.current.onSelection(null)
      })
    })

    const onRelocated = (loc: RenditionLocation) => {
      if (cancelled) return
      lastLocRef.current = loc
      emitLocation()
    }
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(e, propsRef.current.appearance.layout)
      if (!action) return
      e.preventDefault()
      if (action === 'next') void rendition.next()
      else if (action === 'prev') void rendition.prev()
      else if (action === 'start') void rendition.display(book.spine.get(0)?.href)
      else void rendition.display(book.spine.get(book.spine.length - 1)?.href)
    }
    const onSelected = (_range: string, contents: EpubContents) => {
      if (cancelled) return
      const sel = contents.window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!sel || !text || sel.rangeCount === 0) return
      const r = sel.getRangeAt(0).getBoundingClientRect()
      const frame = contents.document.defaultView?.frameElement
      const off = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 }
      propsRef.current.onSelection({
        text,
        where: chapterFor(lastLocRef.current?.start.href) ?? '',
        rect: { x: r.left + off.left, y: r.top + off.top, width: r.width, height: r.height },
      })
    }

    rendition.on('relocated', onRelocated as never)
    rendition.on('keydown', onKey as never)
    rendition.on('selected', onSelected as never)

    const start = lastCfiRef.current ?? propsRef.current.initialPosition ?? undefined
    void (async () => {
      try {
        try {
          await displayAt(rendition, start, cfiCompareRef.current)
        } catch {
          if (start) await rendition.display() // stale / invalid saved position
          else throw new Error('display failed')
        }
        if (cancelled) return
        if (readyForUrlRef.current !== url) {
          readyForUrlRef.current = url
          const nav = await book.loaded.navigation
          if (cancelled) return
          tocRef.current = flattenToc(nav.toc)
          propsRef.current.onReady({ toc: tocRef.current })
          emitLocation() // chapter labels are known now
        }
      } catch (err) {
        if (!cancelled) propsRef.current.onError(friendlyError(err))
      }
    })()

    return () => {
      cancelled = true
      rendition.off('relocated', onRelocated as never)
      rendition.off('keydown', onKey as never)
      rendition.off('selected', onSelected as never)
      if (renditionRef.current === rendition) renditionRef.current = null
      try {
        rendition.destroy()
      } catch {
        /* torn down with the book */
      }
    }
  }, [book, layout, url, emitLocation, chapterFor])

  /* ---- 3. Reading locations (progress), cached per URL, generated in the background. ---- */
  useEffect(() => {
    if (!book) return
    let cancelled = false
    locationsReadyRef.current = false
    const cached = readCachedLocations(url)
    void (async () => {
      try {
        if (cached) {
          book.locations.load(cached)
        } else {
          await book.locations.generate(LOCATION_CHARS)
          if (cancelled) return
          writeCachedLocations(url, book.locations.save())
        }
        if (cancelled) return
        locationsReadyRef.current = true
        emitLocation()
      } catch {
        /* progress stays on the spine-index estimate */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [book, url, emitLocation])

  /* ---- 4. Live appearance: restyle every loaded chapter, then re-measure. ---- */
  const css = cssFor(appearance, colors)
  useEffect(() => {
    const r = renditionRef.current
    if (!r) return
    for (const c of asContentsList(r.getContents())) applyStyle(c, css)
    const t = window.setTimeout(() => {
      try {
        r.resize()
      } catch {
        /* rendition destroyed meanwhile */
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [css, book, layout])

  /* ---- 5. Container resize → re-paginate (debounced). ---- */
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    let timer = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        try {
          renditionRef.current?.resize()
        } catch {
          /* ignore */
        }
      }, 100)
    })
    ro.observe(root)
    return () => {
      window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [])

  /* ---- 6. Keys while the container itself has focus. ---- */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const r = renditionRef.current
    const b = bookRef.current
    if (!r || !b) return
    const action = keyAction(e.nativeEvent, propsRef.current.appearance.layout)
    if (!action) return
    e.preventDefault()
    if (action === 'next') void r.next()
    else if (action === 'prev') void r.prev()
    else if (action === 'start') void r.display(b.spine.get(0)?.href)
    else void r.display(b.spine.get(b.spine.length - 1)?.href)
  }, [])

  useImperativeHandle(
    ref,
    (): ReaderHandle => ({
      next: () => void renditionRef.current?.next(),
      prev: () => void renditionRef.current?.prev(),
      goTo: (target) => {
        void renditionRef.current?.display(target).catch(() => {
          /* unknown target: stay put */
        })
      },
      goToProgress: (p) => {
        const r = renditionRef.current
        const b = bookRef.current
        if (!r || !b) return
        const f = Math.min(1, Math.max(0, p))
        let target: string | undefined
        if (locationsReadyRef.current) {
          try {
            target = b.locations.cfiFromPercentage(f)
          } catch {
            target = undefined
          }
        }
        if (!target && b.spine.length > 0) {
          const idx = Math.min(b.spine.length - 1, Math.floor(f * b.spine.length))
          target = b.spine.get(idx)?.href
        }
        if (target) void r.display(target).catch(() => undefined)
      },
      focus: () => rootRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions),
    }),
    [],
  )

  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={{ background: colors.background }}
      tabIndex={0}
      role="document"
      aria-label="Book"
      onKeyDown={onKeyDown}
    >
      <div ref={mountRef} className={styles.mount} />
    </div>
  )
})

export default EpubView
