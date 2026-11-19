/** Where the floating selection toolbar goes (pure, so it can be tested without a DOM). */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacementInput {
  /** The selection / highlight rect in viewport coordinates. */
  rect: Box
  /** The tile's rect in viewport coordinates. */
  bounds: Box
  /** The toolbar's own size. */
  size: { width: number; height: number }
  /** Space kept to the tile edges. */
  margin?: number
  /** Space between the selection and the toolbar. */
  gap?: number
}

export interface Placement {
  /** Left edge, relative to the tile. */
  left: number
  /** Top edge, relative to the tile. */
  top: number
  side: 'above' | 'below'
  /** Where the selection's centre is along the toolbar (0..width), for the pointer notch. */
  notch: number
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, n))

/**
 * Centred over the selection, above it when there is room and below otherwise, always clamped inside the tile.
 * When neither side fits (a very tall selection) it is clamped into the tile.
 */
export function placeToolbar({ rect, bounds, size, margin = 8, gap = 10 }: PlacementInput): Placement {
  const centre = rect.x + rect.width / 2 - bounds.x
  const left = clamp(centre - size.width / 2, margin, bounds.width - size.width - margin)
  const selTop = rect.y - bounds.y
  const selBottom = selTop + rect.height
  const aboveTop = selTop - gap - size.height
  const belowTop = selBottom + gap
  let side: Placement['side'] = 'above'
  let top = aboveTop
  if (aboveTop < margin) {
    if (belowTop + size.height <= bounds.height - margin) {
      side = 'below'
      top = belowTop
    } else {
      top = clamp(aboveTop, margin, bounds.height - size.height - margin)
    }
  }
  return { left, top, side, notch: clamp(centre - left, 14, size.width - 14) }
}
