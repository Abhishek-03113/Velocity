import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { COMPACT_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { NOTE_DRAG_TYPE } from '../../lib/groupColors'
import { geometry as slidingGeometry } from '../../lib/sliding'
import { computeGeometry, leaves, type Rect, type SplitGeometry } from '../../lib/tiling'
import { useLayoutStore } from '../../store/layoutStore'
import { useEditorStore } from '../../store/editorStore'
import { placeNoteInTile } from '../../lib/workspace'
import { ColumnMap } from './ColumnMap'
import { Tile, type DropZone } from './Tile'
import styles from './Workspace.module.css'

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }

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

function zoneFor(e: DragEvent, el: HTMLElement): DropZone {
  const r = el.getBoundingClientRect()
  const fx = (e.clientX - r.left) / r.width
  const fy = (e.clientY - r.top) / r.height
  const edge = 0.24
  const distances: Array<[DropZone, number]> = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ]
  const [zone, d] = distances.sort((a, b) => a[1] - b[1])[0]!
  return d < edge ? zone : 'center'
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
  const [drop, setDrop] = useState<{ tileId: string; zone: DropZone } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      if (height > 0) setAspect(width / height)
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

  const startResize = useCallback(
    (split: SplitGeometry) => (e: PointerEvent<HTMLDivElement>) => {
      const el = stageRef.current
      if (!el) return
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      setResizing(split.id)
      const bounds = el.getBoundingClientRect()
      const onMove = (ev: globalThis.PointerEvent) => {
        if (split.dir === 'row') {
          const x = (ev.clientX - bounds.left) / bounds.width
          setRatio(split.id, (x - split.rect.x) / split.rect.w)
        } else {
          const y = (ev.clientY - bounds.top) / bounds.height
          setRatio(split.id, (y - split.rect.y) / split.rect.h)
        }
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

  // Horizontal wheel / trackpad scroll pans the strip (vertical scroll stays with the notes).
  useEffect(() => {
    const el = containerRef.current
    if (!el || !strip) return
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey
      if (!horizontal) return
      e.preventDefault()
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      const width = el.clientWidth || 1
      scrollTo(useLayoutStore.getState().scrollX + delta / width)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [strip, scrollTo])

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
      scrollTo(startScroll - (ev.clientX - startX) / (el.clientWidth || 1))
    const onUp = () => {
      setResizing(null)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  const onDragOver = (tileId: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const zone = zoneFor(e, e.currentTarget)
    setDrop((d) => (d?.tileId === tileId && d.zone === zone ? d : { tileId, zone }))
  }

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDrop(null)
  }

  const onDrop = (tileId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const zone = zoneFor(e, e.currentTarget)
    setDrop(null)
    const noteId = Number(e.dataTransfer.getData(NOTE_DRAG_TYPE))
    if (!Number.isFinite(noteId) || noteId === 0) return
    const layout = useLayoutStore.getState()
    const visible = leaves(layout.root).find((l) => l.content.kind === 'note' && l.content.noteId === noteId)
    if (zone === 'center') {
      placeNoteInTile(tileId, noteId)
      return
    }
    // Dragging a visible note to another tile's edge moves it there.
    if (visible && visible.id !== tileId && leaves(layout.root).length > 1) layout.close(visible.id)
    else if (visible?.id === tileId) return
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'column'
    useLayoutStore.getState().split(
      dir,
      { kind: 'note', noteId, mode: 'edit' },
      { targetId: tileId, placement: zone === 'left' || zone === 'top' ? 'before' : 'after' },
    )
    useEditorStore.getState().activateNote(noteId)
  }

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
        className={`${styles.strip} ${strip ? styles.stripSliding : ''}`}
        style={strip ? { transform: `translateX(${-stripScroll * 100}%)` } : undefined}
        onPointerDown={onStripPointerDown}
        data-strip
      >
      {ordered.map((leaf) => {
        const rect = monocleId ? FULL : (geometry.tiles[leaf.id] ?? FULL)
        const hidden = monocleId != null && leaf.id !== monocleId
        return (
          <div
            key={leaf.id}
            className={`${styles.slot} ${hidden ? styles.hidden : ''}`}
            style={tileStyle(rect, tiled)}
            onDragOver={onDragOver(leaf.id)}
            onDragEnter={onDragOver(leaf.id)}
            onDragLeave={onDragLeave}
            onDrop={onDrop(leaf.id)}
          >
            <Tile
              leaf={leaf}
              focused={leaf.id === focusedId}
              tiled={tiled}
              zoomed={zoomedId === leaf.id}
              dropZone={drop?.tileId === leaf.id ? drop.zone : null}
            />
          </div>
        )
      })}

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
