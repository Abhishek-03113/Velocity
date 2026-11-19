/**
 * PDF reading surface (pdf.js). Pure engine that fills its parent; the shell draws toolbar, contents and progress.
 * Two layouts share one page machinery (docs/specs/books-reading-experience.md §3.1):
 *  - scrolled: a virtualised column of lazily rendered pages,
 *  - paginated: one fitted page, turned with Curl / Slide / Fade / None; the next two and previous page prefetched,
 *    and a turn waits for its destination's paint so it never reveals a blank page.
 * Highlights are drawn as an overlay between canvas and text layer from `pdf:` locators.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import { withAppearanceDefaults } from '../types'
import type { ReaderAnnotation, ReaderEngineProps, ReaderHandle, ReaderLocation, TocItem } from '../types'
import {
  PAGE_PADDING,
  chapterForPage,
  comparePosition,
  computeLayout,
  currentPage,
  flattenOutline,
  formatPosition,
  isAtBottom,
  pageBlend,
  pageFilter,
  pageIndexAt,
  parsePdfPosition,
  progressAt,
  renderWindow,
  resolveScale,
  roundFrac,
  scrollTopForProgress,
  type OutlineNode,
  type PageLayout,
  type PdfPosition,
  type PdfZoom,
  type Size,
} from './helpers'
import {
  DEFAULT_HIGHLIGHTS_DARK,
  DEFAULT_HIGHLIGHTS_LIGHT,
  formatLocator,
  hitRect,
  parseLocator,
  selectionRects,
  solidColor,
  squiggleImage,
  sketchImage,
  curlyImage,
  type Rect,
} from './highlights'
import {
  IDLE_QUEUE,
  centrePage,
  enqueueTurn,
  finishTurn,
  firstVisible,
  fractionInPage,
  isHorizontalWheel,
  pagedSheet,
  scrollTopForPosition,
  swipeDirection,
  tapZone,
  type TurnQueue,
} from './paged'
import { loadPdfjs, type PdfjsLib } from './pdfjs'
import styles from './pdf.module.css'

/** Upper bound for one canvas, so a 400 % zoom on a large page cannot exhaust GPU memory. */
const MAX_CANVAS_PIXELS = 16_777_216
const RESIZE_DEBOUNCE_MS = 120
const EASE = 'cubic-bezier(.2,.8,.2,1)'
const SLIDE_MS = 220
const FADE_MS = 140
const CURL_MS = 520
const CURL_EASE = 'cubic-bezier(.4,.1,.2,1)'
/** A mouse click in a turn zone waits this long so a double click (select word) does not turn pages. */
const MOUSE_TAP_DELAY_MS = 180
const TAP_SLOP_PX = 8

type Mode = 'paged' | 'scroll'

interface Slot {
  el: HTMLDivElement
  annots: HTMLDivElement
  key: string
  gen: number
  page: PDFPageProxy | null
  canvas: HTMLCanvasElement | null
  text: HTMLDivElement | null
  task: RenderTask | null
  textLayer: TextLayer | null
  /** Settles once the latest render put its canvas on the page (or gave up). */
  painted: Promise<void> | null
}

interface DrawnAnnotation {
  ann: ReaderAnnotation
  rects: Rect[]
}

interface Controller extends ReaderHandle {
  refit(): void
  applyAppearance(): void
  applyAnnotations(): void
  clearSelection(): void
}

function friendlyError(err: unknown): Error {
  const e = err as { name?: string; message?: string } | null
  switch (e?.name) {
    case 'PasswordException':
      return new Error('This PDF is password-protected')
    case 'MissingPDFException':
      return new Error('This PDF could not be found')
    case 'InvalidPDFException':
      return new Error('This file is not a valid PDF')
    case 'UnexpectedResponseException':
      return new Error('The server could not deliver this PDF')
    default:
      return new Error(e?.message ? `This PDF could not be opened: ${e.message}` : 'This PDF could not be opened')
  }
}

const px = (n: number) => `${n}px`
const pct = (n: number) => `${Math.round(n * 100000) / 1000}%`

const PdfView = forwardRef<ReaderHandle, ReaderEngineProps>(function PdfView(props, ref) {
  const { url, colors } = props
  const appearance = withAppearanceDefaults(props.appearance)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const ctlRef = useRef<Controller | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  useImperativeHandle(
    ref,
    () => ({
      next: () => ctlRef.current?.next(),
      prev: () => ctlRef.current?.prev(),
      goTo: (target) => ctlRef.current?.goTo(target),
      goToProgress: (p) => ctlRef.current?.goToProgress(p),
      focus: () => scrollerRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions),
      clearSelection: () => ctlRef.current?.clearSelection(),
    }),
    [],
  )

  // Load the document and run the page engine. Everything stateful lives in this closure.
  useEffect(() => {
    const scrollerEl = scrollerRef.current
    const sheetEl = sheetRef.current
    if (!scrollerEl || !sheetEl) return
    const scroller: HTMLDivElement = scrollerEl
    const sheet: HTMLDivElement = sheetEl

    let disposed = false
    let lib: PdfjsLib | null = null
    let loadingTask: PDFDocumentLoadingTask | null = null
    let doc: PDFDocumentProxy | null = null
    let base: Size[] = []
    let known: boolean[] = []
    let slots: Slot[] = []
    let layout: PageLayout = { tops: [], heights: [], total: 0 }
    let sheetWidth = 0
    let scale = 1
    let toc: TocItem[] = []
    let ready = false
    let pendingPage: number | null = null
    let raf = 0
    let resizeTimer = 0
    let selTimer = 0
    let tapTimer = 0
    let hasSelection = false
    let lastEmit = ''
    /** After a restore no earlier position is emitted until the user interacts. */
    let guard: PdfPosition | null = null
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    // Paged state.
    const modeOf = (): Mode => (withAppearanceDefaults(propsRef.current.appearance).layout === 'paginated' ? 'paged' : 'scroll')
    let mode: Mode = modeOf()
    let pageIdx = 0
    let curTop = 0
    let curHeight = 0
    let sheetHeight = 0
    let queue: TurnQueue = IDLE_QUEUE
    let turning = false
    let turnFrom = -1
    let turnToken = 0
    let cancelEffect: (() => void) | null = null

    // Highlight state.
    let hits = new Map<number, DrawnAnnotation[]>()
    const drawnSig = new Map<number, string>()

    const viewW = () => scroller.clientWidth || 800
    const viewH = () => scroller.clientHeight || 600
    const count = () => slots.length
    const paged = () => mode === 'paged'
    /** Scroll layout: the page the viewer is reading (line at 35 % of the viewport); used for relative navigation. */
    const currentIdx = () => (pendingPage ?? currentPage(layout, scroller.scrollTop, viewH())) - 1
    const pagedZoom = (): PdfZoom => {
      const z = withAppearanceDefaults(propsRef.current.appearance).pdfZoom
      return z === 'fit-width' ? 'fit-page' : z
    }
    const zoom = (): PdfZoom => withAppearanceDefaults(propsRef.current.appearance).pdfZoom

    const scaleFor = (i: number): number =>
      paged() ? resolveScale(pagedZoom(), base[i] ?? base[0], { width: viewW(), height: viewH() }) : scale
    const keyFor = (i: number, dpr: number) => `${scaleFor(i).toFixed(4)}@${dpr}`

    // --- layout -------------------------------------------------------------------------------------------------

    /** Scroll layout. `anchor` pins the viewport to a position instead of preserving the current scroll. */
    function layoutAll(anchor?: PdfPosition) {
      const hadLayout = layout.tops.length > 0
      let keep: PdfPosition | null = anchor ?? null
      if (!keep && hadLayout) {
        const idx = pageIndexAt(layout.tops, scroller.scrollTop)
        keep = { page: idx + 1, frac: layout.heights[idx] > 0 ? (scroller.scrollTop - layout.tops[idx]) / layout.heights[idx] : 0 }
      }
      const oldCenter = !anchor && sheetWidth > 0 ? (scroller.scrollLeft + viewW() / 2) / sheetWidth : 0.5

      layout = computeLayout(base, scale)
      const maxW = base.reduce((m, s) => Math.max(m, s.width), 0) * scale
      sheetWidth = Math.max(viewW(), maxW + PAGE_PADDING * 2)
      sheetHeight = layout.total
      sheet.style.width = px(sheetWidth)
      sheet.style.height = px(layout.total)
      slots.forEach((s, i) => {
        const w = base[i].width * scale
        s.el.style.top = px(layout.tops[i])
        s.el.style.left = px((sheetWidth - w) / 2)
        s.el.style.width = px(w)
        s.el.style.height = px(layout.heights[i])
        s.el.style.setProperty('--scale-factor', String(scale))
      })

      if (keep) {
        const i = Math.min(layout.tops.length - 1, Math.max(0, keep.page - 1))
        scroller.scrollTop = layout.tops[i] + Math.min(1, Math.max(0, keep.frac)) * layout.heights[i]
        scroller.scrollLeft = Math.max(0, oldCenter * sheetWidth - viewW() / 2)
      }
    }

    /** Paged layout: the sheet fits the current page (or exceeds the viewport when taller); current ±1 are centred in it. */
    function layoutPaged(frozen = -1) {
      if (base.length === 0) return
      const i = Math.min(base.length - 1, Math.max(0, pageIdx))
      const view = { width: viewW(), height: viewH() }
      const sc = scaleFor(i)
      const box = pagedSheet({ width: base[i].width * sc, height: base[i].height * sc }, view)
      sheetWidth = box.sheetWidth
      sheetHeight = box.sheetHeight
      sheet.style.width = px(box.sheetWidth)
      sheet.style.height = px(box.sheetHeight)
      for (let j = Math.max(0, i - 1); j <= Math.min(base.length - 1, i + 1); j++) {
        if (j === frozen) continue
        const s = scaleFor(j)
        const size = { width: base[j].width * s, height: base[j].height * s }
        const at = centrePage(box, size)
        const el = slots[j].el
        el.style.left = px(at.left)
        el.style.top = px(at.top)
        el.style.width = px(size.width)
        el.style.height = px(size.height)
        el.style.setProperty('--scale-factor', String(s))
        if (j === i) {
          curTop = at.top
          curHeight = size.height
        }
      }
    }

    function applyVisibility() {
      slots.forEach((s, i) => {
        if (!paged()) {
          s.el.style.display = ''
          s.el.style.visibility = ''
          return
        }
        s.el.style.display = Math.abs(i - pageIdx) <= 1 || i === turnFrom ? '' : 'none'
        s.el.style.visibility = i === pageIdx || i === turnFrom ? 'visible' : 'hidden'
      })
    }

    function computeScale(page: number): number {
      const size = base[Math.min(Math.max(page - 1, 0), Math.max(0, base.length - 1))] ?? base[0]
      if (!size) return 1
      return resolveScale(zoom(), size, { width: viewW(), height: viewH() })
    }

    /** The current page is taller than the viewport and can scroll inside the sheet. */
    const scrollablePage = () => sheetHeight > viewH() + 1

    function pagedScrollTop(frac: number): number {
      return scrollablePage() && frac > 0 ? curTop + Math.min(1, frac) * curHeight : 0
    }

    function refit() {
      if (!doc || slots.length === 0) return
      if (paged()) {
        const keep = getPos()
        layoutPaged(turning ? turnFrom : -1)
        scroller.scrollTop = pagedScrollTop(keep.frac)
      } else {
        const next = computeScale(getPos().page)
        if (Math.abs(next - scale) > 0.0005) scale = next
        layoutAll()
      }
      update()
      emitLocation()
    }

    // --- page rendering -----------------------------------------------------------------------------------------

    function release(s: Slot) {
      s.gen++
      s.key = ''
      s.task?.cancel()
      s.task = null
      s.textLayer?.cancel()
      s.textLayer = null
      if (s.canvas) {
        s.canvas.width = 0
        s.canvas.height = 0
        s.canvas.remove()
        s.canvas = null
      }
      s.text?.remove()
      s.text = null
      s.page?.cleanup()
      s.page = null
    }

    async function renderSlot(i: number, dpr: number) {
      const s = slots[i]
      if (!doc || !lib) return
      const gen = ++s.gen
      s.key = keyFor(i, dpr)
      s.task?.cancel()
      s.textLayer?.cancel()
      let markPainted: () => void = () => undefined
      s.painted = new Promise<void>((resolve) => {
        markPainted = resolve
      })
      try {
        const page = s.page ?? (await doc.getPage(i + 1))
        if (disposed || gen !== s.gen) return
        s.page = page

        // The first estimate used page 1's size; correct this page when it differs.
        const v1 = page.getViewport({ scale: 1 })
        if (!known[i] || Math.abs(base[i].width - v1.width) > 0.5 || Math.abs(base[i].height - v1.height) > 0.5) {
          known[i] = true
          if (Math.abs(base[i].width - v1.width) > 0.5 || Math.abs(base[i].height - v1.height) > 0.5) {
            base[i] = { width: v1.width, height: v1.height }
            if (paged()) layoutPaged(turning ? turnFrom : -1)
            else layoutAll()
            s.key = keyFor(i, dpr)
          }
        }

        const viewport = page.getViewport({ scale: scaleFor(i) })
        let out = dpr
        while (viewport.width * viewport.height * out * out > MAX_CANVAS_PIXELS && out > 0.25) out *= 0.9
        const canvas = document.createElement('canvas')
        canvas.className = styles.canvas
        canvas.width = Math.max(1, Math.floor(viewport.width * out))
        canvas.height = Math.max(1, Math.floor(viewport.height * out))
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return
        const task = page.render({
          canvasContext: ctx,
          viewport,
          transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined,
        })
        s.task = task
        try {
          await task.promise
        } catch {
          // Cancelled (zoom, scroll away) or a broken page: leave the previous canvas, if any.
          canvas.width = 0
          canvas.height = 0
          return
        }
        if (disposed || gen !== s.gen) {
          canvas.width = 0
          canvas.height = 0
          return
        }
        if (s.canvas) {
          s.canvas.width = 0
          s.canvas.height = 0
          s.canvas.remove()
        }
        s.el.insertBefore(canvas, s.el.firstChild)
        s.canvas = canvas
        markPainted()

        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        const tl = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport })
        s.textLayer = tl
        await tl.render()
        if (disposed || gen !== s.gen) return
        s.text?.remove()
        s.el.appendChild(textDiv)
        s.text = textDiv
      } catch {
        /* a cancelled or failed page render is not user-facing */
      } finally {
        markPainted()
      }
    }

    function update() {
      if (!doc || slots.length === 0) return
      const dpr = window.devicePixelRatio || 1
      if (paged()) {
        const wanted: number[] = []
        // The page, then the next two (reading forward) and the previous one: a turn reveals a page already painted.
        for (const i of [pageIdx, pageIdx + 1, pageIdx - 1, pageIdx + 2, turnFrom]) if (i >= 0 && i < slots.length && !wanted.includes(i)) wanted.push(i)
        slots.forEach((s, i) => {
          if (!wanted.includes(i) && s.key !== '') release(s)
        })
        for (const i of wanted) if (slots[i].key !== keyFor(i, dpr)) void renderSlot(i, dpr)
        return
      }
      const [a, b] = renderWindow(layout, scroller.scrollTop, viewH())
      const center = currentIdx()
      const wanted: number[] = []
      for (let i = 0; i < slots.length; i++) {
        if (i >= a && i <= b) wanted.push(i)
        else if (slots[i].key !== '') release(slots[i])
      }
      wanted.sort((x, y) => Math.abs(x - center) - Math.abs(y - center))
      for (const i of wanted) if (slots[i].key !== keyFor(i, dpr)) void renderSlot(i, dpr)
    }

    // --- location -----------------------------------------------------------------------------------------------

    /** First visible text: page and fraction of it scrolled past the top of the viewport. */
    function getPos(): PdfPosition {
      if (slots.length === 0) return { page: 1, frac: 0 }
      if (paged()) return { page: pageIdx + 1, frac: fractionInPage(scroller.scrollTop, curTop, curHeight) }
      if (pendingPage !== null) return { page: pendingPage, frac: 0 }
      return firstVisible(layout, scroller.scrollTop)
    }

    function emitLocation(force = false) {
      if (!ready || slots.length === 0) return
      const top = scroller.scrollTop
      const h = viewH()
      const pos = getPos()
      const frac = paged() && !scrollablePage() ? 0 : roundFrac(pos.frac)
      if (guard && comparePosition({ page: pos.page, frac }, guard) < 0) return

      let progress: number
      let page: number
      let atStart: boolean
      let atEnd: boolean
      if (paged()) {
        page = pos.page
        const bottom = top + h >= sheetHeight - 2
        atEnd = page === count() && bottom
        atStart = page === 1 && frac === 0
        progress = atEnd ? 1 : Math.min(1, (page - 1 + frac) / count())
      } else {
        page = Math.min(count(), Math.max(1, pendingPage ?? currentPage(layout, top, h)))
        atEnd = isAtBottom(layout, top, h) || (page === count() && top + h >= layout.tops[page - 1] + layout.heights[page - 1])
        atStart = pos.page === 1 && top <= layout.tops[0] + 2
        progress = progressAt(layout, pos.page, top, h)
      }
      const loc: ReaderLocation = {
        position: formatPosition(pos.page, frac),
        progress,
        chapter: chapterForPage(toc, page),
        page,
        pageCount: count(),
        atStart,
        atEnd,
      }
      const sig = `${loc.position}|${loc.progress.toFixed(4)}|${loc.chapter}|${loc.page}|${loc.atStart}|${loc.atEnd}`
      if (!force && sig === lastEmit) return
      lastEmit = sig
      propsRef.current.onLocation(loc)
    }

    function onScroll() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
        emitLocation()
      })
    }

    /** The viewer acted (key, pointer, wheel, command): positions may move freely again. */
    const interacted = () => {
      guard = null
    }

    // --- navigation: scroll layout ------------------------------------------------------------------------------

    const behavior = (): ScrollBehavior => (reduceMotion.matches ? 'auto' : 'smooth')

    function scrollToPage(page: number, smooth: boolean) {
      if (slots.length === 0) return
      const p = Math.min(count(), Math.max(1, Math.round(page)))
      pendingPage = p
      scroller.scrollTo({ top: layout.tops[p - 1], behavior: smooth ? behavior() : 'auto' })
      update()
      emitLocation()
    }

    // --- navigation: paged layout -------------------------------------------------------------------------------

    /** Show page `idx` at once (no animation): jumps, commands, layout switches. */
    function jumpTo(idx: number, frac = 0, ensureY?: number) {
      if (slots.length === 0) return
      endTurnNow()
      pageIdx = Math.min(count() - 1, Math.max(0, idx))
      layoutPaged()
      applyVisibility()
      scroller.scrollTop = ensureY !== undefined && scrollablePage() ? Math.max(0, curTop + ensureY * curHeight - viewH() * 0.25) : pagedScrollTop(frac)
      update()
      emitLocation()
    }

    let waitToken = 0
    function turnBy(dir: -1 | 1) {
      if (!ready || !paged()) return
      const step = enqueueTurn(queue, dir)
      queue = step.queue
      if (step.run) startTurn(step.run)
    }

    function startTurn(dir: -1 | 1, waited = false) {
      const target = pageIdx + dir
      if (target < 0 || target >= count()) {
        const next = finishTurn(queue)
        queue = next.queue
        if (next.run) startTurn(next.run)
        return
      }
      // Never animate onto a blank page: when the destination has no canvas yet (a fast run of turns outran the
      // prefetch), wait for its paint, at most a quarter second, then turn.
      const dest = slots[target]
      if (!waited && dest && !dest.canvas) {
        const dpr = window.devicePixelRatio || 1
        if (dest.key !== keyFor(target, dpr)) void renderSlot(target, dpr)
        const token = waitToken
        void Promise.race([dest.painted ?? Promise.resolve(), new Promise((r) => setTimeout(r, 260))]).then(() => {
          if (!disposed && token === waitToken) startTurn(dir, true)
        })
        return
      }
      const from = pageIdx
      pageIdx = target
      turnFrom = from
      turning = true
      layoutPaged(from)
      applyVisibility()
      scroller.scrollTop = 0
      update()
      emitLocation()
      const token = ++turnToken
      const effect = reduceMotion.matches ? 'none' : withAppearanceDefaults(propsRef.current.appearance).pageTurn
      if (effect === 'none') {
        endTurn(token)
        return
      }
      scroller.classList.add(styles.animating)
      const run = runEffect(effect, from, target, dir)
      cancelEffect = run.cancel
      void run.done.then(() => endTurn(token))
    }

    function endTurn(token: number) {
      if (token !== turnToken || !turning) return
      cancelEffect?.()
      cancelEffect = null
      scroller.classList.remove(styles.animating)
      turning = false
      turnFrom = -1
      applyVisibility()
      layoutPaged()
      update()
      const next = finishTurn(queue)
      queue = next.queue
      if (next.run) startTurn(next.run)
    }

    /** Finish a running turn immediately and drop the queue. */
    function endTurnNow() {
      waitToken++
      queue = IDLE_QUEUE
      if (!turning) return
      endTurn(turnToken)
      queue = IDLE_QUEUE
    }

    function runEffect(effect: 'curl' | 'slide' | 'fade', from: number, to: number, dir: 1 | -1): { done: Promise<void>; cancel: () => void } {
      const out = slots[from].el
      const inn = slots[to].el
      const anims: Animation[] = []
      const cleanups: Array<() => void> = []
      const play = (el: Element, keyframes: Keyframe[], duration: number, easing = EASE) => {
        const a = el.animate(keyframes, { duration, easing, fill: 'both' })
        anims.push(a)
        return a
      }

      if (effect === 'slide') {
        const w = viewW()
        play(out, [{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * w}px)` }], SLIDE_MS)
        play(inn, [{ transform: `translateX(${dir * w}px)` }, { transform: 'translateX(0)' }], SLIDE_MS)
      } else if (effect === 'fade') {
        inn.style.zIndex = '2'
        cleanups.push(() => {
          inn.style.zIndex = ''
        })
        play(inn, [{ opacity: 0 }, { opacity: 1 }], FADE_MS, 'ease')
      } else {
        curl(out, inn, dir, play, cleanups)
      }

      const duration = effect === 'curl' ? CURL_MS : effect === 'slide' ? SLIDE_MS : FADE_MS
      const done = new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, duration + 120)
        void Promise.all(anims.map((a) => a.finished)).then(
          () => {
            window.clearTimeout(t)
            resolve()
          },
          () => {
            window.clearTimeout(t)
            resolve()
          },
        )
      })
      return {
        done,
        cancel: () => {
          anims.forEach((a) => a.cancel())
          cleanups.forEach((c) => c())
        },
      }
    }

    /** Curl: the outgoing page (already a bitmap) becomes a leaf that rotates around the spine over the revealed page. */
    function curl(
      out: HTMLDivElement,
      inn: HTMLDivElement,
      dir: 1 | -1,
      play: (el: Element, keyframes: Keyframe[], duration: number, easing?: string) => Animation,
      cleanups: Array<() => void>,
    ) {
      void inn
      const stage = document.createElement('div')
      stage.className = styles.curlStage
      stage.style.left = out.style.left
      stage.style.top = out.style.top
      stage.style.width = out.style.width
      stage.style.height = out.style.height

      // Shadow cast on the page being revealed.
      const shade = document.createElement('div')
      shade.className = styles.curlShade
      const spine = dir > 0 ? 'left' : 'right'
      shade.style.background = `linear-gradient(to ${dir > 0 ? 'right' : 'left'}, rgba(0,0,0,0.38), rgba(0,0,0,0.12) 38%, transparent 70%)`
      void spine

      const leaf = document.createElement('div')
      leaf.className = styles.leaf
      leaf.style.transformOrigin = dir > 0 ? 'left center' : 'right center'

      const front = document.createElement('div')
      front.className = styles.leafFront
      const copy = out.cloneNode(true) as HTMLDivElement
      copy.querySelector('.textLayer')?.remove()
      copy.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;display:block;visibility:visible;box-shadow:none;`
      const from = out.querySelector('canvas')
      const to = copy.querySelector('canvas')
      if (from && to) to.getContext('2d')?.drawImage(from, 0, 0)
      const gloss = document.createElement('div')
      gloss.className = styles.leafGloss
      if (dir < 0) gloss.style.right = '0'
      const dim = document.createElement('div')
      dim.className = styles.leafDim
      front.append(copy, gloss, dim)

      const back = document.createElement('div')
      back.className = styles.leafBack
      leaf.append(front, back)
      stage.append(shade, leaf)
      sheet.appendChild(stage)
      out.style.visibility = 'hidden'
      cleanups.push(() => stage.remove())

      const rot = dir > 0 ? -180 : 180
      play(
        leaf,
        [
          { transform: 'rotateY(0deg)', opacity: 1, offset: 0 },
          { transform: `rotateY(${rot * 0.5}deg)`, opacity: 1, offset: 0.5 },
          { opacity: 1, offset: 0.82 },
          { transform: `rotateY(${rot}deg)`, opacity: 0, offset: 1 },
        ],
        CURL_MS,
        CURL_EASE,
      )
      // Past 90 degrees the back of the leaf takes over from the front (same easing, so the swap is exactly edge-on).
      play(front, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.499 }, { opacity: 0, offset: 0.5 }, { opacity: 0, offset: 1 }], CURL_MS, CURL_EASE)
      play(back, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.499 }, { opacity: 1, offset: 0.5 }, { opacity: 1, offset: 1 }], CURL_MS, CURL_EASE)
      play(shade, [{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], CURL_MS, CURL_EASE)
      const sweep = dir > 0 ? [-30, 200] : [30, -200]
      play(gloss, [{ transform: `translateX(${sweep[0]}%)`, opacity: 0.9 }, { transform: `translateX(${sweep[1]}%)`, opacity: 0 }], CURL_MS, CURL_EASE)
      play(dim, [{ opacity: 0 }, { opacity: 0.9 }], CURL_MS, CURL_EASE)
    }

    // --- controller ---------------------------------------------------------------------------------------------

    const controller: Controller = {
      next() {
        interacted()
        if (paged()) return turnBy(1)
        const cur = currentIdx() + 1
        if (cur >= count()) scroller.scrollTo({ top: layout.total, behavior: behavior() })
        else scrollToPage(cur + 1, true)
      },
      prev() {
        interacted()
        if (paged()) return turnBy(-1)
        scrollToPage(Math.max(1, currentIdx()), true)
      },
      goTo(target) {
        if (slots.length === 0) return
        interacted()
        const loc = parseLocator(target)
        if (loc) {
          const first = loc.rects[0]
          if (paged()) return jumpTo(loc.page - 1, 0, first?.[1])
          pendingPage = null
          const p = Math.min(count(), Math.max(1, loc.page))
          const y = first ? scrollTopForPosition(layout, p, first[1]) - viewH() * 0.25 : layout.tops[p - 1]
          scroller.scrollTop = Math.max(Math.min(y, layout.tops[p - 1] + layout.heights[p - 1] - 1), layout.tops[p - 1] - PAGE_PADDING)
          update()
          emitLocation()
          return
        }
        const pos = parsePdfPosition(target)
        if (!pos) return
        if (paged()) return jumpTo(pos.page - 1, pos.frac)
        pendingPage = null
        const p = Math.min(count(), pos.page)
        scroller.scrollTop = scrollTopForPosition(layout, p, pos.frac)
        update()
        emitLocation()
      },
      goToProgress(progress) {
        if (slots.length === 0) return
        interacted()
        const p = Math.min(1, Math.max(0, progress))
        if (paged()) return jumpTo(p >= 1 ? count() - 1 : Math.floor(p * count()))
        pendingPage = null
        scroller.scrollTop = scrollTopForProgress(layout, progress, viewH())
        update()
        emitLocation()
      },
      focus() {
        scroller.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
      },
      clearSelection() {
        window.getSelection()?.removeAllRanges()
        window.clearTimeout(selTimer)
        reportSelection()
      },
      refit,
      applyAppearance,
      applyAnnotations,
    }
    ctlRef.current = controller

    /** Layout or zoom changed in the props: keep the page and the offset inside it. */
    function applyAppearance() {
      const next = modeOf()
      if (!ready || !doc) {
        mode = next
        return
      }
      if (next === mode) {
        refit()
        return
      }
      const pos = getPos()
      endTurnNow()
      pendingPage = null
      guard = null
      mode = next
      slots.forEach((s) => {
        s.el.style.transform = ''
        s.el.style.opacity = ''
        s.el.style.zIndex = ''
      })
      if (paged()) {
        pageIdx = pos.page - 1
        layoutPaged()
        applyVisibility()
        scroller.scrollTop = pagedScrollTop(pos.frac)
      } else {
        scale = computeScale(pos.page)
        applyVisibility()
        layoutAll(pos)
      }
      lastEmit = ''
      update()
      emitLocation(true)
    }

    // --- highlights ---------------------------------------------------------------------------------------------

    function drawPage(page: number, items: DrawnAnnotation[]) {
      const slot = slots[page - 1]
      if (!slot) return
      const c = propsRef.current.colors
      const palette = c.highlights ?? (c.dark ? DEFAULT_HIGHLIGHTS_DARK : DEFAULT_HIGHLIGHTS_LIGHT)
      const nodes: HTMLElement[] = []
      for (const { ann, rects } of items) {
        const fill = palette[ann.color]
        const solid = solidColor(fill)
        rects.forEach((r, k) => {
          const box = document.createElement('div')
          box.dataset.annotation = ann.id
          const set = (cls: string, css: Partial<CSSStyleDeclaration>) => {
            box.className = cls
            Object.assign(box.style, css)
          }
          const left = pct(r[0])
          const width = pct(r[2])
          switch (ann.style) {
            case 'underline':
              set(styles.line, { left, width, top: `calc(${pct(r[1] + r[3])} - 2px)`, background: solid })
              break
            case 'strike':
              set(styles.line, { left, width, top: `calc(${pct(r[1] + r[3] / 2)} - 1px)`, background: solid })
              break
            case 'squiggle':
              set(styles.squiggle, { left, width, top: `calc(${pct(r[1] + r[3])} - 3px)`, backgroundImage: squiggleImage(solid) })
              break
            case 'double':
              set(styles.double, { left, width, top: `calc(${pct(r[1] + r[3])} - 3px)`, borderColor: solid })
              break
            case 'dotted':
            case 'dashed':
              set(styles.dashed, { left, width, top: `calc(${pct(r[1] + r[3])} - 2px)`, borderColor: solid, borderTopStyle: ann.style })
              break
            case 'sketch':
              set(styles.sketch, { left, width, top: `calc(${pct(r[1] + r[3])} - 4px)`, backgroundImage: sketchImage(solid, k + ann.id.length) })
              break
            case 'curly':
              set(styles.curly, { left, width, top: `calc(${pct(r[1] + r[3])} - 2px)`, backgroundImage: curlyImage(solid) })
              break
            default:
              set(styles.hl, { left, top: pct(r[1]), width, height: pct(r[3]), background: fill })
          }
          nodes.push(box)
          if (ann.hasNote && k === rects.length - 1) {
            const mark = document.createElement('div')
            mark.className = styles.noteMark
            Object.assign(mark.style, { left: pct(r[0] + r[2]), top: pct(r[1]), background: solid })
            nodes.push(mark)
          }
        })
      }
      slot.annots.replaceChildren(...nodes)
    }

    /** Diff the `annotations` prop by id and redraw only the pages whose overlay changed. Canvases are untouched. */
    function applyAnnotations() {
      if (slots.length === 0) return
      const c = propsRef.current.colors
      const next = new Map<number, DrawnAnnotation[]>()
      for (const ann of propsRef.current.annotations ?? []) {
        const loc = parseLocator(ann.locator)
        if (!loc || loc.page > count() || loc.rects.length === 0) continue
        const list = next.get(loc.page) ?? []
        list.push({ ann, rects: loc.rects })
        next.set(loc.page, list)
      }
      const palette = c.highlights ? Object.values(c.highlights).join('|') : c.dark ? 'dark' : 'light'
      const pages = new Set<number>([...next.keys(), ...drawnSig.keys()])
      for (const p of pages) {
        const items = next.get(p) ?? []
        const sig = items.length === 0 ? '' : `${palette}#${items.map((x) => `${x.ann.id}:${x.ann.locator}:${x.ann.color}:${x.ann.style}:${x.ann.hasNote ? 1 : 0}`).join(';')}`
        if ((drawnSig.get(p) ?? '') === sig) continue
        drawPage(p, items)
        if (sig) drawnSig.set(p, sig)
        else drawnSig.delete(p)
      }
      hits = next
    }

    /** The annotation under a viewport point, with the rect it was hit at. */
    function annotationAt(x: number, y: number, target: EventTarget | null): { id: string; rect: DOMRect } | null {
      const pageEl = (target instanceof Element ? target : null)?.closest<HTMLElement>('[data-page]')
      if (!pageEl) return null
      const items = hits.get(Number(pageEl.dataset.page))
      if (!items?.length) return null
      const box = pageEl.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return null
      const nx = (x - box.left) / box.width
      const ny = (y - box.top) / box.height
      for (let n = items.length - 1; n >= 0; n--) {
        const k = hitRect(items[n].rects, nx, ny)
        if (k < 0) continue
        const r = items[n].rects[k]
        return { id: items[n].ann.id, rect: new DOMRect(box.left + r[0] * box.width, box.top + r[1] * box.height, r[2] * box.width, r[3] * box.height) }
      }
      return null
    }

    // --- input --------------------------------------------------------------------------------------------------

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || slots.length === 0) return
      interacted()
      let handled = true
      const pageDownKey = e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)
      const pageUpKey = e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)
      if (paged() && (pageDownKey || pageUpKey) && scrollablePage()) {
        // A page taller than the viewport scrolls first, then turns.
        const top = scroller.scrollTop
        const atBottom = top + viewH() >= sheetHeight - 2
        if (pageDownKey && !atBottom) scroller.scrollBy({ top: viewH() * 0.9, behavior: behavior() })
        else if (pageUpKey && top > 2) scroller.scrollBy({ top: -viewH() * 0.9, behavior: behavior() })
        else if (pageDownKey) turnBy(1)
        else turnBy(-1)
        e.preventDefault()
        return
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          controller.next()
          break
        case ' ':
          if (e.shiftKey) controller.prev()
          else controller.next()
          break
        case 'ArrowLeft':
        case 'PageUp':
          controller.prev()
          break
        case 'ArrowDown':
        case 'ArrowUp':
          if (paged() && !scrollablePage()) turnBy(e.key === 'ArrowDown' ? 1 : -1)
          else {
            pendingPage = null
            handled = false
          }
          break
        case 'Home':
          if (paged()) jumpTo(0)
          else {
            pendingPage = null
            scroller.scrollTo({ top: 0, behavior: 'auto' })
            update()
            emitLocation()
          }
          break
        case 'End':
          if (paged()) jumpTo(count() - 1)
          else {
            pendingPage = null
            scroller.scrollTo({ top: layout.total, behavior: 'auto' })
            update()
            emitLocation()
          }
          break
        default:
          handled = false
      }
      if (handled) e.preventDefault()
    }

    // Wheel: scroll layout just clears the smooth-scroll target; paged turns on horizontal gestures (and on vertical ones
    // when the page fits), one turn per gesture even through trackpad inertia.
    let wheelLocked = false
    let lastWheel = 0
    let wheelAcc = 0
    function onWheel(e: WheelEvent) {
      interacted()
      if (!paged()) {
        pendingPage = null
        return
      }
      const horizontal = isHorizontalWheel(e.deltaX, e.deltaY)
      if (!horizontal && scrollablePage()) {
        // A zoomed page scrolls first; past its top or bottom edge, the wheel turns the page.
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
        const atTop = scroller.scrollTop <= 0
        if (!((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop))) return
      }
      if (e.ctrlKey) return
      e.preventDefault()
      const now = performance.now()
      if (now - lastWheel > 180) {
        wheelLocked = false
        wheelAcc = 0
      }
      lastWheel = now
      if (wheelLocked) return
      wheelAcc += horizontal ? e.deltaX : e.deltaY
      if (Math.abs(wheelAcc) < 40) return
      wheelLocked = true
      turnBy(wheelAcc > 0 ? 1 : -1)
      wheelAcc = 0
    }

    interface PointerStart {
      x: number
      y: number
      type: string
      hadSelection: boolean
    }
    let down: PointerStart | null = null
    const selectionInside = () => {
      const sel = window.getSelection()
      return !!sel && sel.rangeCount > 0 && !sel.isCollapsed && scroller.contains(sel.getRangeAt(0).commonAncestorContainer)
    }

    function onPointerDown(e: PointerEvent) {
      interacted()
      pendingPage = null
      window.clearTimeout(tapTimer)
      if (e.pointerType === 'mouse' && e.button !== 0) {
        down = null
        return
      }
      down = { x: e.clientX, y: e.clientY, type: e.pointerType, hadSelection: selectionInside() || hasSelection }
    }

    function onPointerUp(e: PointerEvent) {
      const d = down
      down = null
      if (!d || !ready) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (paged() && d.type !== 'mouse' && !selectionInside()) {
        const swipe = swipeDirection(dx, dy)
        if (swipe) {
          turnBy(swipe === 'next' ? 1 : -1)
          return
        }
      }
      if (Math.hypot(dx, dy) > TAP_SLOP_PX) return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('a, button, input, textarea')) return
      // A highlight under the pointer wins over selection state: it opens the shell's toolbar for it.
      const hit = annotationAt(e.clientX, e.clientY, e.target)
      if (hit) {
        propsRef.current.onAnnotationClick?.(hit.id, { x: hit.rect.x, y: hit.rect.y, width: hit.rect.width, height: hit.rect.height })
        return
      }
      if (d.hadSelection || selectionInside()) return
      const zone = paged() ? tapZone(e.clientX - scroller.getBoundingClientRect().left, scroller.clientWidth) : 'center'
      if (zone === 'center') {
        propsRef.current.onTap?.('center')
        return
      }
      const fire = () => {
        if (selectionInside()) return
        turnBy(zone === 'next' ? 1 : -1)
        propsRef.current.onTap?.(zone)
      }
      if (e.pointerType === 'mouse') tapTimer = window.setTimeout(fire, MOUSE_TAP_DELAY_MS)
      else fire()
    }

    function reportSelection() {
      const sel = window.getSelection()
      const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null
      const text = range ? sel!.toString().trim() : ''
      const inside = range ? scroller.contains(range.commonAncestorContainer) : false
      const node = range?.startContainer
      const textLayer = (node instanceof Element ? node : node?.parentElement)?.closest('.textLayer')
      if (!range || !inside || !text || !textLayer) {
        if (hasSelection) {
          hasSelection = false
          propsRef.current.onSelection(null)
        }
        return
      }
      const pageEl = textLayer.closest<HTMLElement>('[data-page]')
      const page = pageEl ? Number(pageEl.dataset.page) : getPos().page
      const r = range.getBoundingClientRect()
      let locator: string | undefined
      let progress: number | undefined
      if (pageEl) {
        const b = pageEl.getBoundingClientRect()
        const rects = selectionRects(
          Array.from(range.getClientRects()).map((c) => ({ left: c.left, top: c.top, width: c.width, height: c.height })),
          { left: b.left, top: b.top, width: b.width, height: b.height },
        )
        if (rects.length > 0) {
          locator = formatLocator(page, rects)
          progress = Math.min(1, (page - 1 + rects[0][1]) / Math.max(1, count()))
        }
      }
      hasSelection = true
      propsRef.current.onSelection({
        text,
        where: `p. ${page}`,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        locator,
        progress,
        page,
      })
    }

    const onSelectionChange = () => {
      window.clearTimeout(selTimer)
      selTimer = window.setTimeout(reportSelection, 120)
    }
    const onMouseUp = () => {
      window.clearTimeout(selTimer)
      selTimer = window.setTimeout(reportSelection, 0)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('keydown', onKeyDown)
    scroller.addEventListener('wheel', onWheel, { passive: false })
    scroller.addEventListener('touchstart', interacted, { passive: true })
    scroller.addEventListener('pointerdown', onPointerDown)
    scroller.addEventListener('pointerup', onPointerUp)
    scroller.addEventListener('pointercancel', () => (down = null))
    scroller.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onSelectionChange)
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(refit, RESIZE_DEBOUNCE_MS)
    })
    ro.observe(scroller)

    // --- open the document --------------------------------------------------------------------------------------

    async function resolveDest(dest: OutlineNode['dest']): Promise<number | null> {
      if (!doc || !dest) return null
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(d) || d.length === 0) return null
      const ref = d[0]
      if (typeof ref === 'number') return ref + 1
      if (ref && typeof ref === 'object') return (await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
      return null
    }

    void (async () => {
      try {
        lib = await loadPdfjs()
        if (disposed) return
        loadingTask = lib.getDocument({
          url,
          rangeChunkSize: 65536,
          disableAutoFetch: true,
          isEvalSupported: false,
          enableXfa: false,
        })
        const opened = await loadingTask.promise
        if (disposed) {
          void opened.destroy()
          return
        }
        doc = opened
        const first = await doc.getPage(1)
        if (disposed) return
        const v = first.getViewport({ scale: 1 })
        const n = doc.numPages
        base = Array.from({ length: n }, () => ({ width: v.width, height: v.height }))
        known = Array.from({ length: n }, (_, i) => i === 0)
        slots = base.map((_, i) => {
          const el = document.createElement('div')
          el.className = styles.page
          el.dataset.page = String(i + 1)
          el.setAttribute('aria-label', `Page ${i + 1}`)
          const annots = document.createElement('div')
          annots.className = styles.annots
          el.appendChild(annots)
          sheet.appendChild(el)
          return { el, annots, key: '', gen: 0, page: null, canvas: null, text: null, task: null, textLayer: null, painted: null }
        })

        mode = modeOf()
        const start = parsePdfPosition(propsRef.current.initialPosition) ?? { page: 1, frac: 0 }
        const startPage = Math.min(n, start.page)
        if (paged()) {
          pageIdx = startPage - 1
          layoutPaged()
          applyVisibility()
          scroller.scrollTop = pagedScrollTop(start.frac)
        } else {
          scale = computeScale(startPage)
          layoutAll({ page: startPage, frac: start.frac })
        }
        guard = { page: startPage, frac: paged() && !scrollablePage() ? 0 : roundFrac(start.frac) }
        applyAnnotations()
        update()

        let items: TocItem[] = []
        try {
          items = await flattenOutline((await doc.getOutline()) as OutlineNode[] | null, resolveDest)
        } catch {
          items = []
        }
        if (disposed) return
        toc = items
        ready = true
        propsRef.current.onReady({ toc, pageCount: n })
        emitLocation(true)
      } catch (err) {
        if (!disposed) propsRef.current.onError(friendlyError(err))
      }
    })()

    return () => {
      disposed = true
      ctlRef.current = null
      turnToken++
      cancelEffect?.()
      cancelAnimationFrame(raf)
      window.clearTimeout(resizeTimer)
      window.clearTimeout(selTimer)
      window.clearTimeout(tapTimer)
      ro.disconnect()
      scroller.classList.remove(styles.animating)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('keydown', onKeyDown)
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', interacted)
      scroller.removeEventListener('pointerdown', onPointerDown)
      scroller.removeEventListener('pointerup', onPointerUp)
      scroller.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      slots.forEach(release)
      sheet.replaceChildren()
      sheet.style.width = ''
      sheet.style.height = ''
      void loadingTask?.destroy()
    }
  }, [url])

  // Layout and zoom changes apply live to the open document and keep the page.
  useEffect(() => {
    ctlRef.current?.applyAppearance()
  }, [appearance.layout, appearance.pdfZoom])

  // Highlights: redraw the overlay only (never the canvases).
  useEffect(() => {
    ctlRef.current?.applyAnnotations()
  }, [props.annotations, colors.highlights, colors.dark])

  const style = {
    '--pdf-bg': colors.background,
    '--pdf-bg-image': colors.backgroundImage ?? 'none',
    '--pdf-paper': colors.dark ? `color-mix(in srgb, ${colors.background} 92%, white)` : `color-mix(in srgb, ${colors.background} 72%, white)`,
    '--pdf-filter': pageFilter(colors),
    '--pdf-blend': pageBlend(colors),
    '--pdf-hl-blend': colors.dark ? 'screen' : 'multiply',
    '--pdf-selection': colors.selection,
  } as CSSProperties

  return (
    <div
      ref={scrollerRef}
      className={appearance.layout === 'paginated' ? `${styles.scroller} ${styles.paged}` : styles.scroller}
      style={style}
      tabIndex={0}
      role="document"
      aria-label="PDF pages"
    >
      <div ref={sheetRef} className={styles.sheet} />
    </div>
  )
})

export default PdfView
