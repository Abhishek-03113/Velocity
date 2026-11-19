/** Pure helpers for the PDF engine's paged mode: placement, first-visible text, tap zones, swipes and the turn queue. */
import { PAGE_PADDING, pageIndexAt as indexAt, type PageLayout, type PdfPosition, type Size } from './helpers'

// --- placement -----------------------------------------------------------------------------------------------------

export interface PagedSheet {
  sheetWidth: number
  sheetHeight: number
}

/** Size of the scrollable sheet in paged mode: at least the viewport, larger when the (scaled) current page does not fit. */
export function pagedSheet(page: Size, view: Size, padding = PAGE_PADDING): PagedSheet {
  return {
    sheetWidth: Math.max(view.width, page.width + padding * 2),
    sheetHeight: Math.max(view.height, page.height + padding * 2),
  }
}

/** Top-left of a (scaled) page centred in the sheet, never closer than `padding` to its edge. */
export function centrePage(sheet: PagedSheet, page: Size, padding = PAGE_PADDING): { left: number; top: number } {
  return {
    left: Math.max(padding, (sheet.sheetWidth - page.width) / 2),
    top: Math.max(padding, (sheet.sheetHeight - page.height) / 2),
  }
}

/** Fraction of a page scrolled past the top of the viewport, 0..1. */
export function fractionInPage(scrollTop: number, pageTop: number, pageHeight: number): number {
  if (pageHeight <= 0) return 0
  return Math.min(1, Math.max(0, (scrollTop - pageTop) / pageHeight))
}

/** First visible text in the scroll layout: the page at the top edge of the viewport and the fraction scrolled past. */
export function firstVisible(layout: PageLayout, scrollTop: number): PdfPosition {
  const n = layout.tops.length
  if (n === 0) return { page: 1, frac: 0 }
  let i = indexAt(layout.tops, scrollTop)
  // The gap between pages belongs to the next one; the 1px slack absorbs float / device-pixel rounding at the boundary.
  if (layout.tops[i] + layout.heights[i] <= scrollTop + 1 && i < n - 1) i++
  return { page: i + 1, frac: fractionInPage(scrollTop, layout.tops[i], layout.heights[i]) }
}

/** Inverse of `firstVisible`: the scrollTop of a page and fraction. */
export function scrollTopForPosition(layout: PageLayout, page: number, frac: number): number {
  const n = layout.tops.length
  if (n === 0) return 0
  const i = Math.min(n - 1, Math.max(0, page - 1))
  return layout.tops[i] + Math.min(1, Math.max(0, frac)) * layout.heights[i]
}

// --- input ---------------------------------------------------------------------------------------------------------

/** Width share of the left (previous) and right (next) tap zones. */
export const TAP_ZONE = 0.3
export type TapZone = 'prev' | 'next' | 'center'

export function tapZone(x: number, width: number): TapZone {
  if (!(width > 0)) return 'center'
  const f = x / width
  if (f < TAP_ZONE) return 'prev'
  if (f > 1 - TAP_ZONE) return 'next'
  return 'center'
}

export const SWIPE_MIN_PX = 40

/** A horizontal, dominant drag of more than 40px: leftwards turns forward, rightwards back. */
export function swipeDirection(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) <= SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return null
  return dx < 0 ? 'next' : 'prev'
}

/** True when a wheel / trackpad delta is a horizontal gesture. */
export function isHorizontalWheel(dx: number, dy: number): boolean {
  return Math.abs(dx) > 0 && Math.abs(dx) > Math.abs(dy) * 1.2
}

// --- turn queue ----------------------------------------------------------------------------------------------------

/** One turn runs at a time; at most one more waits. `pending` is a direction (-1 / 1) or 0. */
export interface TurnQueue {
  busy: boolean
  pending: -1 | 0 | 1
}

export const IDLE_QUEUE: TurnQueue = { busy: false, pending: 0 }

export interface QueueStep {
  queue: TurnQueue
  /** Direction to start now, or null. */
  run: -1 | 1 | null
}

export function enqueueTurn(queue: TurnQueue, dir: -1 | 1): QueueStep {
  if (!queue.busy) return { queue: { busy: true, pending: 0 }, run: dir }
  if (queue.pending !== 0) return { queue, run: null }
  return { queue: { busy: true, pending: dir }, run: null }
}

/** The running turn ended: start the waiting one, if any. */
export function finishTurn(queue: TurnQueue): QueueStep {
  if (queue.pending !== 0) return { queue: { busy: true, pending: 0 }, run: queue.pending }
  return { queue: IDLE_QUEUE, run: null }
}
