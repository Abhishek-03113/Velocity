import { describe, expect, it } from 'vitest'
import { highlightFills, hexToRgba, PAPER_STOCK, paperBackgroundImage, paperColors, paperExpressions, type PaperTokens } from './paper'

/** Records the expressions it is asked to resolve, like the DOM probe would. */
function probe(dark: boolean) {
  const asked: string[] = []
  const tokens: PaperTokens = {
    color: (expr) => {
      asked.push(expr)
      return `rgb(${asked.length}, 0, 0)`
    },
    isDark: () => dark,
  }
  return { tokens, asked }
}

describe('paper expressions', () => {
  it('light themes mix --bg-content 88% with the warm paper tint and --label 92% with warm ink', () => {
    const e = paperExpressions(false)
    expect(e.paper).toBe('color-mix(in oklab, var(--bg-content) 88%, #f3e7cf)')
    expect(e.ink).toBe('color-mix(in oklab, var(--label) 92%, #2b2118)')
  })

  it('dark themes use the dark paper tint and light ink', () => {
    const e = paperExpressions(true)
    expect(e.paper).toBe('color-mix(in oklab, var(--bg-content) 88%, #2a2420)')
    expect(e.ink).toBe('color-mix(in oklab, var(--label) 92%, #efe4d2)')
  })

  it('muted is ink at 60% over the paper', () => {
    const e = paperExpressions(false)
    expect(e.muted).toBe(`color-mix(in oklab, ${e.ink} 60%, ${e.paper})`)
  })
})

describe('paperColors', () => {
  it('resolves paper, ink and muted through the token probe and flags dark', () => {
    for (const dark of [false, true]) {
      const { tokens, asked } = probe(dark)
      const c = paperColors(tokens)
      const e = paperExpressions(dark)
      expect(asked.slice(0, 3)).toEqual([e.paper, e.ink, e.muted])
      expect(c.dark).toBe(dark)
      expect(c.background).toBe('rgb(1, 0, 0)')
      expect(c.text).toBe('rgb(2, 0, 0)')
      expect(c.muted).toBe('rgb(3, 0, 0)')
      expect(c.link).toBe('rgb(4, 0, 0)')
    }
  })

  it('hands engines a grain background and highlight fills', () => {
    const c = paperColors(probe(false).tokens)
    expect(c.backgroundImage).toBe(paperBackgroundImage(false))
    expect(c.highlights).toEqual(highlightFills(false))
  })
})

describe('grain and highlights', () => {
  it('builds one background-image: a vignette over an feTurbulence data URI', () => {
    for (const dark of [false, true]) {
      const image = paperBackgroundImage(dark)
      expect(image.startsWith('radial-gradient(')).toBe(true)
      const svg = decodeURIComponent(/url\("data:image\/svg\+xml,([^"]+)"\)/.exec(image)![1])
      expect(svg).toContain("baseFrequency='0.9'")
      expect(svg).toContain("numOctaves='2'")
      expect(svg).toContain("stitchTiles='stitch'")
    }
    // alpha ~0.04 light / ~0.06 dark (the matrix scales the noise by twice its mean)
    const svgOf = (dark: boolean) => decodeURIComponent(/url\("data:image\/svg\+xml,([^"]+)"\)/.exec(paperBackgroundImage(dark))![1])
    expect(svgOf(false)).toContain('0.080 0 0 0 0')
    expect(svgOf(true)).toContain('0.120 0 0 0 0')
  })

  it('tunes highlight alpha per stock from one set of bases', () => {
    expect(hexToRgba(PAPER_STOCK.highlightBase.yellow, 0.35)).toBe('rgba(255, 214, 10, 0.35)')
    expect(highlightFills(false).blue).toBe('rgba(10, 132, 255, 0.35)')
    expect(highlightFills(true).blue).toBe('rgba(10, 132, 255, 0.3)')
    expect(Object.keys(highlightFills(true))).toEqual(['yellow', 'green', 'blue', 'pink', 'orange'])
  })

  it('keeps every fixed colour in the one exported constant', () => {
    expect(PAPER_STOCK.light.paperTint).toBe('#f3e7cf')
    expect(PAPER_STOCK.dark.paperTint).toBe('#2a2420')
    expect(PAPER_STOCK.light.inkTint).toBe('#2b2118')
    expect(PAPER_STOCK.dark.inkTint).toBe('#efe4d2')
    expect(PAPER_STOCK.highlightBase).toEqual({ yellow: '#ffd60a', green: '#34c759', blue: '#0a84ff', pink: '#ff375f', orange: '#ff9f0a' })
  })
})
