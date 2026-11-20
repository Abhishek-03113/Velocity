import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE } from '../types'
import type { ReaderColors, TocItem } from '../types'
import {
  buildThemeRules,
  chapterLabelForHref,
  clampFontScale,
  computeGeometry,
  createWheelTurner,
  diffAnnotations,
  flattenToc,
  fullStrength,
  mergeLineRects,
  pointInRects,
  reflows,
  resolvePosition,
  rulesToCss,
  squigglePath,
  stepToward,
  strikeY,
  swipeDirection,
  tapZone,
  TurnQueue,
  underlineY,
} from './helpers'
import { cleanMetaText } from './meta'

const colors: ReaderColors = { background: '#111', text: '#eee', link: '#6af', selection: 'rgba(1,2,3,0.4)', dark: true }

describe('flattenToc', () => {
  it('flattens nested items in reading order with levels and trimmed labels', () => {
    const toc = flattenToc([
      { id: 'a', href: 'c1.xhtml', label: '  Chapter 1\n ', subitems: [{ id: 'a1', href: 'c1.xhtml#s1', label: 'Section' }] },
      { id: 'b', href: 'c2.xhtml', label: 'Chapter 2' },
    ])
    expect(toc).toEqual([
      { id: 'a', label: 'Chapter 1', target: 'c1.xhtml', level: 0 },
      { id: 'a1', label: 'Section', target: 'c1.xhtml#s1', level: 1 },
      { id: 'b', label: 'Chapter 2', target: 'c2.xhtml', level: 0 },
    ])
  })
  it('handles empty input and generates ids / labels when missing', () => {
    expect(flattenToc(undefined)).toEqual([])
    expect(flattenToc([{ href: 'x.xhtml', label: '' }])).toEqual([{ id: 'toc-0', label: 'x.xhtml', target: 'x.xhtml', level: 0 }])
  })
})

describe('clampFontScale', () => {
  it('clamps to 0.8..1.6', () => {
    expect(clampFontScale(0.2)).toBe(0.8)
    expect(clampFontScale(3)).toBe(1.6)
    expect(clampFontScale(1.2)).toBe(1.2)
    expect(clampFontScale(NaN)).toBe(1)
  })
})

describe('buildThemeRules', () => {
  const base = { fontScale: 1, fontFamily: 'serif' as const }
  const flowKey = (r: Record<string, unknown>) => Object.keys(r).find((k) => k.startsWith('p:not'))!

  it('applies ink colour, selection, serif stack and a root font size from the scale', () => {
    const r = buildThemeRules({ ...base, fontScale: 1.25 }, colors)
    expect(r.body.color).toContain('#eee')
    expect(r.html['font-size']).toBe('23.75px !important')
    expect(r.body['font-family']).toContain('Iowan Old Style')
    expect(r.body['line-height']).toContain('1.6')
    expect(r['::selection'].background).toContain('rgba(1,2,3,0.4)')
    expect(r['a, a:link, a:visited'].color).toContain('#eee')
    expect(r['a, a:link, a:visited']['text-decoration-color']).toContain('#6af')
  })
  it('gives every element the paper ink, so book colours never put dark text on dark paper', () => {
    const r = buildThemeRules(base, colors)
    const key = Object.keys(r).find((k) => k.startsWith('body *'))!
    expect(key).toMatch(/:not\(#/) // id weight beats a book's `.class { color: … !important }`
    expect(r[key].color).toBe('inherit !important')
    expect(r[key]['-webkit-text-fill-color']).toBe('currentColor !important')
    expect(r[key]['background-color']).toBe('transparent !important')
    // Links still read as links: the accent stays on the underline.
    expect(r['a, a:link, a:visited']['text-decoration-color']).toContain('#6af')
  })
  it('keeps the page transparent so the tile paints the paper', () => {
    const r = buildThemeRules(base, colors)
    expect(r.html.background).toContain('transparent')
    expect(r.body.background).toContain('transparent')
  })
  it('clamps the scale', () => {
    expect(buildThemeRules({ ...base, fontScale: 9 }, colors).html['font-size']).toBe('30.4px !important')
  })
  it('uses a sans stack and leaves the font alone for publisher, but keeps our spacing', () => {
    expect(buildThemeRules({ ...base, fontFamily: 'sans' }, colors).body['font-family']).toContain('system-ui')
    const p = buildThemeRules({ ...base, fontFamily: 'publisher' }, colors)
    expect(p.body['font-family']).toBeUndefined()
    expect(p.body['line-height']).toContain('1.6')
  })
  it('left-aligns by default, without hyphenation, and always asks for text-wrap pretty', () => {
    const r = buildThemeRules(base, colors)
    expect(r[flowKey(r)]['text-align']).toContain('left')
    expect(r[flowKey(r)].hyphens).toBeUndefined()
    expect(r['p, li, dd, blockquote, figcaption, td, th']['text-wrap']).toBe('pretty')
  })
  it('justify always comes with automatic hyphenation', () => {
    const r = buildThemeRules({ ...base, align: 'justify' }, colors)
    expect(r[flowKey(r)]['text-align']).toContain('justify')
    expect(r[flowKey(r)].hyphens).toContain('auto')
    expect(r[flowKey(r)]['-webkit-hyphens']).toContain('auto')
  })
  it('paragraph spacing replaces the indent; zero spacing keeps the book indent', () => {
    const spaced = buildThemeRules({ ...base, paragraphSpacing: 0.6 }, colors)
    expect(spaced.p.margin).toBe('0 0 0.6em 0 !important')
    expect(spaced.p['text-indent']).toContain('0')
    const tight = buildThemeRules({ ...base, paragraphSpacing: 0 }, colors)
    expect(tight.p['text-indent']).toBeUndefined()
  })
  it('scroll layout caps the measure and centres it with the chosen margin', () => {
    const r = buildThemeRules({ ...base, layout: 'scrolled' }, colors, { margin: 88, textWidth: 600, narrow: false })
    expect(r.body['max-width']).toContain('776px')
    expect(r.body.margin).toContain('auto')
    expect(r.body.padding).toContain('88px')
    expect(buildThemeRules({ ...base, layout: 'paginated' }, colors).body['max-width']).toBeUndefined()
  })
  it('serialises to CSS', () => {
    const css = rulesToCss(buildThemeRules({ ...base, fontFamily: 'publisher' }, colors))
    expect(css).toContain('body{color:#eee !important;')
  })
})

describe('computeGeometry', () => {
  it('maps the margin presets to px and halves them under 600px', () => {
    expect(computeGeometry(1000, 800, { fontScale: 1, margins: 'narrow' }).margin).toBe(24)
    expect(computeGeometry(1000, 800, { fontScale: 1, margins: 'normal' }).margin).toBe(48)
    expect(computeGeometry(1000, 800, { fontScale: 1, margins: 'wide' }).margin).toBe(88)
    expect(computeGeometry(500, 800, { fontScale: 1, margins: 'wide' }).margin).toBe(44)
  })
  it('caps margins at 7% of the width on very narrow tiles', () => {
    expect(computeGeometry(300, 800, { fontScale: 1, margins: 'wide' }).margin).toBe(21)
    expect(computeGeometry(150, 800, { fontScale: 1, margins: 'normal' }).margin).toBe(11)
    expect(computeGeometry(419, 800, { fontScale: 1, margins: 'narrow' }).margin).toBe(12)
  })
  it('gap is twice the margin and spreads start at 900px', () => {
    const g = computeGeometry(899, 800, { fontScale: 1, margins: 'normal' })
    expect(g.gap).toBe(96)
    expect(g.spread).toBe(false)
    expect(computeGeometry(900, 800, { fontScale: 1, margins: 'normal' }).spread).toBe(true)
  })
  it('caps the page sheet on wide tiles and fills narrow ones', () => {
    const wide = computeGeometry(2400, 900, { fontScale: 1, margins: 'normal' })
    expect(wide.mountWidth).toBeLessThan(2400)
    expect(wide.mountWidth % 2).toBe(0)
    expect(computeGeometry(700, 900, { fontScale: 1, margins: 'normal' }).mountWidth).toBe(700)
    // the cap grows with the font so the characters per line stay the same
    expect(computeGeometry(2400, 900, { fontScale: 1.5, margins: 'normal' }).textWidth).toBeGreaterThan(wide.textWidth)
  })
  it('a spread is always wide enough for epub.js to keep two columns', () => {
    for (const w of [900, 1000, 1280, 1600, 2400]) {
      expect(computeGeometry(w, 800, { fontScale: 0.8, margins: 'narrow' }).mountWidth).toBeGreaterThanOrEqual(900)
    }
  })
})

describe('reflows', () => {
  it('is true only for changes that move the text', () => {
    const a = { ...DEFAULT_APPEARANCE }
    expect(reflows(a, { ...a, theme: 'dark', pageTurn: 'curl' })).toBe(false)
    expect(reflows(a, { ...a, fontScale: 1.2 })).toBe(true)
    expect(reflows(a, { ...a, margins: 'wide' })).toBe(true)
    expect(reflows(a, { ...a, align: 'justify' })).toBe(true)
  })
})

describe('tapZone', () => {
  it('left 30% goes back, right 30% forward, the middle is the centre', () => {
    expect(tapZone(10, 1000)).toBe('prev')
    expect(tapZone(299, 1000)).toBe('prev')
    expect(tapZone(500, 1000)).toBe('center')
    expect(tapZone(701, 1000)).toBe('next')
    expect(tapZone(990, 1000)).toBe('next')
  })
  it('is always the centre in scroll layout or with no width', () => {
    expect(tapZone(10, 1000, false)).toBe('center')
    expect(tapZone(10, 0)).toBe('center')
  })
})

describe('swipeDirection and the wheel turner', () => {
  it('needs 40px and a mostly horizontal drag; dragging left goes forward', () => {
    expect(swipeDirection(-60, 5)).toBe('next')
    expect(swipeDirection(60, 5)).toBe('prev')
    expect(swipeDirection(-30, 0)).toBeNull()
    expect(swipeDirection(-60, 80)).toBeNull()
  })
  it('accumulates horizontal deltas, fires once, then ignores the inertia tail', () => {
    const w = createWheelTurner(60, 140, 380)
    expect(w.push(30, 0, 0)).toBeNull()
    expect(w.push(40, 0, 16)).toBe('next')
    expect(w.push(50, 0, 32)).toBeNull()
    expect(w.push(50, 0, 300)).toBeNull()
    expect(w.push(-70, 0, 2000)).toBe('prev')
  })
  it('ignores mostly vertical scrolling', () => {
    expect(createWheelTurner().push(10, 80, 0)).toBeNull()
  })
})

describe('TurnQueue', () => {
  it('runs the first turn, remembers one more (the latest) and then goes idle', () => {
    const q = new TurnQueue()
    expect(q.request('next')).toBe('start')
    expect(q.request('next')).toBe('queued')
    expect(q.request('prev')).toBe('queued')
    expect(q.done()).toBe('prev')
    expect(q.running).toBe(true)
    expect(q.done()).toBeNull()
    expect(q.running).toBe(false)
    expect(q.request('next')).toBe('start')
  })
})

describe('mark geometry', () => {
  it('drops contained and sliver rects and joins neighbours on one line', () => {
    const merged = mergeLineRects([
      { left: 0, top: 0, width: 100, height: 20 },
      { left: 100.5, top: 0.5, width: 50, height: 20 },
      { left: 10, top: 2, width: 20, height: 10 },
      { left: 0, top: 0, width: 0.2, height: 20 },
      { left: 0, top: 40, width: 80, height: 20 },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0].left).toBe(0)
    expect(merged[0].width).toBeCloseTo(150.5, 1)
    expect(merged[1].top).toBe(40)
  })
  it('puts the strike through the middle and the underline near the bottom of the line box', () => {
    const r = { left: 0, top: 100, width: 50, height: 20 }
    expect(strikeY(r)).toBeCloseTo(110.8, 1)
    expect(underlineY(r)).toBe(118)
  })
  it('draws a squiggle as one wave per half wavelength, ending at the right edge', () => {
    const d = squigglePath(10, 50, 50, 1.5, 5)
    expect(d.startsWith('M10 50')).toBe(true)
    expect((d.match(/Q/g) ?? []).length).toBe(20)
    expect(d.endsWith('60 50')).toBe(true)
  })
  it('hit-tests with a little slop', () => {
    const rects = [{ left: 10, top: 10, width: 100, height: 20 }]
    expect(pointInRects(50, 20, rects)).toBe(true)
    expect(pointInRects(111, 20, rects)).toBe(true)
    expect(pointInRects(200, 20, rects)).toBe(false)
  })
  it('strips alpha for full-strength strokes', () => {
    expect(fullStrength('rgba(255, 214, 10, 0.38)')).toBe('rgb(255, 214, 10)')
    expect(fullStrength('#ffd60a60')).toBe('#ffd60a')
    expect(fullStrength('#fffa')).toBe('#ffffff')
    expect(fullStrength('hsla(48, 100%, 50%, 0.3)')).toBe('hsl(48, 100%, 50%)')
  })
})

describe('diffAnnotations', () => {
  const a: { id: string; locator: string; color: string; style: string; hasNote?: boolean } = { id: '1', locator: 'l1', color: 'yellow', style: 'highlight' }
  const b = { id: '2', locator: 'l2', color: 'green', style: 'underline' }
  it('finds added, removed and changed by id', () => {
    const prev = new Map([
      ['1', a],
      ['2', b],
    ])
    const d = diffAnnotations(prev, [{ ...a, color: 'blue' }, { id: '3', locator: 'l3', color: 'pink', style: 'strike' }])
    expect(d.add.map((x) => x.id)).toEqual(['3'])
    expect(d.update.map((x) => x.id)).toEqual(['1'])
    expect(d.remove).toEqual(['2'])
    expect(diffAnnotations(prev, [a, b])).toEqual({ add: [], remove: [], update: [] })
  })
  it('treats a note flag change as an update', () => {
    expect(diffAnnotations(new Map([['1', a]]), [{ ...a, hasNote: true }]).update).toHaveLength(1)
  })
})

describe('resolvePosition (a restore never reports earlier than its target)', () => {
  // Fake CFIs: "chapter:offset" compared numerically.
  const cmp = (x: string, y: string) => {
    const [a, b] = x.split(':').map(Number)
    const [c, d] = y.split(':').map(Number)
    return a - c || b - d
  }
  it('reports the page start when nothing is held', () => {
    expect(resolvePosition('3:100', '3:400', null, cmp)).toEqual({ position: '3:100', hold: false })
  })
  it('skips an intermediate page that ends before the target (epub.js landed early)', () => {
    expect(resolvePosition('3:0', '3:99', { target: '3:100', settled: null }, cmp)).toEqual({ position: null, hold: true })
  })
  it('reports the target when its page starts earlier (a relayout moved the page boundary)', () => {
    expect(resolvePosition('3:40', '3:300', { target: '3:100', settled: null }, cmp)).toEqual({ position: '3:100', hold: true })
    expect(resolvePosition('3:40', '3:300', { target: '3:100', settled: '3:40' }, cmp)).toEqual({ position: '3:100', hold: true })
  })
  it('lets go as soon as the reader moves off the settled page', () => {
    expect(resolvePosition('3:300', '3:600', { target: '3:100', settled: '3:40' }, cmp)).toEqual({ position: '3:300', hold: false })
    expect(resolvePosition('2:0', '2:300', { target: '3:100', settled: '3:40' }, cmp)).toEqual({ position: '2:0', hold: false })
  })
  it('reports a later page start while settling', () => {
    expect(resolvePosition('3:150', '3:400', { target: '3:100', settled: null }, cmp)).toEqual({ position: '3:150', hold: true })
  })
})

describe('stepToward', () => {
  const win = { left: 100, top: 50, width: 400, height: 600 }
  it('paged: compares the first line horizontally against the visible columns', () => {
    expect(stepToward(120, 0, win, true)).toBe('here')
    expect(stepToward(520, 0, win, true)).toBe('next')
    expect(stepToward(20, 0, win, true)).toBe('prev')
  })
  it('scrolled: compares vertically', () => {
    expect(stepToward(0, 300, win, false)).toBe('here')
    expect(stepToward(0, 700, win, false)).toBe('next')
    expect(stepToward(0, 10, win, false)).toBe('prev')
  })
})

describe('chapterLabelForHref', () => {
  const toc: TocItem[] = [
    { id: '1', label: 'One', target: 'ch1.xhtml', level: 0 },
    { id: '2', label: 'Two', target: 'text/ch2.xhtml#top', level: 0 },
  ]
  const spine = ['cover.xhtml', 'ch1.xhtml', 'ch1b.xhtml', 'text/ch2.xhtml']
  it('matches ignoring fragments', () => {
    expect(chapterLabelForHref('text/ch2.xhtml', toc, spine)).toBe('Two')
    expect(chapterLabelForHref('ch1.xhtml#x', toc, spine)).toBe('One')
  })
  it('falls back to the nearest previous spine item with an entry', () => {
    expect(chapterLabelForHref('ch1b.xhtml', toc, spine)).toBe('One')
  })
  it('returns null before the first entry or when unknown', () => {
    expect(chapterLabelForHref('cover.xhtml', toc, spine)).toBeNull()
    expect(chapterLabelForHref('nope.xhtml', toc, spine)).toBeNull()
    expect(chapterLabelForHref(undefined, toc, spine)).toBeNull()
  })
})

describe('cleanMetaText', () => {
  it('normalises whitespace and empties to null', () => {
    expect(cleanMetaText('  The  Velocity\nSampler ')).toBe('The Velocity Sampler')
    expect(cleanMetaText('   ')).toBeNull()
    expect(cleanMetaText(undefined)).toBeNull()
  })
})
