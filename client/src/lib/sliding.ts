/**
 * Sliding layout engine — scrollable tiling (Hyprland `scrolling`, niri, PaperWM).
 *
 * Tiles are arranged in columns on an infinite horizontal strip. Each column
 * has a width (a fraction of the viewport) and holds one or more stacked
 * tiles. The viewport scrolls horizontally to keep the focused column visible.
 *
 * Pure functions only. Columns reference tiles by id; tile contents live in
 * the shared layout tree so every other part of the app is mode-agnostic.
 */
import {
  computeGeometry,
  dwindleDir,
  leaf,
  newId,
  splitLeaf,
  type Direction,
  type LayoutNode,
  type LeafNode,
  type Rect,
} from './tiling'

export interface Column {
  id: string
  /** Fraction of the viewport width (MIN_WIDTH..1). */
  width: number
  /** Stacked tile ids, top to bottom. */
  tiles: string[]
  /** Width to return to when "zoom" (full width) is toggled off. */
  restore?: number
}

export const WIDTH_PRESETS = [1 / 3, 1 / 2, 2 / 3, 1] as const
export const DEFAULT_WIDTH = 1 / 2
export const MIN_WIDTH = 0.2
const EPS = 1e-6

export function newColumnId(): string {
  return newId('split').replace('split', 'col')
}

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH
  return Math.min(1, Math.max(MIN_WIDTH, width))
}

export function nearestPreset(width: number): number {
  let best: number = WIDTH_PRESETS[0]
  for (const p of WIDTH_PRESETS) if (Math.abs(p - width) < Math.abs(best - width)) best = p
  return best
}

export function column(tiles: string[], width = DEFAULT_WIDTH, id = newColumnId()): Column {
  return { id, width, tiles }
}

export function tileIdsOf(cols: Column[]): string[] {
  return cols.flatMap((c) => c.tiles)
}

export function columnIndexOf(cols: Column[], tileId: string): number {
  return cols.findIndex((c) => c.tiles.includes(tileId))
}

export function columnOf(cols: Column[], tileId: string): Column | null {
  return cols[columnIndexOf(cols, tileId)] ?? null
}

/** A lone column always fills the viewport; stored width returns once a second appears. */
export function effectiveWidth(cols: Column[], c: Column): number {
  return cols.length === 1 ? 1 : c.width
}

export interface SlidingGeometry {
  tiles: Record<string, Rect>
  columns: Array<{ id: string; x: number; w: number }>
  /** Total strip length in viewport widths. */
  total: number
}

export function geometry(cols: Column[]): SlidingGeometry {
  const tiles: Record<string, Rect> = {}
  const out: SlidingGeometry['columns'] = []
  let x = 0
  for (const c of cols) {
    const w = effectiveWidth(cols, c)
    out.push({ id: c.id, x, w })
    const n = c.tiles.length
    c.tiles.forEach((t, i) => {
      tiles[t] = { x, y: i / n, w, h: 1 / n }
    })
    x += w
  }
  return { tiles, columns: out, total: x }
}

export function clampScroll(cols: Column[], scrollX: number): number {
  const { total } = geometry(cols)
  const max = Math.max(0, total - 1)
  if (!Number.isFinite(scrollX)) return 0
  return Math.min(max, Math.max(0, scrollX))
}

/** Smallest scroll change that brings the tile's column fully into view. */
export function revealOffset(cols: Column[], tileId: string, scrollX: number): number {
  const g = geometry(cols)
  const col = g.columns[columnIndexOf(cols, tileId)]
  let s = scrollX
  if (col) {
    if (col.w >= 1 - EPS || col.x < s) s = col.x
    else if (col.x + col.w > s + 1 + EPS) s = col.x + col.w - 1
  }
  return clampScroll(cols, s)
}

export function insertColumn(
  cols: Column[],
  anchorTileId: string | null,
  tileId: string,
  placement: 'after' | 'before' = 'after',
  width = DEFAULT_WIDTH,
): Column[] {
  const created = column([tileId], width)
  const idx = anchorTileId ? columnIndexOf(cols, anchorTileId) : -1
  const at = idx < 0 ? (placement === 'after' ? cols.length : 0) : placement === 'after' ? idx + 1 : idx
  return [...cols.slice(0, at), created, ...cols.slice(at)]
}

/** Stack `tileId` inside the anchor's column. Falls back to a new column. */
export function stackTile(
  cols: Column[],
  anchorTileId: string,
  tileId: string,
  placement: 'after' | 'before' = 'after',
): Column[] {
  const ci = columnIndexOf(cols, anchorTileId)
  if (ci < 0) return insertColumn(cols, null, tileId, placement)
  return cols.map((c, i) => {
    if (i !== ci) return c
    const ti = c.tiles.indexOf(anchorTileId)
    const at = placement === 'after' ? ti + 1 : ti
    return { ...c, tiles: [...c.tiles.slice(0, at), tileId, ...c.tiles.slice(at)] }
  })
}

export function removeTile(cols: Column[], tileId: string): Column[] {
  return cols
    .map((c) => (c.tiles.includes(tileId) ? { ...c, tiles: c.tiles.filter((t) => t !== tileId) } : c))
    .filter((c) => c.tiles.length > 0)
}

/** Focus neighbour: left/right hop columns (landing at a similar row), up/down move within a stack. */
export function neighborTile(cols: Column[], tileId: string, dir: Direction): string | null {
  const ci = columnIndexOf(cols, tileId)
  if (ci < 0) return null
  const col = cols[ci]!
  const ti = col.tiles.indexOf(tileId)
  if (dir === 'up') return col.tiles[ti - 1] ?? null
  if (dir === 'down') return col.tiles[ti + 1] ?? null
  const target = cols[dir === 'left' ? ci - 1 : ci + 1]
  if (!target) return null
  const row =
    col.tiles.length === 1
      ? 0
      : Math.min(target.tiles.length - 1, Math.floor(((ti + 0.5) / col.tiles.length) * target.tiles.length))
  return target.tiles[row] ?? null
}

/** Move the tile's column left/right, or the tile up/down within its stack. */
export function swapTile(cols: Column[], tileId: string, dir: Direction): Column[] | null {
  const ci = columnIndexOf(cols, tileId)
  if (ci < 0) return null
  if (dir === 'left' || dir === 'right') {
    const other = dir === 'left' ? ci - 1 : ci + 1
    if (other < 0 || other >= cols.length) return null
    const next = [...cols]
    ;[next[ci], next[other]] = [next[other]!, next[ci]!]
    return next
  }
  const col = cols[ci]!
  const ti = col.tiles.indexOf(tileId)
  const other = dir === 'up' ? ti - 1 : ti + 1
  if (other < 0 || other >= col.tiles.length) return null
  const tiles = [...col.tiles]
  ;[tiles[ti], tiles[other]] = [tiles[other]!, tiles[ti]!]
  return cols.map((c, i) => (i === ci ? { ...c, tiles } : c))
}

function mapColumn(cols: Column[], colId: string, fn: (c: Column) => Column): Column[] {
  return cols.map((c) => (c.id === colId ? fn(c) : c))
}

export function setWidth(cols: Column[], colId: string, width: number): Column[] {
  return mapColumn(cols, colId, (c) => {
    const w = clampWidth(width)
    return w === c.width && c.restore === undefined ? c : { ...c, width: w, restore: undefined }
  })
}

/** Next preset wider than the current width (wrapping to the narrowest). */
export function nextPreset(width: number, step: 1 | -1 = 1): number {
  const presets = [...WIDTH_PRESETS]
  if (step === 1) return presets.find((p) => p > width + 0.01) ?? presets[0]!
  return [...presets].reverse().find((p) => p < width - 0.01) ?? presets[presets.length - 1]!
}

export function cycleWidth(cols: Column[], colId: string, step: 1 | -1 = 1): Column[] {
  return mapColumn(cols, colId, (c) => ({ ...c, width: nextPreset(c.width, step), restore: undefined }))
}

/** "Zoom": toggle a column between full width and its previous width. */
export function toggleFull(cols: Column[], colId: string): Column[] {
  return mapColumn(cols, colId, (c) =>
    c.width >= 1 - EPS
      ? { ...c, width: c.restore ?? DEFAULT_WIDTH, restore: undefined }
      : { ...c, restore: c.width, width: 1 },
  )
}

export function resetWidths(cols: Column[]): Column[] {
  return cols.map((c) => ({ ...c, width: DEFAULT_WIDTH, restore: undefined }))
}

/** Keep columns in step with the set of tiles that exist: drop missing, append new ones. */
export function reconcile(cols: Column[], tileIds: string[]): Column[] {
  const valid = new Set(tileIds)
  let changed = false
  let next = cols
    .map((c) => {
      const tiles = c.tiles.filter((t) => valid.has(t))
      if (tiles.length !== c.tiles.length) changed = true
      return tiles.length === c.tiles.length ? c : { ...c, tiles }
    })
    .filter((c) => c.tiles.length > 0)
  if (next.length !== cols.length) changed = true
  const present = new Set(tileIdsOf(next))
  for (const id of tileIds) {
    if (present.has(id)) continue
    next = [...next, column([id])]
    changed = true
  }
  return changed ? next : cols
}

/**
 * dwindle → sliding. Tiles are read left→right (then top→bottom); tiles that
 * share an x-range stack into one column. Widths snap to the nearest preset.
 */
export function fromTiles(tiles: Record<string, Rect>): Column[] {
  const q = (n: number) => Math.round(n * 1000)
  const entries = Object.entries(tiles).sort(([, a], [, b]) => q(a.x) - q(b.x) || a.y - b.y)
  const cols: Column[] = []
  const keys: string[] = []
  for (const [id, r] of entries) {
    const key = `${q(r.x)}:${q(r.w)}`
    const at = keys.indexOf(key)
    if (at >= 0) cols[at] = { ...cols[at]!, tiles: [...cols[at]!.tiles, id] }
    else {
      keys.push(key)
      cols.push(column([id], nearestPreset(r.w)))
    }
  }
  // A lone tile is full-width only because it is alone; give it the default once others join.
  if (cols.length === 1) return [{ ...cols[0]!, width: DEFAULT_WIDTH }]
  return cols
}

/** sliding → dwindle: replay the columns as successive dwindle splits. */
export function toTree(cols: Column[], leafOf: (id: string) => LeafNode, aspect: number): LayoutNode {
  const order = cols.flatMap((c) => c.tiles.map((t, i) => ({ id: t, stacked: i > 0 })))
  if (order.length === 0) return leaf({ kind: 'empty' })
  let root: LayoutNode = leafOf(order[0]!.id)
  let prev = order[0]!.id
  for (const { id, stacked } of order.slice(1)) {
    const rect = computeGeometry(root).tiles[prev] ?? { x: 0, y: 0, w: 1, h: 1 }
    const dir = stacked ? 'column' : dwindleDir(rect, aspect)
    root = splitLeaf(root, prev, dir, leafOf(id), 'after')
    prev = id
  }
  return root
}

export function isColumns(value: unknown): value is Column[] {
  return (
    Array.isArray(value) &&
    value.every((c) => {
      const o = c as Record<string, unknown> | null
      return (
        !!o &&
        typeof o.id === 'string' &&
        typeof o.width === 'number' &&
        Array.isArray(o.tiles) &&
        o.tiles.every((t) => typeof t === 'string')
      )
    })
  )
}
