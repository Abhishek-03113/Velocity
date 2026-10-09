/**
 * Tiling layout engine — a Hyprland "dwindle"-style binary split tree.
 *
 * Pure functions only (no React / store imports) so the geometry and tree
 * operations are trivially unit-testable. Rects are expressed as fractions of
 * the workspace (0..1) so the renderer can absolutely-position tiles and never
 * remount an editor when the tree shape changes.
 */

export type TileMode = 'edit' | 'read'

export type TileContent =
  | { kind: 'note'; noteId: number; mode: TileMode }
  | { kind: 'board'; noteId: number }
  | { kind: 'empty' }

export type SplitDir = 'row' | 'column' // row = side by side, column = stacked

export interface LeafNode {
  type: 'leaf'
  id: string
  content: TileContent
}

export interface SplitNode {
  type: 'split'
  id: string
  dir: SplitDir
  /** Fraction of the split given to `a` (left / top). */
  ratio: number
  a: LayoutNode
  b: LayoutNode
}

export type LayoutNode = LeafNode | SplitNode

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SplitGeometry {
  id: string
  dir: SplitDir
  ratio: number
  rect: Rect
}

export type Direction = 'left' | 'right' | 'up' | 'down'

export const MIN_RATIO = 0.12
export const MAX_RATIO = 0.88

let idCounter = 0
export function newId(prefix: 'tile' | 'split' = 'tile'): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

export function leaf(content: TileContent, id = newId('tile')): LeafNode {
  return { type: 'leaf', id, content }
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

export function leaves(node: LayoutNode): LeafNode[] {
  if (node.type === 'leaf') return [node]
  return [...leaves(node.a), ...leaves(node.b)]
}

export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  if (node.type === 'leaf') return node.id === id ? node : null
  return findLeaf(node.a, id) ?? findLeaf(node.b, id)
}

export function findLeafBy(
  node: LayoutNode,
  predicate: (leaf: LeafNode) => boolean,
): LeafNode | null {
  return leaves(node).find(predicate) ?? null
}

export function noteLeafFor(node: LayoutNode, noteId: number): LeafNode | null {
  return findLeafBy(node, (l) => l.content.kind === 'note' && l.content.noteId === noteId)
}

export function boardLeafFor(node: LayoutNode, noteId: number): LeafNode | null {
  return findLeafBy(node, (l) => l.content.kind === 'board' && l.content.noteId === noteId)
}

/** Note id a tile is "about" (note and board tiles both belong to a note). */
export function tileNoteId(content: TileContent): number | null {
  return content.kind === 'empty' ? null : content.noteId
}

/** Map every leaf (and split) to its rect inside `bounds`. */
export function computeGeometry(
  node: LayoutNode,
  bounds: Rect = { x: 0, y: 0, w: 1, h: 1 },
): { tiles: Record<string, Rect>; splits: SplitGeometry[] } {
  const tiles: Record<string, Rect> = {}
  const splits: SplitGeometry[] = []

  const walk = (n: LayoutNode, r: Rect) => {
    if (n.type === 'leaf') {
      tiles[n.id] = r
      return
    }
    splits.push({ id: n.id, dir: n.dir, ratio: n.ratio, rect: r })
    if (n.dir === 'row') {
      const wa = r.w * n.ratio
      walk(n.a, { x: r.x, y: r.y, w: wa, h: r.h })
      walk(n.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h })
    } else {
      const ha = r.h * n.ratio
      walk(n.a, { x: r.x, y: r.y, w: r.w, h: ha })
      walk(n.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha })
    }
  }

  walk(node, bounds)
  return { tiles, splits }
}

/**
 * Dwindle rule: split along the longer visual axis. `aspect` is the workspace
 * width / height in pixels, since rects are normalised fractions.
 */
export function dwindleDir(rect: Rect, aspect: number): SplitDir {
  return rect.w * aspect >= rect.h ? 'row' : 'column'
}

function mapNode(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode | null): LayoutNode | null {
  const mapped = fn(node)
  if (mapped !== node) return mapped
  if (node.type === 'leaf') return node
  const a = mapNode(node.a, fn)
  const b = mapNode(node.b, fn)
  if (a === node.a && b === node.b) return node
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

/** Replace `targetId` with a split holding the old leaf and `inserted`. */
export function splitLeaf(
  root: LayoutNode,
  targetId: string,
  dir: SplitDir,
  inserted: LeafNode,
  placement: 'after' | 'before' = 'after',
): LayoutNode {
  return (
    mapNode(root, (n) => {
      if (n.type !== 'leaf' || n.id !== targetId) return n
      return {
        type: 'split',
        id: newId('split'),
        dir,
        ratio: 0.5,
        a: placement === 'after' ? n : inserted,
        b: placement === 'after' ? inserted : n,
      }
    }) ?? root
  )
}

/** Remove a leaf; its sibling takes over the parent's space. Returns null if nothing remains. */
export function removeLeaf(root: LayoutNode, id: string): LayoutNode | null {
  return mapNode(root, (n) => (n.type === 'leaf' && n.id === id ? null : n))
}

export function updateLeaf(
  root: LayoutNode,
  id: string,
  update: (content: TileContent) => TileContent,
): LayoutNode {
  return (
    mapNode(root, (n) => {
      if (n.type !== 'leaf' || n.id !== id) return n
      const content = update(n.content)
      return content === n.content ? n : { ...n, content }
    }) ?? root
  )
}

export function setRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  return (
    mapNode(root, (n) =>
      n.type === 'split' && n.id === splitId ? { ...n, ratio: clampRatio(ratio) } : n,
    ) ?? root
  )
}

export function equalize(root: LayoutNode): LayoutNode {
  if (root.type === 'leaf') return root
  return { ...root, ratio: 0.5, a: equalize(root.a), b: equalize(root.b) }
}

/** Hyprland `togglesplit`: flip the orientation of the split that owns `leafId`. */
export function rotateParent(root: LayoutNode, leafId: string): LayoutNode {
  const parent = parentOf(root, leafId)
  if (!parent) return root
  return (
    mapNode(root, (n) =>
      n.type === 'split' && n.id === parent.id
        ? { ...n, dir: n.dir === 'row' ? 'column' : 'row' }
        : n,
    ) ?? root
  )
}

export function parentOf(root: LayoutNode, id: string): SplitNode | null {
  if (root.type === 'leaf') return null
  if (root.a.id === id || root.b.id === id) return root
  return parentOf(root.a, id) ?? parentOf(root.b, id)
}

export function swapContents(root: LayoutNode, aId: string, bId: string): LayoutNode {
  const a = findLeaf(root, aId)
  const b = findLeaf(root, bId)
  if (!a || !b || a === b) return root
  return (
    mapNode(root, (n) => {
      if (n.type !== 'leaf') return n
      if (n.id === aId) return { ...n, content: b.content }
      if (n.id === bId) return { ...n, content: a.content }
      return n
    }) ?? root
  )
}

/**
 * Geometric nearest neighbour in `dir`. Candidates must lie fully past the
 * source edge; among them prefer the one overlapping most on the perpendicular
 * axis, then the closest.
 */
export function neighbor(
  tiles: Record<string, Rect>,
  fromId: string,
  dir: Direction,
): string | null {
  const from = tiles[fromId]
  if (!from) return null
  const eps = 1e-6
  let best: { id: string; score: number } | null = null

  for (const [id, r] of Object.entries(tiles)) {
    if (id === fromId) continue
    let gap: number
    let overlap: number
    switch (dir) {
      case 'right':
        if (r.x < from.x + from.w - eps) continue
        gap = r.x - (from.x + from.w)
        overlap = Math.min(r.y + r.h, from.y + from.h) - Math.max(r.y, from.y)
        break
      case 'left':
        if (r.x + r.w > from.x + eps) continue
        gap = from.x - (r.x + r.w)
        overlap = Math.min(r.y + r.h, from.y + from.h) - Math.max(r.y, from.y)
        break
      case 'down':
        if (r.y < from.y + from.h - eps) continue
        gap = r.y - (from.y + from.h)
        overlap = Math.min(r.x + r.w, from.x + from.w) - Math.max(r.x, from.x)
        break
      case 'up':
        if (r.y + r.h > from.y + eps) continue
        gap = from.y - (r.y + r.h)
        overlap = Math.min(r.x + r.w, from.x + from.w) - Math.max(r.x, from.x)
        break
    }
    // Overlapping neighbours always beat diagonal ones.
    const score = (overlap > eps ? 0 : 10) + gap - Math.max(0, overlap) * 0.01
    if (!best || score < best.score) best = { id, score }
  }
  return best?.id ?? null
}

/** Rebuild the tree with only notes that still exist; drop temp ids from storage. */
export function sanitize(
  root: LayoutNode,
  isValidNote: (id: number) => boolean,
): LayoutNode {
  const cleaned = mapNode(root, (n) => {
    if (n.type !== 'leaf') return n
    const noteId = tileNoteId(n.content)
    if (noteId == null) return n
    return isValidNote(noteId) ? n : null
  })
  return cleaned ?? leaf({ kind: 'empty' })
}

export function remapNote(root: LayoutNode, from: number, to: number): LayoutNode {
  return (
    mapNode(root, (n) => {
      if (n.type !== 'leaf' || n.content.kind === 'empty') return n
      if (n.content.noteId !== from) return n
      return { ...n, content: { ...n.content, noteId: to } }
    }) ?? root
  )
}

/** Structural validation for data loaded from localStorage. */
export function isLayoutNode(value: unknown, depth = 0): value is LayoutNode {
  if (depth > 32 || typeof value !== 'object' || value === null) return false
  const n = value as Record<string, unknown>
  if (typeof n.id !== 'string') return false
  if (n.type === 'leaf') {
    const c = n.content as Record<string, unknown> | undefined
    if (!c || typeof c !== 'object') return false
    if (c.kind === 'empty') return true
    if (c.kind === 'board') return typeof c.noteId === 'number'
    if (c.kind === 'note') return typeof c.noteId === 'number' && (c.mode === 'edit' || c.mode === 'read')
    return false
  }
  if (n.type === 'split') {
    return (
      (n.dir === 'row' || n.dir === 'column') &&
      typeof n.ratio === 'number' &&
      isLayoutNode(n.a, depth + 1) &&
      isLayoutNode(n.b, depth + 1)
    )
  }
  return false
}
