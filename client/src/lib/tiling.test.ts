import { describe, expect, it } from 'vitest'
import {
  computeGeometry,
  dwindleDir,
  equalize,
  isLayoutNode,
  leaf,
  leaves,
  neighbor,
  remapNote,
  removeLeaf,
  rotateParent,
  sanitize,
  setRatio,
  splitLeaf,
  swapContents,
  type LayoutNode,
} from './tiling'

const note = (noteId: number) => ({ kind: 'note' as const, noteId, mode: 'edit' as const })

/** a | (b / c) */
function threeTiles() {
  const a = leaf(note(1), 'a')
  const b = leaf(note(2), 'b')
  const c = leaf(note(3), 'c')
  let root: LayoutNode = a
  root = splitLeaf(root, 'a', 'row', b)
  root = splitLeaf(root, 'b', 'column', c)
  return root
}

describe('tiling geometry', () => {
  it('splits side by side and stacked', () => {
    const { tiles } = computeGeometry(threeTiles())
    expect(tiles.a).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(tiles.b).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    expect(tiles.c).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('dwindle splits along the longer visual axis', () => {
    expect(dwindleDir({ x: 0, y: 0, w: 1, h: 1 }, 16 / 9)).toBe('row')
    expect(dwindleDir({ x: 0, y: 0, w: 0.5, h: 1 }, 16 / 9)).toBe('column')
    expect(dwindleDir({ x: 0, y: 0, w: 1, h: 1 }, 9 / 16)).toBe('column')
  })

  it('respects placement=before', () => {
    const root = splitLeaf(leaf(note(1), 'a'), 'a', 'row', leaf(note(2), 'b'), 'before')
    const { tiles } = computeGeometry(root)
    expect(tiles.b!.x).toBe(0)
    expect(tiles.a!.x).toBe(0.5)
  })
})

describe('tree operations', () => {
  it('removing a leaf lets its sibling take the space', () => {
    const root = removeLeaf(threeTiles(), 'b')!
    const { tiles } = computeGeometry(root)
    expect(Object.keys(tiles).sort()).toEqual(['a', 'c'])
    expect(tiles.c).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })

  it('removing the only leaf returns null', () => {
    expect(removeLeaf(leaf(note(1), 'a'), 'a')).toBeNull()
  })

  it('clamps ratios and equalises', () => {
    let root = threeTiles()
    const splitId = root.id
    root = setRatio(root, splitId, 0.99)
    expect(root.type === 'split' && root.ratio).toBeLessThan(0.9)
    root = setRatio(root, splitId, 0.7)
    expect(computeGeometry(root).tiles.a!.w).toBeCloseTo(0.7)
    expect(computeGeometry(equalize(root)).tiles.a!.w).toBeCloseTo(0.5)
  })

  it('rotates the split that owns a leaf (togglesplit)', () => {
    const rotated = rotateParent(threeTiles(), 'c')
    const { tiles } = computeGeometry(rotated)
    expect(tiles.b).toEqual({ x: 0.5, y: 0, w: 0.25, h: 1 })
    expect(tiles.c).toEqual({ x: 0.75, y: 0, w: 0.25, h: 1 })
  })

  it('swaps contents without changing geometry', () => {
    const swapped = swapContents(threeTiles(), 'a', 'c')
    const byId = Object.fromEntries(leaves(swapped).map((l) => [l.id, l.content]))
    expect(byId.a).toEqual(note(3))
    expect(byId.c).toEqual(note(1))
  })

  it('remaps temp note ids to server ids', () => {
    const root = remapNote(threeTiles(), 2, 42)
    expect(leaves(root).find((l) => l.id === 'b')!.content).toEqual(note(42))
  })

  it('sanitize drops tiles for missing notes and never returns an empty tree', () => {
    const cleaned = sanitize(threeTiles(), (id) => id === 3)
    expect(leaves(cleaned).map((l) => l.id)).toEqual(['c'])
    const none = sanitize(threeTiles(), () => false)
    expect(leaves(none)).toHaveLength(1)
    expect(leaves(none)[0]!.content.kind).toBe('empty')
  })

  it('preserves identity of untouched leaves (no editor remounts)', () => {
    const before = threeTiles()
    const a = leaves(before).find((l) => l.id === 'a')
    const after = splitLeaf(before, 'c', 'row', leaf({ kind: 'empty' }, 'd'))
    expect(leaves(after).find((l) => l.id === 'a')).toBe(a)
  })
})

describe('directional focus', () => {
  const { tiles } = computeGeometry(threeTiles())

  it('moves to overlapping neighbours', () => {
    expect(neighbor(tiles, 'a', 'right')).toBe('b')
    expect(neighbor(tiles, 'b', 'down')).toBe('c')
    expect(neighbor(tiles, 'c', 'up')).toBe('b')
    expect(neighbor(tiles, 'c', 'left')).toBe('a')
  })

  it('returns null at the edge', () => {
    expect(neighbor(tiles, 'a', 'left')).toBeNull()
    expect(neighbor(tiles, 'b', 'up')).toBeNull()
  })
})

describe('persistence validation', () => {
  it('accepts valid trees and rejects junk', () => {
    expect(isLayoutNode(threeTiles())).toBe(true)
    expect(isLayoutNode({ type: 'leaf', id: 'x', content: { kind: 'note', noteId: '1' } })).toBe(false)
    expect(isLayoutNode(null)).toBe(false)
    expect(isLayoutNode({ type: 'split', id: 's', dir: 'diagonal', ratio: 0.5 })).toBe(false)
  })
})
