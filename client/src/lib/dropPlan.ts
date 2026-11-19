/**
 * Drag-and-drop placement, as pure functions over the layout: which zone of a tile the pointer is in, and what a drop
 * there will do — including the exact rectangle the dropped tile or note will occupy afterwards, computed by running
 * the move on a copy of the layout. The workspace previews that rectangle while dragging and performs the same plan
 * on drop, so what you see is what you get.
 */
import * as slide from './sliding'
import { computeGeometry, dwindleDir, findLeaf, leaf, leaves, removeLeaf, splitLeaf, type LayoutNode, type Rect, type SplitDir } from './tiling'

/**
 * Edges split on that side; the small centre replaces (a note) or swaps (a tile); the ring between them is `auto`,
 * which splits the way dwindle would (along the tile's longer side, new tile after).
 */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'auto'

export const EDGE_BAND = 0.22
export const CENTER_BOX = 0.12

/** The zone at a point given as fractions of the tile's width and height. */
export function zoneAt(fx: number, fy: number): DropZone {
  const distances: Array<[DropZone, number]> = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ]
  const [edge, d] = distances.sort((a, b) => a[1] - b[1])[0]!
  if (d < EDGE_BAND) return edge
  if (Math.abs(fx - 0.5) <= CENTER_BOX && Math.abs(fy - 0.5) <= CENTER_BOX) return 'center'
  return 'auto'
}

/** Direction and side of the split a zone asks for (null for `center`). `rect` is the target tile's box. */
export function splitFor(zone: DropZone, rect: Rect, aspect: number): { dir: SplitDir; placement: 'before' | 'after' } | null {
  switch (zone) {
    case 'center':
      return null
    case 'auto':
      return { dir: dwindleDir(rect, aspect), placement: 'after' }
    case 'left':
    case 'right':
      return { dir: 'row', placement: zone === 'left' ? 'before' : 'after' }
    default:
      return { dir: 'column', placement: zone === 'top' ? 'before' : 'after' }
  }
}

export interface LayoutSnapshot {
  root: LayoutNode
  columns: slide.Column[]
  mode: 'dwindle' | 'sliding'
  aspect: number
}

/** What is being dropped: a tile picked up by its header, or a note (with the tile already showing it, if any). */
export type DropSource = { kind: 'tile'; tileId: string } | { kind: 'note'; showingIn: string | null }

export interface DropPlan {
  action: 'replace' | 'swap' | 'split'
  dir?: SplitDir
  placement?: 'before' | 'after'
  /** Where the dropped content ends up, in the same units as the slots (strip fractions; sliding: viewport widths). */
  rect: Rect
  label: string
}

const PROBE = '__drop-probe__'

function tileRects(s: Pick<LayoutSnapshot, 'root' | 'columns' | 'mode'>): Record<string, Rect> {
  return s.mode === 'sliding' ? slide.geometry(s.columns).tiles : computeGeometry(s.root).tiles
}

function splitLabel(dir: SplitDir, placement: 'before' | 'after', auto: boolean): string {
  const side = dir === 'row' ? (placement === 'before' ? 'left' : 'right') : placement === 'before' ? 'above' : 'below'
  return `${auto ? 'Auto · ' : ''}Split ${side}`
}

/** The plan for dropping `source` on `targetId` at `zone`, or null when the drop would do nothing. */
export function planDrop(s: LayoutSnapshot, source: DropSource, targetId: string, zone: DropZone): DropPlan | null {
  const rects = tileRects(s)
  const target = rects[targetId]
  if (!target || !findLeaf(s.root, targetId)) return null
  // The tile being moved away from its old place (a picked-up tile, or a note already open elsewhere).
  const moving = source.kind === 'tile' ? source.tileId : source.showingIn
  if (source.kind === 'tile' && moving === targetId) return null

  const split = splitFor(zone, target, s.aspect)
  if (!split) {
    return source.kind === 'tile'
      ? { action: 'swap', rect: target, label: 'Swap' }
      : { action: 'replace', rect: target, label: moving === targetId ? 'Already here' : 'Open here' }
  }
  // A note already showing in the target cannot split off itself.
  if (source.kind === 'note' && moving === targetId) return null

  const count = leaves(s.root).length
  const removeFirst = moving != null && moving !== targetId && count > 1
  const probeId = source.kind === 'tile' ? source.tileId : PROBE
  let rect: Rect | undefined
  if (s.mode === 'sliding') {
    const base = removeFirst ? slide.removeTile(s.columns, moving!) : s.columns
    const cols = split.dir === 'column' ? slide.stackTile(base, targetId, probeId, split.placement) : slide.insertColumn(base, targetId, probeId, split.placement)
    rect = slide.geometry(cols).tiles[probeId]
  } else {
    const base = removeFirst ? removeLeaf(s.root, moving!) : s.root
    if (!base) return null
    const probe = source.kind === 'tile' ? (findLeaf(s.root, source.tileId) ?? leaf({ kind: 'empty' }, probeId)) : leaf({ kind: 'empty' }, probeId)
    rect = computeGeometry(splitLeaf(base, targetId, split.dir, probe, split.placement)).tiles[probeId]
  }
  if (!rect) return null
  return { action: 'split', dir: split.dir, placement: split.placement, rect, label: splitLabel(split.dir, split.placement, zone === 'auto') }
}
