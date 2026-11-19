import { describe, expect, it } from 'vitest'
import { computeLayout } from './helpers'
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
} from './paged'

describe('tap zones', () => {
  it('left 30% prev, right 30% next, middle center', () => {
    expect(tapZone(0, 1000)).toBe('prev')
    expect(tapZone(299, 1000)).toBe('prev')
    expect(tapZone(300, 1000)).toBe('center')
    expect(tapZone(500, 1000)).toBe('center')
    expect(tapZone(700, 1000)).toBe('center')
    expect(tapZone(701, 1000)).toBe('next')
    expect(tapZone(1000, 1000)).toBe('next')
    expect(tapZone(10, 0)).toBe('center')
  })
})

describe('swipe', () => {
  it('needs more than 40px and a dominant horizontal move', () => {
    expect(swipeDirection(-80, 5)).toBe('next')
    expect(swipeDirection(80, -10)).toBe('prev')
    expect(swipeDirection(40, 0)).toBeNull()
    expect(swipeDirection(-60, 90)).toBeNull()
    expect(swipeDirection(-60, 60)).toBeNull()
    expect(swipeDirection(0, 0)).toBeNull()
  })
  it('detects horizontal wheel gestures', () => {
    expect(isHorizontalWheel(30, 2)).toBe(true)
    expect(isHorizontalWheel(2, 30)).toBe(false)
    expect(isHorizontalWheel(0, 0)).toBe(false)
  })
})

describe('turn queue', () => {
  it('runs the first turn at once and queues at most one more', () => {
    let step = enqueueTurn(IDLE_QUEUE, 1)
    expect(step.run).toBe(1)
    expect(step.queue).toEqual({ busy: true, pending: 0 })
    step = enqueueTurn(step.queue, 1)
    expect(step.run).toBeNull()
    expect(step.queue.pending).toBe(1)
    const third = enqueueTurn(step.queue, -1)
    expect(third.run).toBeNull()
    expect(third.queue.pending).toBe(1)
  })
  it('starts the waiting turn when the running one finishes, then goes idle', () => {
    const queued = enqueueTurn(enqueueTurn(IDLE_QUEUE, 1).queue, -1)
    const next = finishTurn(queued.queue)
    expect(next.run).toBe(-1)
    expect(next.queue).toEqual({ busy: true, pending: 0 })
    const done = finishTurn(next.queue)
    expect(done.run).toBeNull()
    expect(done.queue).toEqual(IDLE_QUEUE)
  })
})

describe('paged placement', () => {
  it('fills the viewport and centres a page that fits', () => {
    const sheet = pagedSheet({ width: 400, height: 500 }, { width: 800, height: 600 })
    expect(sheet).toEqual({ sheetWidth: 800, sheetHeight: 600 })
    expect(centrePage(sheet, { width: 400, height: 500 })).toEqual({ left: 200, top: 50 })
  })
  it('grows the sheet for a page taller than the viewport', () => {
    const sheet = pagedSheet({ width: 700, height: 1200 }, { width: 800, height: 600 })
    expect(sheet.sheetHeight).toBe(1232)
    expect(centrePage(sheet, { width: 700, height: 1200 }).top).toBe(16)
  })
  it('measures the fraction scrolled past the page top', () => {
    expect(fractionInPage(0, 16, 1200)).toBe(0)
    expect(fractionInPage(316, 16, 1200)).toBeCloseTo(0.25)
    expect(fractionInPage(5000, 16, 1200)).toBe(1)
    expect(fractionInPage(10, 0, 0)).toBe(0)
  })
})

describe('first visible text in the scroll layout', () => {
  const sizes = Array.from({ length: 12 }, () => ({ width: 600, height: 800 }))
  const layout = computeLayout(sizes, 1)
  it('is the page at the top edge and the fraction scrolled past', () => {
    expect(firstVisible(layout, 0)).toEqual({ page: 1, frac: 0 })
    const top = scrollTopForPosition(layout, 9, 0.4)
    const pos = firstVisible(layout, top)
    expect(pos.page).toBe(9)
    expect(pos.frac).toBeCloseTo(0.4)
  })
  it('moves to the next page once the gap is passed', () => {
    const inGap = layout.tops[1] - 8
    expect(firstVisible(layout, inGap)).toEqual({ page: 2, frac: 0 })
  })
  it('round-trips exact positions', () => {
    for (const [page, frac] of [[1, 0], [4, 0.25], [12, 0.99]] as const) {
      const pos = firstVisible(layout, scrollTopForPosition(layout, page, frac))
      expect(pos.page).toBe(page)
      expect(Math.round(pos.frac * 100) / 100).toBe(frac)
    }
  })
})
