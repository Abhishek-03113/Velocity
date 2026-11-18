import { describe, expect, it } from 'vitest'
import type { ReaderColors, TocItem } from '../types'
import { buildThemeRules, chapterLabelForHref, clampFontScale, flattenToc, rulesToCss } from './helpers'
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
  it('applies colours, selection and rounded font size', () => {
    const r = buildThemeRules({ fontScale: 1.25, fontFamily: 'serif' }, colors)
    expect(r.body.color).toContain('#eee')
    expect(r.body.background).toContain('#111')
    expect(r.body['font-size']).toBe('125%')
    expect(r.body['font-family']).toContain('Georgia')
    expect(r.body['line-height']).toBe('1.6')
    expect(r['::selection'].background).toBe('rgba(1,2,3,0.4)')
    expect(r['a, a:link, a:visited'].color).toContain('#6af')
  })
  it('clamps the scale', () => {
    expect(buildThemeRules({ fontScale: 9, fontFamily: 'sans' }, colors).body['font-size']).toBe('160%')
  })
  it('uses a sans stack and leaves fonts alone for publisher', () => {
    expect(buildThemeRules({ fontScale: 1, fontFamily: 'sans' }, colors).body['font-family']).toContain('sans-serif')
    const p = buildThemeRules({ fontScale: 1, fontFamily: 'publisher' }, colors)
    expect(p.body['font-family']).toBeUndefined()
    expect(p.body['line-height']).toBeUndefined()
  })
  it('serialises to CSS', () => {
    const css = rulesToCss(buildThemeRules({ fontScale: 1, fontFamily: 'publisher' }, colors))
    expect(css).toContain('body{color:#eee !important;')
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
