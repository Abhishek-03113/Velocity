/**
 * PDF reading surface (pdf.js). Pure engine: a vertical scroller of lazily rendered pages that fills its parent.
 * The shell draws toolbar, contents and progress. See docs/specs/books-plugin.md §2.4.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import type { ReaderEngineProps, ReaderHandle, ReaderLocation, TocItem } from '../types'
import {
  PAGE_PADDING,
  chapterForPage,
  computeLayout,
  currentPage,
  flattenOutline,
  formatPosition,
  isAtBottom,
  pageFilter,
  pageIndexAt,
  parsePosition,
  progressAt,
  renderWindow,
  resolveScale,
  scrollTopForProgress,
  type OutlineNode,
  type PageLayout,
  type PdfZoom,
  type Size,
} from './helpers'
import { loadPdfjs, type PdfjsLib } from './pdfjs'
import styles from './pdf.module.css'

/** Upper bound for one canvas, so a 400 % zoom on a large page cannot exhaust GPU memory. */
const MAX_CANVAS_PIXELS = 16_777_216
const RESIZE_DEBOUNCE_MS = 120

interface Slot {
  el: HTMLDivElement
  key: string
  gen: number
  page: PDFPageProxy | null
  canvas: HTMLCanvasElement | null
  text: HTMLDivElement | null
  task: RenderTask | null
  textLayer: TextLayer | null
}

interface Controller extends ReaderHandle {
  refit(): void
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

const PdfView = forwardRef<ReaderHandle, ReaderEngineProps>(function PdfView(props, ref) {
  const { url, appearance, colors } = props
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const ctlRef = useRef<Controller | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const zoomRef = useRef<PdfZoom>(appearance.pdfZoom)
  zoomRef.current = appearance.pdfZoom

  useImperativeHandle(
    ref,
    () => ({
      next: () => ctlRef.current?.next(),
      prev: () => ctlRef.current?.prev(),
      goTo: (target) => ctlRef.current?.goTo(target),
      goToProgress: (p) => ctlRef.current?.goToProgress(p),
      focus: () => scrollerRef.current?.focus({ preventScroll: true }),
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
    let hasSelection = false
    let lastEmit = ''
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const viewW = () => scroller.clientWidth || 800
    const viewH = () => scroller.clientHeight || 600
    const count = () => slots.length
    const currentIdx = () => (pendingPage ?? currentPage(layout, scroller.scrollTop, viewH())) - 1

    // --- layout -------------------------------------------------------------------------------------------------

    function layoutAll() {
      const hadLayout = layout.tops.length > 0
      const idx = hadLayout ? pageIndexAt(layout.tops, scroller.scrollTop) : 0
      const frac = hadLayout && layout.heights[idx] > 0 ? (scroller.scrollTop - layout.tops[idx]) / layout.heights[idx] : 0
      const oldCenter = sheetWidth > 0 ? (scroller.scrollLeft + viewW() / 2) / sheetWidth : 0.5

      layout = computeLayout(base, scale)
      const maxW = base.reduce((m, s) => Math.max(m, s.width), 0) * scale
      sheetWidth = Math.max(viewW(), maxW + PAGE_PADDING * 2)
      sheet.style.width = `${sheetWidth}px`
      sheet.style.height = `${layout.total}px`
      slots.forEach((s, i) => {
        const w = base[i].width * scale
        s.el.style.top = `${layout.tops[i]}px`
        s.el.style.left = `${(sheetWidth - w) / 2}px`
        s.el.style.width = `${w}px`
        s.el.style.height = `${layout.heights[i]}px`
        s.el.style.setProperty('--scale-factor', String(scale))
      })

      if (hadLayout) {
        scroller.scrollTop = layout.tops[idx] + frac * layout.heights[idx]
        scroller.scrollLeft = Math.max(0, oldCenter * sheetWidth - viewW() / 2)
      }
    }

    function computeScale(): number {
      const i = Math.min(Math.max(currentIdx(), 0), Math.max(0, base.length - 1))
      const size = base[i] ?? base[0]
      if (!size) return 1
      return resolveScale(zoomRef.current, size, { width: viewW(), height: viewH() })
    }

    function refit() {
      if (!doc || slots.length === 0) return
      const next = computeScale()
      if (Math.abs(next - scale) > 0.0005) scale = next
      layoutAll()
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

    async function renderSlot(i: number, key: string, dpr: number) {
      const s = slots[i]
      if (!doc || !lib) return
      const gen = ++s.gen
      s.key = key
      s.task?.cancel()
      s.textLayer?.cancel()
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
            layoutAll()
          }
        }

        const viewport = page.getViewport({ scale })
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
      }
    }

    function update() {
      if (!doc || slots.length === 0) return
      const [a, b] = renderWindow(layout, scroller.scrollTop, viewH())
      const dpr = window.devicePixelRatio || 1
      const key = `${scale.toFixed(4)}@${dpr}`
      const center = currentIdx()
      const wanted: number[] = []
      for (let i = 0; i < slots.length; i++) {
        if (i >= a && i <= b) wanted.push(i)
        else if (slots[i].key !== '') release(slots[i])
      }
      wanted.sort((x, y) => Math.abs(x - center) - Math.abs(y - center))
      for (const i of wanted) if (slots[i].key !== key) void renderSlot(i, key, dpr)
    }

    // --- location -----------------------------------------------------------------------------------------------

    function emitLocation(force = false) {
      if (!ready || slots.length === 0) return
      const top = scroller.scrollTop
      const h = viewH()
      const page = Math.min(count(), Math.max(1, pendingPage ?? currentPage(layout, top, h)))
      const atEnd = isAtBottom(layout, top, h) || (page === count() && top + h >= layout.tops[page - 1] + layout.heights[page - 1])
      const loc: ReaderLocation = {
        position: formatPosition(page),
        progress: progressAt(layout, page, top, h),
        chapter: chapterForPage(toc, page),
        page,
        pageCount: count(),
        atStart: page === 1 && top <= layout.tops[0] + 2,
        atEnd,
      }
      const sig = `${loc.position}|${loc.progress.toFixed(4)}|${loc.chapter}|${loc.atStart}|${loc.atEnd}`
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

    // --- navigation ---------------------------------------------------------------------------------------------

    const behavior = (): ScrollBehavior => (reduceMotion.matches ? 'auto' : 'smooth')

    function scrollToPage(page: number, smooth: boolean) {
      if (slots.length === 0) return
      const p = Math.min(count(), Math.max(1, Math.round(page)))
      pendingPage = p
      scroller.scrollTo({ top: layout.tops[p - 1], behavior: smooth ? behavior() : 'auto' })
      update()
      emitLocation()
    }

    const controller: Controller = {
      next() {
        const cur = currentIdx() + 1
        if (cur >= count()) scroller.scrollTo({ top: layout.total, behavior: behavior() })
        else scrollToPage(cur + 1, true)
      },
      prev() {
        scrollToPage(Math.max(1, currentIdx()), true)
      },
      goTo(target) {
        const p = parsePosition(target)
        if (p !== null) scrollToPage(p, false)
      },
      goToProgress(progress) {
        if (slots.length === 0) return
        pendingPage = null
        scroller.scrollTop = scrollTopForProgress(layout, progress, viewH())
        update()
        emitLocation()
      },
      focus() {
        scroller.focus({ preventScroll: true })
      },
      refit,
    }
    ctlRef.current = controller

    // --- input --------------------------------------------------------------------------------------------------

    const clearPending = () => {
      pendingPage = null
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || slots.length === 0) return
      let handled = true
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
        case 'Home':
          pendingPage = null
          scroller.scrollTo({ top: 0, behavior: 'auto' })
          update()
          emitLocation()
          break
        case 'End':
          pendingPage = null
          scroller.scrollTo({ top: layout.total, behavior: 'auto' })
          update()
          emitLocation()
          break
        default:
          handled = false
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') clearPending()
      }
      if (handled) e.preventDefault()
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
      const pageEl = textLayer.closest('[data-page]')
      const page = pageEl ? Number(pageEl.getAttribute('data-page')) : currentIdx() + 1
      const r = range.getBoundingClientRect()
      hasSelection = true
      propsRef.current.onSelection({ text, where: `p. ${page}`, rect: { x: r.x, y: r.y, width: r.width, height: r.height } })
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
    scroller.addEventListener('wheel', clearPending, { passive: true })
    scroller.addEventListener('touchstart', clearPending, { passive: true })
    scroller.addEventListener('pointerdown', clearPending)
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
          sheet.appendChild(el)
          return { el, key: '', gen: 0, page: null, canvas: null, text: null, task: null, textLayer: null }
        })
        scale = resolveScale(zoomRef.current, base[0], { width: viewW(), height: viewH() })
        layoutAll()

        const startPage = Math.min(n, parsePosition(propsRef.current.initialPosition) ?? 1)
        scroller.scrollTop = layout.tops[startPage - 1]
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
      cancelAnimationFrame(raf)
      window.clearTimeout(resizeTimer)
      window.clearTimeout(selTimer)
      ro.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('keydown', onKeyDown)
      scroller.removeEventListener('wheel', clearPending)
      scroller.removeEventListener('touchstart', clearPending)
      scroller.removeEventListener('pointerdown', clearPending)
      scroller.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      slots.forEach(release)
      sheet.replaceChildren()
      sheet.style.width = ''
      sheet.style.height = ''
      void loadingTask?.destroy()
    }
  }, [url])

  // Zoom changes apply live to the open document.
  useEffect(() => {
    ctlRef.current?.refit()
  }, [appearance.pdfZoom])

  const dark = colors.dark
  const style = {
    '--pdf-bg': colors.background,
    '--pdf-filter': pageFilter(colors),
    '--pdf-selection': colors.selection,
    '--pdf-page-bg': dark ? `color-mix(in srgb, ${colors.background}, white 8%)` : '#fff',
  } as CSSProperties

  return (
    <div ref={scrollerRef} className={styles.scroller} style={style} tabIndex={0} role="document" aria-label="PDF pages">
      <div ref={sheetRef} className={styles.sheet} />
    </div>
  )
})

export default PdfView
