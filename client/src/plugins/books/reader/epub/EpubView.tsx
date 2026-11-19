/**
 * EPUB reading surface (epub.js). Pure engine: renders the book into 100% of its parent and reports through
 * the callbacks in `ReaderEngineProps`. All chrome (toolbar, contents, progress bar) belongs to the shell.
 * epub.js is only ever loaded through a dynamic import so it stays out of the main chunk.
 *
 * v2 (docs/specs/books-reading-experience.md §3, §4, §6): paper typography, page-turn effects, continuous
 * scroll, highlights, exact positions.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { withAppearanceDefaults } from '../types'
import type { ReaderAnnotation, ReaderEngineProps, ReaderHandle, ReaderLocation, TocItem } from '../types'
import {
  buildThemeRules,
  chapterLabelForHref,
  computeGeometry,
  createWheelTurner,
  diffAnnotations,
  flattenToc,
  resolvePosition,
  rulesToCss,
  stepToward,
  swipeDirection,
  tapZone,
  TurnQueue,
  type CfiCompare,
  type NavLike,
  type PageGeometry,
  type RestoreState,
  type TurnDir,
} from './helpers'
import { MarksLayer } from './marks'
import { playTurn, takeGhost, warmGhost, type TurnEffect, type TurnEnv } from './turn'
import styles from './EpubView.module.css'

/** How long a mouse tap in a page-turn zone waits for a second click (shared with the PDF engine's value). */
const MOUSE_TAP_DELAY_MS = 180

/* ---- Narrow views of the epub.js objects we touch (its d.ts is loose / incomplete). ---- */

interface LocPoint {
  cfi: string
  href: string
  index: number
  displayed?: { page: number; total: number }
}

interface RenditionLocation {
  start: LocPoint
  end?: LocPoint
  atStart: boolean
  atEnd: boolean
}

interface EpubContents {
  document: Document
  window: Window
  sectionIndex?: number
  range(cfi: string, ignoreClass?: string): Range | null
  on?(event: string, cb: (...args: never[]) => void): void
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
  /** Loads (and caches on the item) the chapter document. */
  load?(request: unknown): Promise<unknown>
}

interface EpubSpine {
  length: number
  get(target: string | number): EpubSpineItem | null
  spineItems?: EpubSpineItem[]
}

interface EpubBook {
  ready: Promise<unknown>
  load?(path: string): Promise<unknown>
  loaded: { navigation: Promise<{ toc: NavLike[] }>; metadata: Promise<{ language?: string }> }
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
  resize(width?: number, height?: number, cfi?: string): void
  destroy(): void
  on(event: string, cb: (...args: never[]) => void): void
  off(event: string, cb: (...args: never[]) => void): void
  getContents(): EpubContents[] | EpubContents
  hooks: {
    render: { register(cb: (view: { iframe?: HTMLIFrameElement }) => void): void }
    content: { register(cb: (contents: EpubContents) => void): void }
  }
}

interface EpubCfiLike {
  spinePos: number
  range?: boolean
  collapse(toStart?: boolean): void
  toString(): string
}
type EpubCfiCtor = new (cfi?: string) => EpubCfiLike

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

const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
    step(n)
  })

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

type KeyAction = 'next' | 'prev' | 'start' | 'end'

function keyAction(e: KeyboardEvent, layout: 'paginated' | 'scrolled'): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key) {
    case 'ArrowRight':
      return layout === 'paginated' ? 'next' : null
    case 'ArrowLeft':
      return layout === 'paginated' ? 'prev' : null
    case 'PageDown':
      return 'next'
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
  const { url, colors } = props
  const appearance = withAppearanceDefaults(props.appearance)
  const layout = appearance.layout
  const paged = layout === 'paginated'

  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)

  // Always-current props for long-lived callbacks.
  const propsRef = useRef(props)
  propsRef.current = props
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance

  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<EpubRendition | null>(null)
  const tocRef = useRef<TocItem[]>([])
  const langRef = useRef('en')
  const lastLocRef = useRef<RenditionLocation | null>(null)
  /** The last position reported (or the one to start from after a rebuild). */
  const lastCfiRef = useRef<string | null>(null)
  const cfiCompareRef = useRef<CfiCompare | null>(null)
  const cfiClassRef = useRef<EpubCfiCtor | null>(null)
  const locationsReadyRef = useRef(false)
  const readyForUrlRef = useRef<string | null>(null)
  const restoreRef = useRef<RestoreState | null>(null)
  const displayingRef = useRef(false)
  const layersRef = useRef(new Set<MarksLayer>())
  const annotationsRef = useRef(new Map<string, ReaderAnnotation>())
  const queueRef = useRef(new TurnQueue())
  const wheelRef = useRef(createWheelTurner())
  const [rebuilds, setRebuilds] = useState(0)
  const rebuiltAtRef = useRef(0)
  /** Where a rebuilt rendition opens (a goTo target that never arrived); otherwise the last good CFI. */
  const rebuildTargetRef = useRef<string | null>(null)
  const scrollWheelRef = useRef({ dy: 0, raf: 0 })
  const coalesceWheelRef = useRef<(e: WheelEvent) => void>(() => undefined)
  const turnRef = useRef<(dir: TurnDir) => void>(() => undefined)
  const [book, setBook] = useState<EpubBook | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  /* ---- Geometry: margins, measure cap, spread ---- */
  const geometry: PageGeometry = useMemo(
    () => computeGeometry(size.w, size.h, { fontScale: appearance.fontScale, margins: appearance.margins }),
    [size.w, size.h, appearance.fontScale, appearance.margins],
  )
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

  const chapterFor = useCallback((href: string | undefined): string | null => {
    const b = bookRef.current
    const spineHrefs = b?.spine.spineItems?.map((s) => s.href) ?? []
    return chapterLabelForHref(href, tocRef.current, spineHrefs)
  }, [])

  const scroller = useCallback((): HTMLElement | null => mountRef.current?.querySelector<HTMLElement>('.epub-container') ?? null, [])

  /**
   * Continuous scroll: epub.js adds and trims chapter views on every scroll event, and a burst of large wheel jumps
   * (a fast trackpad flick, a mouse with free-spinning wheel) can remove a view while it is still being added. So
   * wheel input is summed per animation frame and applied as one step of at most 80 % of the viewport.
   */
  coalesceWheelRef.current = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return // pinch zoom
    e.preventDefault()
    const st = scrollWheelRef.current
    const sc = scroller()
    st.dy += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (sc?.clientHeight ?? 600) : 1)
    if (st.raf) return
    st.raf = requestAnimationFrame(() => {
      st.raf = 0
      const el = scroller()
      const dy = st.dy
      st.dy = 0
      if (!el) return
      const limit = Math.max(200, el.clientHeight * 0.8)
      el.scrollTop += Math.max(-limit, Math.min(limit, dy))
    })
  }

  const compare = useCallback((a: string, b: string): number => (cfiCompareRef.current ? cfiCompareRef.current(a, b) : 0), [])

  /** Point CFI for the start of a (possibly range) CFI. */
  const startOf = useCallback((cfi: string): string => {
    const Ctor = cfiClassRef.current
    if (!Ctor || !cfi.startsWith('epubcfi(')) return cfi
    try {
      const c = new Ctor(cfi)
      if (!c.range) return cfi
      c.collapse(true)
      return c.toString()
    } catch {
      return cfi
    }
  }, [])

  const sectionOf = useCallback((cfi: string): number | null => {
    const Ctor = cfiClassRef.current
    if (!Ctor) return null
    try {
      const n = new Ctor(cfi).spinePos
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }, [])

  const progressFor = useCallback((cfi: string, href?: string): number => {
    const b = bookRef.current
    if (!b) return 0
    if (locationsReadyRef.current) {
      try {
        const p = b.locations.percentageFromCfi(cfi)
        if (Number.isFinite(p)) return p
      } catch {
        /* fall through to the spine estimate */
      }
    }
    const idx = href ? (b.spine.get(href)?.index ?? 0) : (sectionOf(cfi) ?? 0)
    return b.spine.length > 0 ? idx / b.spine.length : 0
  }, [sectionOf])

  const emitLocation = useCallback(() => {
    const loc = lastLocRef.current
    const b = bookRef.current
    if (!loc || !b) return
    const isPaged = appearanceRef.current.layout === 'paginated'

    const resolved = resolvePosition(loc.start.cfi, loc.end?.cfi, restoreRef.current, compare)
    if (!resolved.hold) restoreRef.current = null
    if (resolved.position === null) return // an intermediate step of a restore: never reported
    const position = resolved.position

    let { atStart, atEnd } = loc
    if (!isPaged) {
      // epub.js reports atStart/atEnd in scrolled flow as soon as the first/last section is partly visible,
      // so confirm them against the real scroll position of the continuous container.
      const sc = scroller()
      const lastIndex = b.spine.length - 1
      atStart = loc.start.index === 0 && (sc ? sc.scrollTop <= 2 : true)
      atEnd = (loc.end?.index ?? loc.start.index) >= lastIndex && (sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 : true)
    }
    let progress = 0
    if (atEnd) progress = 1
    else if (atStart && !locationsReadyRef.current) progress = 0
    else progress = progressFor(position, loc.start.href)
    if (!Number.isFinite(progress)) progress = 0

    lastCfiRef.current = position
    const out: ReaderLocation = {
      position,
      progress: Math.min(1, Math.max(0, progress)),
      chapter: chapterFor(loc.start.href),
      atStart,
      atEnd,
    }
    if (isPaged && loc.start.displayed) {
      out.chapterPage = Math.max(1, loc.start.displayed.page)
      out.chapterPages = Math.max(out.chapterPage, loc.start.displayed.total)
    }
    propsRef.current.onLocation(out)
  }, [chapterFor, compare, progressFor, scroller])

  /* ---- Highlights ---- */
  const syncLayers = useCallback((redraw: ReadonlySet<string> | 'all' = new Set()) => {
    for (const layer of [...layersRef.current]) {
      if (!layer.back.isConnected) {
        layersRef.current.delete(layer)
        continue
      }
      layer.sync(annotationsRef.current, propsRef.current.colors, redraw)
    }
  }, [])

  /* ---- Navigation helpers ---- */

  /** Where `target` sits relative to the visible window: here, or one step away. Null when it cannot be told. */
  const whereIs = useCallback(
    (target: string): { step: 'here' | 'next' | 'prev'; deltaY: number } | null => {
      const r = renditionRef.current
      const mount = mountRef.current
      if (!r || !mount) return null
      const idx = sectionOf(target)
      const c = asContentsList(r.getContents()).find((x) => (x.sectionIndex ?? -1) === idx)
      if (!c) return { step: 'next', deltaY: 0 }
      try {
        const range = c.range(target)
        if (!range) return null
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
        const frame = c.document.defaultView?.frameElement as HTMLElement | null
        const f = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 }
        const m = mount.getBoundingClientRect()
        const x = f.left + rect.left
        const y = f.top + rect.top
        const step = stepToward(x, y, { left: m.left, top: m.top, width: m.width, height: m.height }, appearanceRef.current.layout === 'paginated')
        return { step, deltaY: y - m.top }
      } catch {
        return null
      }
    },
    [sectionOf],
  )

  /**
   * epub.js can land one page early when a saved CFI sits right on a page boundary (or a page late after a
   * reflow). After displaying a CFI, check geometrically which page the text is on and step until it is visible
   * (at most three steps). In scroll layout the container is scrolled so the text is near the top.
   */
  const displayAt = useCallback(
    async (rendition: EpubRendition, target: string | undefined): Promise<void> => {
      await rendition.display(target ? startOf(target) : target)
      if (!target || !target.startsWith('epubcfi(')) return
      const point = startOf(target)
      for (let i = 0; i < 3; i++) {
        await frames(2)
        const w = whereIs(point)
        if (!w || w.step === 'here') return
        if (appearanceRef.current.layout === 'scrolled') {
          const sc = scroller()
          if (!sc) return
          sc.scrollTop += w.deltaY - 28
        } else if (w.step === 'next') await rendition.next()
        else await rendition.prev()
      }
    },
    [scroller, startOf, whereIs],
  )

  const beginRestore = useCallback((target: string | null | undefined) => {
    restoreRef.current = target && target.startsWith('epubcfi(') ? { target: startOf(target), settled: null } : null
  }, [startOf])

  const settleRestore = useCallback(async () => {
    await frames(2)
    const r = restoreRef.current
    const loc = lastLocRef.current
    if (r && r.settled === null) r.settled = loc?.start.cfi ?? ''
    emitLocation()
  }, [emitLocation])

  /** Re-measure after something reflowed the text, keeping the first visible text in view. */
  const relayoutState = useRef({ running: false, again: false })
  const relayout = useCallback(() => {
    const st = relayoutState.current
    st.again = true
    if (st.running) return
    st.running = true
    void (async () => {
      while (st.again) {
        st.again = false
        await new Promise((res) => window.setTimeout(res, 60))
        const r = renditionRef.current
        const target = lastCfiRef.current
        if (!r || displayingRef.current) continue
        try {
          beginRestore(target)
          if (target) {
            try {
              r.resize(undefined, undefined, startOf(target))
            } catch {
              /* resize is best effort, displayAt below does the work */
            }
            await displayAt(r, target)
          }
          await settleRestore()
          syncLayers('all')
        } catch {
          /* rendition destroyed meanwhile */
        }
      }
      st.running = false
    })()
  }, [beginRestore, displayAt, settleRestore, startOf, syncLayers])

  /* ---- Page turns ---- */
  // Everything the turn effects need. `key` changes whenever the page's look does, so a warm ghost is rebuilt.
  const turnEnv = useCallback((): TurnEnv | null => {
    const root = rootRef.current
    const stage = stageRef.current
    const layer = layerRef.current
    const mount = mountRef.current
    if (!root || !stage || !layer || !mount) return null
    const colors = propsRef.current.colors
    return {
      root,
      stage,
      layer,
      mount,
      background: colors.background,
      backgroundImage: colors.backgroundImage ?? null,
      key: `${JSON.stringify(appearanceRef.current)}|${colors.background}|${colors.text}`,
    }
  }, [])

  const turnOnce = useCallback(
    async (dir: TurnDir): Promise<void> => {
      const r = renditionRef.current
      if (!r) return
      const loc = lastLocRef.current
      if (loc && ((dir === 'next' && loc.atEnd) || (dir === 'prev' && loc.atStart))) return
      const effect: TurnEffect = prefersReducedMotion() ? 'none' : (appearanceRef.current.pageTurn as TurnEffect)
      const env = turnEnv()
      const ghost = effect !== 'none' && env ? takeGhost(env) : null
      const before = lastCfiRef.current
      try {
        await (dir === 'next' ? r.next() : r.prev())
      } catch {
        /* nothing to turn to */
      }
      if (!ghost) return
      await frames(2) // epub.js reports the new location on a frame; let it land and paint
      if (!env || effect === 'none' || lastCfiRef.current === before) {
        ghost.dispose()
        return
      }
      await playTurn(effect, dir, ghost, env)
    },
    [turnEnv],
  )

  const turn = useCallback(
    async (dir: TurnDir): Promise<void> => {
      const r = renditionRef.current
      if (!r) return
      if (appearanceRef.current.layout === 'scrolled') {
        const sc = scroller()
        if (sc) sc.scrollBy({ top: (dir === 'next' ? 1 : -1) * Math.round(sc.clientHeight * 0.88), behavior: 'smooth' })
        return
      }
      const q = queueRef.current
      if (q.request(dir) === 'queued') return
      let cur: TurnDir | null = dir
      while (cur) {
        try {
          await turnOnce(cur)
        } catch {
          /* a failed turn must not wedge the queue */
        }
        cur = q.done()
      }
    },
    [scroller, turnOnce],
  )
  turnRef.current = (dir) => void turn(dir)

  /* ---- 1. Open the book whenever the URL changes. ---- */
  useEffect(() => {
    let cancelled = false
    let opened: EpubBook | null = null
    lastCfiRef.current = null
    lastLocRef.current = null
    locationsReadyRef.current = false
    restoreRef.current = null
    tocRef.current = []
    readyForUrlRef.current = null
    setBook(null)

    void (async () => {
      try {
        const { default: ePub, EpubCFI } = await import('epubjs')
        if (cancelled) return
        const cfi = new EpubCFI()
        cfiCompareRef.current = (a, b) => cfi.compare(a, b)
        cfiClassRef.current = EpubCFI as unknown as EpubCfiCtor
        // The server URL has no .epub extension, so say what it is.
        const b = ePub(url, { openAs: 'epub' }) as unknown as EpubBook
        opened = b
        await b.ready
        if (cancelled) {
          b.destroy()
          opened = null
          return
        }
        try {
          const md = await b.loaded.metadata
          langRef.current = (md.language || 'en').trim() || 'en'
        } catch {
          langRef.current = 'en'
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

  /* ---- Size of the tile (drives margins, measure cap, spread). Measured before first paint. ---- */
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const w = Math.round(root.clientWidth)
      const h = Math.round(root.clientHeight)
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  /* ---- 2. (Re)create the rendition when the book, the layout or the page margin changes; the position survives. ---- */
  const gap = paged ? geometry.gap : 0
  const measured = size.w > 0
  useEffect(() => {
    const mount = mountRef.current
    if (!book || !mount || !measured) return
    let cancelled = false
    const isPaged = layout === 'paginated'

    // A previous rendition whose destroy() threw half-way (epub.js does while a display is still in flight, e.g. when
    // the tile is resized in steps) leaves its container and iframe behind, visible next to the new one.
    mount.replaceChildren()

    const layers = layersRef.current
    const rendition = book.renderTo(mount, {
      width: '100%',
      height: '100%',
      flow: isPaged ? 'paginated' : 'scrolled',
      manager: isPaged ? 'default' : 'continuous',
      spread: 'auto',
      minSpreadWidth: 900,
      gap: isPaged ? gap : undefined,
      allowScriptedContent: false,
    })
    renditionRef.current = rendition
    displayingRef.current = true
    // epub.js attaches asynchronously. A rendition that was torn down before it finished attaching still appends its
    // container (and iframe) to the mount afterwards, next to the live one: drop every container that is not ours.
    const liveContainer = () => (rendition as unknown as { manager?: { container?: Element } }).manager?.container
    const strayWatch = new MutationObserver(() => {
      const keep = liveContainer()
      if (!keep) return
      mount.querySelectorAll(':scope > .epub-container').forEach((el) => {
        if (el !== keep) el.remove()
      })
    })
    strayWatch.observe(mount, { childList: true })

    rendition.hooks.render.register((view) => enforceSandbox(view.iframe))
    rendition.hooks.content.register((contents) => {
      const { appearance: ap, colors: c } = propsRef.current
      const g = geometryRef.current
      applyStyle(contents, rulesToCss(buildThemeRules(ap, c, g)))
      const doc = contents.document
      const win = contents.window
      const root = doc.documentElement
      if (!root.getAttribute('lang') && !root.getAttribute('xml:lang')) root.setAttribute('lang', langRef.current)
      const frame = doc.defaultView?.frameElement as HTMLIFrameElement | null
      if (frame) {
        frame.style.background = 'transparent'
        // A transparent iframe only stays transparent when its colour scheme equals its document's (light). In a dark
        // app the frame would otherwise inherit `dark` and be painted with an opaque white canvas.
        frame.style.colorScheme = 'light'
      }

      let layer: MarksLayer | null = null
      if (frame) {
        layer = new MarksLayer(contents, frame, sectionOf)
        layersRef.current.add(layer)
        layer.sync(annotationsRef.current, c, 'all')
      }

      doc.addEventListener('selectionchange', () => {
        const sel = win.getSelection()
        if (!sel || sel.isCollapsed || !sel.toString().trim()) propsRef.current.onSelection(null)
      })

      // Reflow inside the chapter (fonts, images, our own style changes) moves the marks.
      if (typeof ResizeObserver !== 'undefined' && layer) {
        let t = 0
        const ro = new ResizeObserver(() => {
          window.clearTimeout(t)
          t = window.setTimeout(() => layer && layer.back.isConnected && layer.sync(annotationsRef.current, propsRef.current.colors, 'all'), 80)
        })
        ro.observe(root)
      }

      /* -- taps, highlights, links -- */
      let suppressClickUntil = 0
      // A mouse page-turn tap waits a moment: a double or triple click selects a word / paragraph instead (as in the PDF
      // engine), so the first click of one must not turn the page away from the text being selected.
      let tapTimer = 0
      doc.addEventListener('mousedown', () => window.clearTimeout(tapTimer))
      doc.addEventListener('click', (e: MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
        window.clearTimeout(tapTimer)
        if (e.detail > 1) return
        if (performance.now() < suppressClickUntil) return
        const sel = win.getSelection()
        if (sel && !sel.isCollapsed && sel.toString().trim()) return
        const target = e.target as Element | null
        if (target?.closest?.('a[href]')) return
        const hit = layer && layer.hit(e.clientX, e.clientY)
        const f = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 }
        if (layer && hit) {
          const b = layer.boundsOf(hit)
          propsRef.current.onAnnotationClick?.(hit, {
            x: f.left + (b?.left ?? e.clientX),
            y: f.top + (b?.top ?? e.clientY),
            width: b?.width ?? 0,
            height: b?.height ?? 0,
          })
          return
        }
        const rootEl = rootRef.current
        if (!rootEl) return
        const rr = rootEl.getBoundingClientRect()
        const zone = tapZone(f.left + e.clientX - rr.left, rr.width, appearanceRef.current.layout === 'paginated')
        if (zone === 'center') {
          propsRef.current.onTap?.(zone)
          return
        }
        const fire = () => {
          const picked = win.getSelection()
          if (picked && !picked.isCollapsed && picked.toString().trim()) return
          turnRef.current(zone)
          propsRef.current.onTap?.(zone)
        }
        if ((e as PointerEvent).pointerType === 'mouse') tapTimer = window.setTimeout(fire, MOUSE_TAP_DELAY_MS)
        else fire()
      })

      // Pointer cursor over highlights.
      if (layer) {
        let over = false
        doc.addEventListener('mousemove', (e: MouseEvent) => {
          const now = !!layer.hit(e.clientX, e.clientY)
          if (now !== over) {
            over = now
            root.style.cursor = now ? 'pointer' : ''
          }
        })
      }

      /* -- swipe (touch / pen) -- */
      let down: { x: number; y: number } | null = null
      doc.addEventListener('pointerdown', (e: PointerEvent) => {
        down = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }
      })
      doc.addEventListener('pointerup', (e: PointerEvent) => {
        const d = down
        down = null
        if (!d || appearanceRef.current.layout !== 'paginated') return
        const dir = swipeDirection(e.clientX - d.x, e.clientY - d.y)
        if (dir) {
          suppressClickUntil = performance.now() + 400
          turnRef.current(dir)
        }
      })
      doc.addEventListener('pointercancel', () => {
        down = null
      })

      /* -- trackpad horizontal scroll -- */
      doc.addEventListener(
        'wheel',
        (e: WheelEvent) => {
          if (appearanceRef.current.layout !== 'paginated') {
            coalesceWheelRef.current(e)
            return
          }
          // Paged: the wheel turns pages on either axis (nothing in a page scrolls).
          if (e.ctrlKey) return
          e.preventDefault()
          const dir = wheelRef.current.push(e.deltaX, e.deltaY, performance.now())
          if (dir) turnRef.current(dir)
        },
        { passive: false },
      )
    })

    const onRelocated = (loc: RenditionLocation) => {
      if (cancelled) return
      lastLocRef.current = loc
      emitLocation()
      scheduleWarmup()
    }
    // After each move, while the reader is idle: parse the neighbouring chapters (a turn across a chapter boundary
    // then renders from memory instead of waiting on a load) and prepare the page-turn ghost for this page.
    let warmTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleWarmup = () => {
      if (warmTimer) clearTimeout(warmTimer)
      warmTimer = setTimeout(() => {
        warmTimer = null
        if (cancelled) return
        const env = turnEnv()
        if (env && appearanceRef.current.layout === 'paginated' && appearanceRef.current.pageTurn !== 'none') warmGhost(env)
        const b = bookRef.current
        const at = lastLocRef.current?.start?.index
        if (!b?.load || typeof at !== 'number') return
        for (const i of [at + 1, at - 1]) {
          const item = i >= 0 && i < b.spine.length ? b.spine.get(i) : null
          item?.load?.(b.load.bind(b))?.catch(() => undefined)
        }
      }, 120)
    }
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(e, appearanceRef.current.layout)
      if (!action) {
        // Keys the engine does not use (B, H, Esc, any key that should show the chrome) happened inside the book's
        // iframe, where the shell cannot see them: re-dispatch them on the engine container so they bubble to it.
        if (!e.defaultPrevented) {
          rootRef.current?.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: e.key,
              code: e.code,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
              repeat: e.repeat,
              bubbles: true,
              cancelable: true,
            }),
          )
        }
        return
      }
      e.preventDefault()
      if (action === 'next') turnRef.current('next')
      else if (action === 'prev') turnRef.current('prev')
      else if (action === 'start') void rendition.display(book.spine.get(0)?.href)
      else void rendition.display(book.spine.get(book.spine.length - 1)?.href)
    }
    const onSelected = (cfiRange: string, contents: EpubContents) => {
      if (cancelled) return
      const sel = contents.window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!sel || !text || sel.rangeCount === 0) return
      const r = sel.getRangeAt(0).getBoundingClientRect()
      const frame = contents.document.defaultView?.frameElement
      const off = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 }
      const href = book.spine.get(sectionOf(cfiRange) ?? 0)?.href
      propsRef.current.onSelection({
        text,
        where: chapterFor(href) ?? chapterFor(lastLocRef.current?.start.href) ?? '',
        rect: { x: r.left + off.left, y: r.top + off.top, width: r.width, height: r.height },
        locator: cfiRange,
        progress: Math.min(1, Math.max(0, progressFor(startOf(cfiRange), href))),
      })
    }

    // epub.js can throw from inside its scroll handler when its views get out of step (removeChild / insertBefore on a
    // node that is no longer a child). The manager is then unusable, so rebuild the rendition at the last good place.
    const recover = (message: string) => {
      if (cancelled || !/removeChild|insertBefore|not a child/i.test(message)) return
      if (Date.now() - rebuiltAtRef.current < 1500) return
      rebuiltAtRef.current = Date.now()
      setRebuilds((n) => n + 1)
    }
    const onWindowError = (e: ErrorEvent) => recover(e.message || String(e.error ?? ''))
    const onRejection = (e: PromiseRejectionEvent) => recover(String((e.reason as Error | undefined)?.message ?? e.reason ?? ''))
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onRejection)

    rendition.on('relocated', onRelocated as never)
    rendition.on('keydown', onKey as never)
    rendition.on('selected', onSelected as never)

    const start = rebuildTargetRef.current ?? lastCfiRef.current ?? propsRef.current.initialPosition ?? undefined
    rebuildTargetRef.current = null
    beginRestore(start)
    void (async () => {
      try {
        try {
          await displayAt(rendition, start)
        } catch {
          restoreRef.current = null
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
        }
        await settleRestore() // also reports the location once chapter labels are known
      } catch (err) {
        if (!cancelled) propsRef.current.onError(friendlyError(err))
      } finally {
        if (!cancelled) displayingRef.current = false
      }
    })()

    return () => {
      cancelled = true
      displayingRef.current = false
      strayWatch.disconnect()
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onRejection)
      rendition.off('relocated', onRelocated as never)
      if (warmTimer) clearTimeout(warmTimer)
      rendition.off('keydown', onKey as never)
      rendition.off('selected', onSelected as never)
      layers.clear()
      if (renditionRef.current === rendition) renditionRef.current = null
      try {
        rendition.destroy()
      } catch {
        /* torn down with the book */
      }
    }
    // The first-paint appearance reaches new chapters through propsRef; later changes go through effect 4.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, layout, gap, measured, url, rebuilds])

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

  /* ---- 4. Live appearance: restyle every loaded chapter; reflow keeps the first visible text. ---- */
  const css = rulesToCss(buildThemeRules(appearance, colors, geometry))
  const layoutKey = [
    appearance.fontScale,
    appearance.fontFamily,
    appearance.lineHeight,
    appearance.paragraphSpacing,
    appearance.margins,
    appearance.align,
    geometry.textWidth,
    geometry.mountWidth,
    geometry.margin,
  ].join('|')
  const cssRef = useRef(css)
  cssRef.current = css
  const appliedRef = useRef<{ layoutKey: string; layout: string } | null>(null)
  useEffect(() => {
    const r = renditionRef.current
    if (!r) return
    for (const c of asContentsList(r.getContents())) applyStyle(c, css)
    const prev = appliedRef.current
    appliedRef.current = { layoutKey, layout }
    if (!prev || prev.layout !== layout) return // fresh rendition: it displays from the saved position anyway
    if (prev.layoutKey !== layoutKey) relayout()
    else syncLayers('all') // colours only: the highlight palette follows
  }, [css, layoutKey, layout, relayout, syncLayers, book])

  /**
   * The tile is resized in steps (the zoom animation, dragging a split): once it has stopped changing, restyle every
   * chapter with the final geometry and re-measure, so no chapter keeps the margins of an intermediate width.
   */
  const settleSize = useRef({ w: size.w, h: size.h })
  useEffect(() => {
    if (settleSize.current.w === size.w && settleSize.current.h === size.h) return
    settleSize.current = { w: size.w, h: size.h }
    const timer = window.setTimeout(() => {
      const r = renditionRef.current
      if (!r) return
      for (const c of asContentsList(r.getContents())) applyStyle(c, cssRef.current)
      relayout()
    }, 220)
    return () => window.clearTimeout(timer)
  }, [size.w, size.h, relayout])

  /* ---- 5. Highlights: diff by id, never move the position. ---- */
  const annotations = props.annotations
  useEffect(() => {
    const next = annotations ?? []
    const diff = diffAnnotations(annotationsRef.current, next)
    annotationsRef.current = new Map(next.map((a) => [a.id, a]))
    syncLayers(new Set(diff.update.map((a) => a.id)))
  }, [annotations, syncLayers])

  /* ---- 6. Container resize → re-paginate, same first visible text (debounced). ---- */
  const mountWidth = paged ? geometry.mountWidth : 0
  useEffect(() => {
    const mount = mountRef.current
    if (!mount || typeof ResizeObserver === 'undefined') return
    let first = true
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false // the observer's initial callback is not a resize
        return
      }
      relayout()
    })
    ro.observe(mount)
    return () => ro.disconnect()
  }, [relayout, book, layout, mountWidth])

  /* ---- 7. Keys and trackpad while the container itself has focus / hover. ---- */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const r = renditionRef.current
    const b = bookRef.current
    if (!r || !b) return
    const action = keyAction(e.nativeEvent, appearanceRef.current.layout)
    if (!action) return
    e.preventDefault()
    if (action === 'next') turnRef.current('next')
    else if (action === 'prev') turnRef.current('prev')
    else if (action === 'start') void r.display(b.spine.get(0)?.href)
    else void r.display(b.spine.get(b.spine.length - 1)?.href)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (appearanceRef.current.layout !== 'paginated') {
        coalesceWheelRef.current(e)
        return
      }
      if (e.ctrlKey) return
      e.preventDefault()
      const dir = wheelRef.current.push(e.deltaX, e.deltaY, performance.now())
      if (dir) turnRef.current(dir)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  /**
   * Continuous scroll only: a goTo that did not arrive (epub.js lost track of its views after a burst of scrolling)
   * rebuilds the rendition at the target instead of leaving the reader stuck.
   */
  const verifyArrival = useCallback(
    async (target: string) => {
      await new Promise((res) => window.setTimeout(res, 900))
      if (appearanceRef.current.layout !== 'scrolled' || !renditionRef.current) return
      let arrived: boolean
      if (target.startsWith('epubcfi(')) {
        const w = whereIs(startOf(target))
        arrived = !!w && w.step === 'here'
      } else {
        const base = (h: string) => h.split('#')[0].split('/').pop() ?? h
        const at = lastLocRef.current?.start.href
        arrived = !!at && base(at) === base(target)
      }
      if (arrived || Date.now() - rebuiltAtRef.current < 1500) return
      rebuiltAtRef.current = Date.now()
      rebuildTargetRef.current = target
      setRebuilds((n) => n + 1)
    },
    [startOf, whereIs],
  )

  useImperativeHandle(
    ref,
    (): ReaderHandle => ({
      next: () => turnRef.current('next'),
      prev: () => turnRef.current('prev'),
      goTo: (target) => {
        const r = renditionRef.current
        if (!r) return
        // Not awaited with the display below: a wedged epub.js manager never settles that promise.
        if (appearanceRef.current.layout === 'scrolled') void verifyArrival(target)
        void (async () => {
          try {
            if (target.startsWith('epubcfi(')) {
              beginRestore(target)
              await displayAt(r, target)
              await settleRestore()
            } else {
              restoreRef.current = null
              await r.display(target)
            }
          } catch {
            /* unknown target: stay put */
          }
        })()
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
        if (!target) return
        restoreRef.current = null
        void r.display(target).catch(() => undefined)
      },
      focus: () => rootRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions),
      clearSelection: () => {
        const r = renditionRef.current
        if (!r) return
        for (const c of asContentsList(r.getContents())) {
          try {
            c.window.getSelection()?.removeAllRanges()
          } catch {
            /* frame gone */
          }
        }
        propsRef.current.onSelection(null)
      },
    }),
    [beginRestore, displayAt, settleRestore, verifyArrival],
  )

  const stageStyle = paged ? { padding: `${geometry.padTop}px 0 ${geometry.padBottom}px` } : undefined
  const mountStyle = paged && size.w > 0 ? { width: geometry.mountWidth } : undefined
  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={{ backgroundColor: colors.background, backgroundImage: colors.backgroundImage ?? undefined }}
      tabIndex={0}
      role="document"
      aria-label="Book"
      onKeyDown={onKeyDown}
    >
      <div ref={stageRef} className={styles.stage} style={stageStyle}>
        <div ref={mountRef} className={styles.mount} style={mountStyle} />
      </div>
      <div ref={layerRef} className={styles.layer} />
    </div>
  )
})

export default EpubView
