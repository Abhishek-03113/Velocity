import { describe, expect, it } from 'vitest'
import {
  clampScroll,
  column,
  columnOf,
  cycleWidth,
  fromTiles,
  geometry,
  insertColumn,
  neighborTile,
  reconcile,
  removeTile,
  revealOffset,
  setWidth,
  stackTile,
  swapTile,
  toTree,
  toggleFull,
  type Column,
} from './sliding'
import { computeGeometry, leaf, leaves } from './tiling'

const note = (noteId: number) => ({ kind: 'note' as const, noteId, mode: 'edit' as const })

/** [a][b][c] each half width */
function three(): Column[] {
  return [column(['a'], 0.5, 'ca'), column(['b'], 0.5, 'cb'), column(['c'], 0.5, 'cc')]
}

describe('sliding geometry', () => {
  it('lays columns left to right and stacks tiles inside a column', () => {
    const cols = [column(['a'], 0.5, 'ca'), column(['b', 'c'], 1 / 3, 'cb')]
    const { tiles, total } = geometry(cols)
    expect(tiles.a).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(tiles.b).toEqual({ x: 0.5, y: 0, w: 1 / 3, h: 0.5 })
    expect(tiles.c).toEqual({ x: 0.5, y: 0.5, w: 1 / 3, h: 0.5 })
    expect(total).toBeCloseTo(0.5 + 1 / 3)
  })

  it('a lone column fills the viewport regardless of its stored width', () => {
    const cols = [column(['a'], 0.5)]
    expect(geometry(cols).tiles.a!.w).toBe(1)
    expect(cols[0]!.width).toBe(0.5)
  })
})

describe('sliding operations', () => {
  it('inserts a column after / before the focused one without resizing others', () => {
    let cols = insertColumn([], null, 'a')
    cols = insertColumn(cols, 'a', 'b')
    cols = insertColumn(cols, 'a', 'x', 'after')
    cols = insertColumn(cols, 'a', 'w', 'before')
    expect(cols.map((c) => c.tiles[0])).toEqual(['w', 'a', 'x', 'b'])
    expect(cols.every((c) => c.width === 0.5)).toBe(true)
  })

  it('stacks tiles within a column, falling back to a new column', () => {
    let cols = three()
    cols = stackTile(cols, 'b', 'd')
    expect(columnOf(cols, 'b')!.tiles).toEqual(['b', 'd'])
    cols = stackTile(cols, 'b', 'e', 'before')
    expect(columnOf(cols, 'b')!.tiles).toEqual(['e', 'b', 'd'])
    expect(stackTile(cols, 'missing', 'z')[3]!.tiles).toEqual(['z'])
  })

  it('removing the last tile of a column drops the column', () => {
    const cols = removeTile(three(), 'b')
    expect(cols.map((c) => c.id)).toEqual(['ca', 'cc'])
    const stacked = removeTile(stackTile(three(), 'a', 'd'), 'a')
    expect(stacked[0]!.tiles).toEqual(['d'])
  })

  it('moves focus between columns and within stacks', () => {
    const cols = stackTile(three(), 'b', 'd')
    expect(neighborTile(cols, 'a', 'right')).toBe('b')
    expect(neighborTile(cols, 'a', 'left')).toBeNull()
    expect(neighborTile(cols, 'b', 'down')).toBe('d')
    expect(neighborTile(cols, 'd', 'up')).toBe('b')
    expect(neighborTile(cols, 'a', 'down')).toBeNull()
    // Leaving the lower half of a stack lands on the lower half of the neighbour.
    expect(neighborTile(cols, 'd', 'right')).toBe('c')
    expect(neighborTile(stackTile(three(), 'c', 'e'), 'b', 'right')).toBe('c')
  })

  it('swaps columns left/right and tiles up/down', () => {
    const swapped = swapTile(three(), 'a', 'right')!
    expect(swapped.map((c) => c.tiles[0])).toEqual(['b', 'a', 'c'])
    expect(swapTile(three(), 'a', 'left')).toBeNull()
    const stacked = stackTile(three(), 'b', 'd')
    expect(swapTile(stacked, 'b', 'down')![1]!.tiles).toEqual(['d', 'b'])
  })

  it('cycles width through presets and wraps', () => {
    let cols = [column(['a'], 1 / 3, 'ca'), column(['b'], 0.5, 'cb')]
    const seen: number[] = []
    for (let i = 0; i < 5; i++) {
      cols = cycleWidth(cols, 'ca')
      seen.push(cols[0]!.width)
    }
    expect(seen.map((w) => Math.round(w * 100))).toEqual([50, 67, 100, 33, 50])
    expect(cycleWidth(cols, 'ca', -1)[0]!.width).toBeCloseTo(1 / 3)
  })

  it('clamps explicit widths and toggles full width with memory', () => {
    expect(setWidth(three(), 'ca', 0.01)[0]!.width).toBe(0.2)
    expect(setWidth(three(), 'ca', 5)[0]!.width).toBe(1)
    let cols = setWidth(three(), 'ca', 2 / 3)
    cols = toggleFull(cols, 'ca')
    expect(cols[0]!.width).toBe(1)
    cols = toggleFull(cols, 'ca')
    expect(cols[0]!.width).toBeCloseTo(2 / 3)
  })
})

describe('scroll offset', () => {
  it('leaves the offset alone when the column is already visible', () => {
    expect(revealOffset(three(), 'a', 0)).toBe(0)
    expect(revealOffset(three(), 'b', 0)).toBe(0)
  })

  it('scrolls just far enough to reveal an off-screen column on the right', () => {
    // total 1.5; c spans 1..1.5
    expect(revealOffset(three(), 'c', 0)).toBeCloseTo(0.5)
  })

  it('scrolls back left to reveal columns hidden on the left', () => {
    const cols = [column(['a'], 2 / 3), column(['b'], 2 / 3), column(['c'], 2 / 3), column(['d'], 2 / 3)]
    expect(revealOffset(cols, 'd', 0)).toBeCloseTo(2 + 2 / 3 - 1)
    expect(revealOffset(cols, 'a', 5)).toBe(0)
  })

  it('aligns a full-width column to the viewport and clamps scroll', () => {
    const cols = [column(['a'], 1), column(['b'], 1), column(['c'], 1)]
    expect(revealOffset(cols, 'b', 0)).toBe(1)
    expect(clampScroll(cols, 99)).toBe(2)
    expect(clampScroll(cols, -4)).toBe(0)
  })
})

describe('reconcile', () => {
  it('drops missing tiles and appends unknown ones, keeping identity when unchanged', () => {
    const cols = three()
    expect(reconcile(cols, ['a', 'b', 'c'])).toBe(cols)
    const next = reconcile(cols, ['a', 'c', 'z'])
    expect(next.map((c) => c.tiles[0])).toEqual(['a', 'c', 'z'])
  })
})

describe('mode conversion', () => {
  it('dwindle → sliding turns leaves into columns in reading order, stacking shared x-ranges', () => {
    const tiles = {
      l: { x: 0, y: 0, w: 0.5, h: 1 },
      tr: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      br: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    }
    const cols = fromTiles(tiles)
    expect(cols.map((c) => c.tiles)).toEqual([['l'], ['tr', 'br']])
    expect(cols.map((c) => c.width)).toEqual([0.5, 0.5])
  })

  it('sliding → dwindle keeps every tile, in order, with stacks as column splits', () => {
    const cols = [column(['a']), column(['b', 'c']), column(['d'])]
    const byId = new Map(['a', 'b', 'c', 'd'].map((id, i) => [id, leaf(note(i + 1), id)]))
    const root = toTree(cols, (id) => byId.get(id)!, 16 / 10)
    expect(leaves(root).map((l) => l.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    const { tiles } = computeGeometry(root)
    // b above c share a column.
    expect(tiles.b!.x).toBeCloseTo(tiles.c!.x)
    expect(tiles.b!.y).toBeLessThan(tiles.c!.y)
    // Contents survive.
    expect(leaves(root).find((l) => l.id === 'c')!.content).toEqual(note(3))
  })

  it('round-trips the set of tiles through both modes', () => {
    const cols = [column(['a']), column(['b']), column(['c']), column(['d'])]
    const byId = new Map(['a', 'b', 'c', 'd'].map((id, i) => [id, leaf(note(i + 1), id)]))
    const root = toTree(cols, (id) => byId.get(id)!, 16 / 10)
    const back = fromTiles(computeGeometry(root).tiles)
    expect(back.flatMap((c) => c.tiles).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
