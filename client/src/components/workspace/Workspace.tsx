import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { COMPACT_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { NOTE_DRAG_TYPE, TILE_DRAG_TYPE } from '../../lib/groupColors'
import { contentForNote, primaryLeafFor } from '../../lib/noteViews'
import { planDrop, zoneAt, type DropPlan, type DropSource, type DropZone } from '../../lib/dropPlan'
import { clampScroll } from '../../lib/sliding'
import { EASE, animate, reducedMotion, rubberBandClamp } from '../../lib/motion'
import { geometry as slidingGeometry } from '../../lib/sliding'
import { computeGeometry, leaves, type Rect, type SplitGeometry } from '../../lib/tiling'
import { useLayoutStore } from '../../store/layoutStore'
import { useEditorStore } from '../../store/editorStore'
import { placeNoteInTile } from '../../lib/workspace'
import { ColumnMap } from './ColumnMap'
import { Tile } from './Tile'
import styles from './Workspace.module.css'

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
/** How far (px) the sliding strip stretches past an end while dragged / wheeled (rubber banding). */
const PAN_STRETCH = 120
const WHEEL_STRETCH = 60

/**
 * A tile that moved without resizing (swap, move to another slot): a short wind-up (anticipation), travel on an arc
 * instead of a straight line, a small squash on landing, and the header title arriving a beat later
 * (follow-through). Transforms only, inside the FLIP pass; the frame finishes in 300 ms.
 */
function moveTile(el: HTMLElement, dx: number, dy: number) {
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  // Tiles passing each other take opposite arcs: rightward goes up, leftward goes down (and likewise vertically).
  const lift = Math.min(24, Math.hypot(dx, dy) * 0.08)
  const ax = horizontal ? 0 : dy > 0 ? lift : -lift
  const ay = horizontal ? (dx > 0 ? lift : -lift) : 0
  const squash = horizontal ? 'scale(1.02, 0.98)' : 'scale(0.98, 1.02)'
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, easing: EASE.out },
      { transform: `translate(${dx}px, ${dy}px) scale(0.97)`, offset: 0.2, easing: EASE.inOut },
      { transform: `translate(${dx / 2 + ax}px, ${dy / 2 + ay}px) scale(1.015)`, offset: 0.55, easing: EASE.inOut },
      { transform: `translate(0px, 0px) ${squash}`, offset: 0.85, easing: EASE.out },
      { transform: 'none' },
    ],
    { duration: 300 },
  )
  const title = el.querySelector<HTMLElement>('[data-tile-title]')
  const nudge = horizontal ? (dx > 0 ? 8 : -8) : 0
  if (title && nudge)
    title.animate(
      [{ transform: `translateX(${nudge}px)` }, { transform: `translateX(${-nudge * 0.4}px)`, offset: 0.7 }, { transform: 'none' }],
      { duration: 140, delay: 230, easing: EASE.out, fill: 'backwards' },
    )
}

function tileStyle(r: Rect, gapped: boolean): React.CSSProperties {
  if (!gapped) {
    return {
      left: `${r.x * 100}%`,
      top: `${r.y * 100}%`,
      width: `${r.w * 100}%`,
      height: `${r.h * 100}%`,
    }
  }
  // Uniform gaps: half a gap on every side, and the container pads by half a gap.
  return {
    left: `calc(${r.x * 100}% + var(--tile-gap) / 2)`,
    top: `calc(${r.y * 100}% + var(--tile-gap) / 2)`,
    width: `calc(${r.w * 100}% - var(--tile-gap))`,
    height: `calc(${r.h * 100}% - var(--tile-gap))`,
  }
}

function dividerStyle(s: SplitGeometry): React.CSSProperties {
  const { rect, ratio, dir } = s
  if (dir === 'row') {
    const x = rect.x + rect.w * ratio
    return { left: `calc(${x * 100}% - 4px)`, top: `${rect.y * 100}%`, width: '8px', height: `${rect.h * 100}%` }
  }
  const y = rect.y + rect.h * ratio
  return { top: `calc(${y * 100}% - 4px)`, left: `${rect.x * 100}%`, height: '8px', width: `${rect.w * 100}%` }
}

/** Zone of the slot under a drag event. */
function zoneFor(e: { clientX: number; clientY: number }, el: HTMLElement): DropZone {
  const r = el.getBoundingClientRect()
  return zoneAt((e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1))
}

/**
 * Tiling workspace. Tiles are absolutely positioned from the layout tree and
 * keyed by tile id, so splitting/closing/swapping animates geometry without
 * ever remounting an editor.
 */
export default function Workspace() {
  const { root, focusedId, zoomedId, setRatio, setAspect, mode, columns, scrollX, setColumnWidth, scrollTo } =
    useLayoutStore(
      useShallow((s) => ({
        root: s.root,
        focusedId: s.focusedId,
        zoomedId: s.zoomedId,
        setRatio: s.setRatio,
        setAspect: s.setAspect,
        mode: s.mode,
        columns: s.columns,
        scrollX: s.scrollX,
        setColumnWidth: s.setColumnWidth,
        scrollTo: s.scrollTo,
      })),
    )
  const compact = useMediaQuery(COMPACT_QUERY)
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ tileId: string; zone: DropZone; tile: boolean } | null>(null)
  const draggedTile = useRef<string | null>(null)
  const draggedNote = useRef<number | null>(null)
  // Sliding mode: the strip offset while a pan gesture runs (written straight to the DOM), null otherwise.
  const panning = useRef<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef(new Map<string, HTMLDivElement>())
  const lastBoxes = useRef(new Map<string, { x: number; y: number; w: number; h: number }>())
  const lastStage = useRef({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      if (height > 0) setAspect(width / height)
      // Re-baseline the FLIP boxes: the next tile move animates from where tiles are now, at this size.
      const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
      for (const [id, slot] of slotRefs.current) boxes.set(id, { x: slot.offsetLeft, y: slot.offsetTop, w: slot.offsetWidth, h: slot.offsetHeight })
      lastBoxes.current = boxes
      lastStage.current = { w: stageRef.current?.clientWidth ?? 0, h: stageRef.current?.clientHeight ?? 0 }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [setAspect])

  const all = useMemo(() => leaves(root), [root])
  const sliding = mode === 'sliding'
  const slideGeo = useMemo(() => (sliding ? slidingGeometry(columns) : null), [sliding, columns])
  const geometry = useMemo(
    () => (slideGeo ? { tiles: slideGeo.tiles, splits: [] as SplitGeometry[] } : computeGeometry(root)),
    [root, slideGeo],
  )
  // Stable DOM order (creation order) — reordering would detach live editors.
  const ordered = useMemo(() => [...all].sort((a, b) => (a.id < b.id ? -1 : 1)), [all])

  const monocleId = compact ? focusedId : zoomedId
  const tiled = all.length > 1 && !monocleId
  const strip = sliding && !monocleId
  const stripScroll = strip ? scrollX : 0
  const total = slideGeo?.total ?? 1
  const showMap = strip && columns.length > 1

  // FLIP: after a layout change, each moved or resized tile starts where it was (an inverse transform) and glides to
  // its new box on the compositor. Its content is laid out once, at the final size, instead of on every frame.
  // Boxes are offsets inside the strip, so panning the sliding strip never counts as movement.
  useLayoutEffect(() => {
    const prev = lastBoxes.current
    const next = new Map<string, { x: number; y: number; w: number; h: number }>()
    // The window or sidebar resizing the whole stage is not a tile moving: no animation then.
    const stage = { w: stageRef.current?.clientWidth ?? 0, h: stageRef.current?.clientHeight ?? 0 }
    const sameStage = stage.w === lastStage.current.w && stage.h === lastStage.current.h
    lastStage.current = stage
    const animate = sameStage && !resizing && !reducedMotion()
    for (const [id, el] of slotRefs.current) {
      const box = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
      next.set(id, box)
      const was = prev.get(id)
      if (!animate || !was || box.w === 0 || box.h === 0) continue
      const dx = was.x - box.x
      const dy = was.y - box.y
      const sx = was.w / box.w
      const sy = was.h / box.h
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue
      el.getAnimations().forEach((a) => a.cancel())
      const moved = Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02 && Math.hypot(dx, dy) > 40
      if (moved) moveTile(el, dx, dy)
      else
        el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }], {
          duration: 280,
          easing: EASE.spring,
        })
    }
    lastBoxes.current = next
  }, [geometry, monocleId, tiled, resizing, slideGeo])

  const startResize = useCallback(
    (split: SplitGeometry) => (e: PointerEvent<HTMLDivElement>) => {
      const el = stageRef.current
      if (!el) return
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      setResizing(split.id)
      const bounds = el.getBoundingClientRect()
      // Pointer events can outpace the display: apply at most one ratio per frame.
      let frame = 0
      let latest: globalThis.PointerEvent | null = null
      const apply = () => {
        frame = 0
        const ev = latest
        if (!ev) return
        if (split.dir === 'row') {
          const x = (ev.clientX - bounds.left) / bounds.width
          setRatio(split.id, (x - split.rect.x) / split.rect.w)
        } else {
          const y = (ev.clientY - bounds.top) / bounds.height
          setRatio(split.id, (y - split.rect.y) / split.rect.h)
        }
      }
      const onMove = (ev: globalThis.PointerEvent) => {
        latest = ev
        if (!frame) frame = requestAnimationFrame(apply)
      }
      const onUp = () => {
        if (frame) cancelAnimationFrame(frame)
        apply()
        setResizing(null)
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        target.removeEventListener('pointercancel', onUp)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
      target.addEventListener('pointercancel', onUp)
    },
    [setRatio],
  )

  const startColumnResize = useCallback(
    (col: { id: string; x: number }) => (e: PointerEvent<HTMLDivElement>) => {
      const el = stageRef.current
      if (!el) return
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      setResizing(col.id)
      const bounds = el.getBoundingClientRect()
      const onMove = (ev: globalThis.PointerEvent) => {
        const edge = (ev.clientX - bounds.left) / bounds.width + useLayoutStore.getState().scrollX
        setColumnWidth(col.id, edge - col.x)
      }
      const onUp = () => {
        setResizing(null)
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        target.removeEventListener('pointercancel', onUp)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
      target.addEventListener('pointercancel', onUp)
    },
    [setColumnWidth],
  )

  /** Show a strip offset without touching the store (see the wheel handler). */
  const showPan = useCallback((x: number) => {
    panning.current = x
    if (stripRef.current) stripRef.current.style.transform = `translateX(${-x * 100}%)`
    if (containerRef.current) containerRef.current.dataset.scroll = x.toFixed(3)
  }, [])
  /** Hand the gesture's final offset to the store (persisted, drives edges and the column map). */
  const commitPan = useCallback(() => {
    const x = panning.current
    panning.current = null
    if (x != null) scrollTo(x)
  }, [scrollTo])

  /**
   * Rubber banding: an offset past either end of the strip, drawn with growing resistance.
   * `stretchPx` is how far (in px) the strip can be pulled past an end.
   */
  const stretchPan = useCallback((raw: number, width: number, stretchPx: number) => {
    const cols = useLayoutStore.getState().columns
    return rubberBandClamp(raw, clampScroll(cols, -Infinity), clampScroll(cols, Infinity), stretchPx / width)
  }, [])
  /** End a pan: spring back inside the bounds if it was stretched, then commit. */
  const settlePan = useCallback(() => {
    const x = panning.current
    if (x == null) return
    const settled = clampScroll(useLayoutStore.getState().columns, x)
    if (Math.abs(settled - x) > 1e-4 && stripRef.current) {
      animate(stripRef.current, [{ transform: `translateX(${-x * 100}%)` }, { transform: `translateX(${-settled * 100}%)` }], {
        duration: 260,
        easing: EASE.overshoot,
      })
      showPan(settled)
    }
    commitPan()
  }, [showPan, commitPan])

  // Horizontal wheel / trackpad scroll pans the strip (vertical scroll stays with the notes).
  useEffect(() => {
    const el = containerRef.current
    if (!el || !strip) return
    // The pan is written straight to the strip's transform while the gesture runs and committed to the store once
    // it settles, so a trackpad flick does not re-render the whole workspace on every wheel event.
    let settle: ReturnType<typeof setTimeout> | null = null
    let wheelRaw: number | null = null
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey
      if (!horizontal) return
      e.preventDefault()
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      const width = el.clientWidth || 1
      // Track the raw offset so overscroll stretches (rubber band) and springs back once the gesture settles.
      wheelRaw = (wheelRaw ?? panning.current ?? useLayoutStore.getState().scrollX) + delta / width
      showPan(stretchPan(wheelRaw, width, WHEEL_STRETCH))
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => {
        wheelRaw = null
        settlePan()
      }, 120)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (settle) clearTimeout(settle)
      commitPan()
    }
  }, [strip, showPan, commitPan, settlePan, stretchPan])

  // While a note is dragged, frames inside tiles (the EPUB reader, previews) would swallow the drag events and the
  // tile under them could never become a drop target: make them transparent to the pointer until the drag ends.
  // dragstart is caught bubbling, after the row or tab has put the note on the drag.
  useEffect(() => {
    const root = document.documentElement
    const start = (e: globalThis.DragEvent) => {
      const types = e.dataTransfer?.types ?? []
      if (types.includes(NOTE_DRAG_TYPE) || types.includes(TILE_DRAG_TYPE)) root.dataset.noteDrag = ''
      // dragover cannot read the payload: remember which tile is being carried.
      draggedTile.current = types.includes(TILE_DRAG_TYPE)
        ? ((e.target as Element | null)?.closest?.('[data-tile-id]')?.getAttribute('data-tile-id') ?? null)
        : null
      // The data store is readable during dragstart (not during dragover): note which note is carried for previews.
      const note = Number(e.dataTransfer?.getData(NOTE_DRAG_TYPE))
      draggedNote.current = Number.isFinite(note) && note !== 0 ? note : null
    }
    const end = () => {
      delete root.dataset.noteDrag
      draggedTile.current = null
      draggedNote.current = null
      setDrop(null)
    }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end, true)
    window.addEventListener('drop', end, true)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end, true)
      window.removeEventListener('drop', end, true)
      end()
    }
  }, [])

  // Drag the empty space between tiles to pan the strip.
  const onStripPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!strip || e.button !== 0) return
    if (e.target !== e.currentTarget) return
    const el = containerRef.current
    if (!el) return
    const startX = e.clientX
    const startScroll = useLayoutStore.getState().scrollX
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    setResizing('pan')
    const onMove = (ev: globalThis.PointerEvent) =>
      showPan(stretchPan(startScroll - (ev.clientX - startX) / (el.clientWidth || 1), el.clientWidth || 1, PAN_STRETCH))
    const onUp = () => {
      settlePan()
      setResizing(null)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  // Drag and drop, delegated to the strip: one set of handlers finds the slot under the pointer.
  const slotAt = (e: DragEvent<HTMLDivElement>): HTMLElement | null =>
    (e.target as Element | null)?.closest?.<HTMLElement>('[data-slot-id]') ?? null

  const snapshot = () => {
    const s = useLayoutStore.getState()
    return { root: s.root, columns: s.columns, mode: s.mode, aspect: s.aspect }
  }

  const sourceOf = (tile: boolean, noteId: number | null): DropSource | null => {
    if (tile) return draggedTile.current ? { kind: 'tile', tileId: draggedTile.current } : null
    const layout = useLayoutStore.getState()
    return { kind: 'note', showingIn: noteId != null ? (primaryLeafFor(layout.root, noteId)?.id ?? null) : null }
  }

  const onStripDragOver = (e: DragEvent<HTMLDivElement>) => {
    const tile = e.dataTransfer.types.includes(TILE_DRAG_TYPE)
    if (!tile && !e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return
    const slot = slotAt(e)
    const tileId = slot?.dataset.slotId
    // A tile cannot be dropped on itself.
    if (!slot || !tileId || (tile && draggedTile.current === tileId)) {
      setDrop(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = tile ? 'move' : 'copy'
    const zone = zoneFor(e, slot)
    setDrop((d) => (d?.tileId === tileId && d.zone === zone && d.tile === tile ? d : { tileId, zone, tile }))
  }

  const onStripDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDrop(null)
  }

  const onStripDrop = (e: DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types
    if (!types.includes(TILE_DRAG_TYPE) && !types.includes(NOTE_DRAG_TYPE)) return
    const slot = slotAt(e)
    const tileId = slot?.dataset.slotId
    setDrop(null)
    if (!slot || !tileId) return
    e.preventDefault()
    e.stopPropagation()
    const zone = zoneFor(e, slot)
    const tileSource = e.dataTransfer.getData(TILE_DRAG_TYPE)
    if (tileSource) {
      useLayoutStore.getState().moveTile(tileSource, tileId, zone)
      return
    }
    const noteId = Number(e.dataTransfer.getData(NOTE_DRAG_TYPE))
    if (!Number.isFinite(noteId) || noteId === 0) return
    const plan = planDrop(snapshot(), sourceOf(false, noteId)!, tileId, zone)
    if (!plan) return
    if (plan.action !== 'split') {
      placeNoteInTile(tileId, noteId)
      return
    }
    // Dragging a visible note to another tile's edge moves it there.
    const layout = useLayoutStore.getState()
    const visible = primaryLeafFor(layout.root, noteId)
    if (visible && visible.id !== tileId && leaves(layout.root).length > 1) layout.close(visible.id)
    useLayoutStore.getState().split(plan.dir!, contentForNote(noteId), { targetId: tileId, placement: plan.placement })
    useEditorStore.getState().activateNote(noteId)
  }

  // The preview: exactly where the drop will put the tile or note (the plan is the one the drop performs).
  const plan: DropPlan | null = useMemo(() => {
    if (!drop) return null
    const source = sourceOf(drop.tile, draggedNote.current)
    return source ? planDrop(snapshot(), source, drop.tileId, drop.zone) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop, root, columns])

  return (
    <div
      ref={containerRef}
      className={`${styles.workspace} ${tiled ? styles.tiled : ''} ${resizing ? styles.resizing : ''} ${
        showMap ? styles.hasMap : ''
      }`}
      data-tiles={all.length}
      data-tiling-mode={mode}
      // Focusing an input inside an off-screen column must not scroll the clipped container natively.
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0
        e.currentTarget.scrollTop = 0
      }}
      data-scroll={strip ? stripScroll.toFixed(3) : undefined}
    >
      <div ref={stageRef} className={styles.stage}>
      <div
        ref={stripRef}
        className={`${styles.strip} ${strip ? styles.stripSliding : ''}`}
        style={strip ? { transform: `translateX(${-(panning.current ?? stripScroll) * 100}%)` } : undefined}
        onPointerDown={onStripPointerDown}
        // Capture phase: a note or tile dropped on an editor must be placed by the workspace, not inserted as text by
        // CodeMirror (which would see the drop first while bubbling). Other drags (text, files) pass through.
        onDragOverCapture={onStripDragOver}
        onDragEnterCapture={onStripDragOver}
        onDragLeave={onStripDragLeave}
        onDropCapture={onStripDrop}
        data-strip
      >
      {ordered.map((leaf) => {
        const rect = monocleId ? FULL : (geometry.tiles[leaf.id] ?? FULL)
        const hidden = monocleId != null && leaf.id !== monocleId
        return (
          <div
            key={leaf.id}
            ref={(el) => {
              if (el) slotRefs.current.set(leaf.id, el)
              else slotRefs.current.delete(leaf.id)
            }}
            className={`${styles.slot} ${hidden ? styles.hidden : ''}`}
            style={tileStyle(rect, tiled)}
            data-slot-id={leaf.id}
          >
            <Tile leaf={leaf} focused={leaf.id === focusedId} tiled={tiled} zoomed={zoomedId === leaf.id} />
          </div>
        )
      })}

      {plan && (
        <div
          className={`${styles.dropPreview} ${plan.action !== 'split' ? styles.dropPreviewWhole : ''}`}
          style={tileStyle(monocleId ? FULL : plan.rect, true)}
          data-drop-preview={plan.action}
          aria-hidden="true"
        >
          <span className={styles.dropLabel}>{plan.label}</span>
        </div>
      )}

      {tiled &&
        geometry.splits.map((split) => (
          <div
            key={split.id}
            role="separator"
            aria-orientation={split.dir === 'row' ? 'vertical' : 'horizontal'}
            aria-label="Resize tiles"
            aria-valuenow={Math.round(split.ratio * 100)}
            title="Drag to resize · double-click to equalise"
            className={`${styles.divider} ${split.dir === 'row' ? styles.dividerV : styles.dividerH} ${
              resizing === split.id ? styles.dividerActive : ''
            }`}
            style={dividerStyle(split)}
            onPointerDown={startResize(split)}
            onDoubleClick={() => setRatio(split.id, 0.5)}
          />
        ))}

      {tiled &&
        slideGeo &&
        columns.length > 1 &&
        slideGeo.columns.slice(0, -1).map((col) => (
          <div
            key={col.id}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize column"
            title="Drag to resize column · double-click to reset width"
            data-column-handle={col.id}
            className={`${styles.divider} ${styles.dividerV} ${resizing === col.id ? styles.dividerActive : ''}`}
            style={{ left: `calc(${(col.x + col.w) * 100}% - 4px)`, top: 0, width: '8px', height: '100%' }}
            onPointerDown={startColumnResize(col)}
            onDoubleClick={() => setColumnWidth(col.id, 0.5)}
          />
        ))}
      </div>
      </div>

      {strip && (
        <>
          <div
            className={`${styles.edge} ${styles.edgeLeft} ${stripScroll > 0.001 ? styles.edgeOn : ''}`}
            aria-hidden="true"
            data-edge="left"
          />
          <div
            className={`${styles.edge} ${styles.edgeRight} ${stripScroll < total - 1 - 0.001 ? styles.edgeOn : ''}`}
            aria-hidden="true"
            data-edge="right"
          />
        </>
      )}
      {showMap && <ColumnMap columns={columns} focusedId={focusedId} scrollX={stripScroll} total={total} />}
    </div>
  )
}
