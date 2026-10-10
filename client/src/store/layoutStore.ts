import { create } from 'zustand'
import {
  boardLeafFor,
  computeGeometry,
  dwindleDir,
  equalize,
  findLeaf,
  isLayoutNode,
  leaf,
  leaves,
  neighbor,
  noteLeafFor,
  remapNote,
  removeLeaf,
  rotateParent,
  sanitize,
  setRatio,
  splitLeaf,
  swapContents,
  tileNoteId,
  updateLeaf,
  type Direction,
  type LayoutNode,
  type SplitDir,
  type TileContent,
  type TileMode,
} from '../lib/tiling'
import * as slide from '../lib/sliding'

const STORAGE_KEY = 'velocity.layout.v3'
const LEGACY_KEY = 'velocity.layout.v2'

export type TilingMode = 'dwindle' | 'sliding'

export type SplitRequest = SplitDir | 'auto'

interface LayoutState {
  root: LayoutNode
  focusedId: string
  /** Monocle: the focused tile fills the workspace. */
  zoomedId: string | null
  /** Workspace width / height in px, kept current by the Workspace's ResizeObserver. */
  aspect: number
  /** Tiling strategy: binary split tree, or scrollable columns. */
  mode: TilingMode
  /** Sliding mode: columns of tile ids. Empty (and ignored) in dwindle mode. */
  columns: slide.Column[]
  /** Sliding mode: left edge of the viewport, in viewport widths. */
  scrollX: number

  focus: (id: string) => void
  focusDirection: (dir: Direction) => string | null
  swapDirection: (dir: Direction) => void
  split: (
    request: SplitRequest,
    content: TileContent,
    opts?: { targetId?: string; placement?: 'after' | 'before'; focus?: boolean },
  ) => string
  close: (id: string) => void
  setContent: (id: string, content: TileContent) => void
  setMode: (id: string, mode: TileMode) => void
  setRatio: (splitId: string, ratio: number) => void
  equalize: () => void
  rotate: (id?: string) => void
  toggleZoom: () => void
  setAspect: (aspect: number) => void
  revealNote: (noteId: number) => void
  toggleBoard: (noteId: number) => void
  dropNote: (noteId: number) => void
  remapNote: (from: number, to: number) => void
  restore: (isValidNote: (id: number) => boolean) => void

  setTilingMode: (mode: TilingMode) => void
  toggleTilingMode: () => void
  cycleColumnWidth: (step?: 1 | -1) => void
  setColumnWidth: (columnId: string, width: number, reveal?: boolean) => void
  scrollTo: (scrollX: number) => void
}

type Snap = Pick<LayoutState, 'root' | 'focusedId' | 'columns' | 'aspect'>
type Patch = Partial<Pick<LayoutState, 'root' | 'focusedId' | 'columns'>>
type SplitOpts = { targetId?: string; placement?: 'after' | 'before' }

/** Per-mode behaviour. Everything mode-specific in the store goes through here. */
interface Strategy {
  neighbor: (s: Snap, id: string, dir: Direction) => string | null
  swap: (s: Snap, dir: Direction) => Patch | null
  split: (s: Snap, request: SplitRequest, content: TileContent, opts: SplitOpts) => { patch: Patch; id: string }
  /** Remove a tile when others remain. Focus is handled by the caller. */
  remove: (s: Snap, id: string) => Patch
}

const dwindleStrategy: Strategy = {
  neighbor: (s, id, dir) => neighbor(computeGeometry(s.root).tiles, id, dir),
  swap: (s, dir) => {
    const target = neighbor(computeGeometry(s.root).tiles, s.focusedId, dir)
    if (!target) return null
    // Swap contents; focus follows the content the user is "carrying".
    return { root: swapContents(s.root, s.focusedId, target), focusedId: target }
  },
  split: (s, request, content, opts) => {
    const targetId = opts.targetId ?? s.focusedId
    const rect = computeGeometry(s.root).tiles[targetId] ?? { x: 0, y: 0, w: 1, h: 1 }
    const dir = request === 'auto' ? dwindleDir(rect, s.aspect) : request
    const inserted = leaf(content)
    return { patch: { root: splitLeaf(s.root, targetId, dir, inserted, opts.placement ?? 'after') }, id: inserted.id }
  },
  remove: (s, id) => ({ root: removeLeaf(s.root, id) ?? initialRoot() }),
}

const slidingStrategy: Strategy = {
  neighbor: (s, id, dir) => slide.neighborTile(s.columns, id, dir),
  swap: (s, dir) => {
    const columns = slide.swapTile(s.columns, s.focusedId, dir)
    return columns ? { columns } : null
  },
  split: (s, request, content, opts) => {
    const targetId = opts.targetId ?? s.focusedId
    const placement = opts.placement ?? 'after'
    const inserted = leaf(content)
    // The tree is only a bag of tiles in this mode; keep it valid.
    const root = splitLeaf(s.root, targetId, 'row', inserted, placement)
    const columns =
      request === 'column'
        ? slide.stackTile(s.columns, targetId, inserted.id, placement)
        : slide.insertColumn(s.columns, targetId, inserted.id, placement)
    return { patch: { root, columns }, id: inserted.id }
  },
  remove: (s, id) => ({
    root: removeLeaf(s.root, id) ?? initialRoot(),
    columns: slide.removeTile(s.columns, id),
  }),
}

const STRATEGIES: Record<TilingMode, Strategy> = { dwindle: dwindleStrategy, sliding: slidingStrategy }

function initialRoot(): LayoutNode {
  return leaf({ kind: 'empty' })
}

interface Persisted {
  mode: TilingMode
  root: LayoutNode
  focusedId: string
  columns: slide.Column[] | null
}

interface Persisted {
  mode: TilingMode
  root: LayoutNode
  focusedId: string
  columns: slide.Column[] | null
}

function loadPersisted(): Persisted | null {
  try {
    // v3 holds the tiling mode + columns; v2 (dwindle only) migrates forward.
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { mode?: unknown; root?: unknown; focusedId?: unknown; columns?: unknown }
    if (!isLayoutNode(parsed.root)) return null
    return {
      mode: parsed.mode === 'sliding' ? 'sliding' : 'dwindle',
      root: parsed.root,
      focusedId: typeof parsed.focusedId === 'string' ? parsed.focusedId : '',
      columns: slide.isColumns(parsed.columns)
        ? parsed.columns.map((c) => ({ ...c, width: slide.clampWidth(c.width), restore: undefined }))
        : null,
    }
  } catch {
    return null
  }
}

function pickFocus(root: LayoutNode, preferred: string | null | undefined): string {
  if (preferred && findLeaf(root, preferred)) return preferred
  return leaves(root)[0]!.id
}

/** Remove duplicate tiles for the same note/board — the editor assumes one view per note. */
function dedupe(root: LayoutNode): LayoutNode {
  const seen = new Set<string>()
  let next: LayoutNode | null = root
  for (const l of leaves(root)) {
    const noteId = tileNoteId(l.content)
    if (noteId == null) continue
    const key = `${l.content.kind}:${noteId}`
    if (seen.has(key) && next) next = removeLeaf(next, l.id)
    seen.add(key)
  }
  return next ?? initialRoot()
}

const first = initialRoot()

export const useLayoutStore = create<LayoutState>((set, get) => {
  const strat = () => STRATEGIES[get().mode]
  const snap = (): Snap => {
    const { root, focusedId, columns, aspect } = get()
    return { root, focusedId, columns, aspect }
  }

  /** Apply a patch; in sliding mode, scroll just enough to keep the focused column in view. */
  const commit = (patch: Partial<LayoutState>, reveal = true) => {
    set((s) => {
      const next = { ...s, ...patch }
      if (next.mode !== 'sliding') return patch
      const scrollX =
        patch.scrollX ??
        (reveal
          ? slide.revealOffset(next.columns, next.focusedId, next.scrollX)
          : slide.clampScroll(next.columns, next.scrollX))
      return scrollX === s.scrollX ? patch : { ...patch, scrollX }
    })
  }

  /** Columns must mirror the tile set after any tree edit made in sliding mode. */
  const reconciled = (root: LayoutNode, columns: slide.Column[]) =>
    slide.reconcile(
      columns,
      leaves(root).map((l) => l.id),
    )

  return {
    root: first,
    focusedId: first.id,
    zoomedId: null,
    aspect: 16 / 10,
    mode: 'dwindle',
    columns: [],
    scrollX: 0,

    focus: (id) => {
      if (get().focusedId === id || !findLeaf(get().root, id)) return
      commit({ focusedId: id, zoomedId: get().zoomedId ? id : null })
    },

    focusDirection: (dir) => {
      const target = strat().neighbor(snap(), get().focusedId, dir)
      if (target) commit({ focusedId: target, zoomedId: null })
      return target
    },

    swapDirection: (dir) => {
      const patch = strat().swap(snap(), dir)
      if (patch) commit({ ...patch, zoomedId: null })
    },

    split: (request, content, opts = {}) => {
      const { patch, id } = strat().split(snap(), request, content, opts)
      commit({
        ...patch,
        focusedId: opts.focus === false ? get().focusedId : id,
        zoomedId: null,
      })
      return id
    },

    close: (id) => {
      const { root, focusedId } = get()
      const all = leaves(root)
      if (all.length <= 1) {
        const only = leaf({ kind: 'empty' }, all[0]?.id)
        commit({ root: only, zoomedId: null })
        return
      }
      // Focus moves to the neighbour (prefer the sibling side).
      const s = snap()
      let nextFocus = focusedId
      if (focusedId === id) {
        const st = strat()
        nextFocus =
          st.neighbor(s, id, 'left') ??
          st.neighbor(s, id, 'up') ??
          st.neighbor(s, id, 'right') ??
          st.neighbor(s, id, 'down') ??
          all.find((l) => l.id !== id)!.id
      }
      const patch = strat().remove(s, id)
      const nextRoot = patch.root ?? root
      commit({ ...patch, focusedId: pickFocus(nextRoot, nextFocus), zoomedId: null })
    },

    setContent: (id, content) => {
      set((s) => ({ root: updateLeaf(s.root, id, () => content) }))
    },

    setMode: (id, mode) => {
      set((s) => ({
        root: updateLeaf(s.root, id, (c) => (c.kind === 'note' && c.mode !== mode ? { ...c, mode } : c)),
      }))
    },

    setRatio: (splitId, ratio) => {
      set((s) => ({ root: setRatio(s.root, splitId, ratio) }))
    },

    equalize: () => {
      if (get().mode === 'sliding') commit({ columns: slide.resetWidths(get().columns) })
      else set((s) => ({ root: equalize(s.root) }))
    },

    rotate: (id) => {
      if (get().mode === 'sliding') return
      set((s) => ({ root: rotateParent(s.root, id ?? s.focusedId) }))
    },

    toggleZoom: () => {
      const { zoomedId, focusedId, root, mode, columns } = get()
      if (leaves(root).length <= 1) return
      if (mode === 'sliding') {
        // Zoom = full-width column, toggled.
        const col = slide.columnOf(columns, focusedId)
        if (col) commit({ columns: slide.toggleFull(columns, col.id) })
        return
      }
      set({ zoomedId: zoomedId ? null : focusedId })
    },

    setAspect: (aspect) => {
      if (Number.isFinite(aspect) && aspect > 0 && Math.abs(aspect - get().aspect) > 0.01) {
        set({ aspect })
      }
    },

    revealNote: (noteId) => {
      const { root, focusedId } = get()
      const existing = noteLeafFor(root, noteId)
      if (existing) {
        if (existing.id !== focusedId) {
          commit({ focusedId: existing.id, zoomedId: get().zoomedId ? existing.id : null })
        }
        return
      }
      const focused = findLeaf(root, focusedId)
      const mode: TileMode = focused?.content.kind === 'note' ? focused.content.mode : 'edit'
      let target = focused && focused.content.kind !== 'board' ? focused : null
      if (!target) {
        // Focused tile is a whiteboard — reuse an empty tile, else any note tile.
        target =
          leaves(root).find((l) => l.content.kind === 'empty') ??
          leaves(root).find((l) => l.content.kind === 'note') ??
          null
      }
      if (!target) {
        get().split('auto', { kind: 'note', noteId, mode: 'edit' }, { placement: 'before' })
        return
      }
      commit({
        root: updateLeaf(root, target.id, () => ({ kind: 'note', noteId, mode })),
        focusedId: target.id,
      })
    },

    toggleBoard: (noteId) => {
      const { root } = get()
      const existing = boardLeafFor(root, noteId)
      if (existing) {
        if (leaves(root).length === 1) {
          set({ root: updateLeaf(root, existing.id, () => ({ kind: 'note', noteId, mode: 'edit' })) })
        } else {
          get().close(existing.id)
        }
        return
      }
      const noteLeaf = noteLeafFor(root, noteId)
      get().split('row', { kind: 'board', noteId }, { targetId: noteLeaf?.id })
    },

    dropNote: (noteId) => {
      const before = snap()
      let { root } = before
      let columns = before.columns
      const affected = leaves(root).filter((l) => tileNoteId(l.content) === noteId)
      if (affected.length === 0) return
      const st = strat()
      for (const l of affected) {
        if (leaves(root).length > 1) {
          const patch = st.remove({ ...before, root, columns }, l.id)
          root = patch.root ?? root
          columns = patch.columns ?? columns
        } else {
          root = updateLeaf(root, l.id, () => ({ kind: 'empty' }))
        }
      }
      let nextFocus = before.focusedId
      if (!findLeaf(root, before.focusedId)) {
        const candidates = (['left', 'up', 'right', 'down'] as const)
          .map((d) => st.neighbor(before, before.focusedId, d))
          .filter((id): id is string => id != null && findLeaf(root, id) != null)
        nextFocus = candidates[0] ?? leaves(root)[0]!.id
      }
      commit({ root, columns, focusedId: pickFocus(root, nextFocus), zoomedId: null })
    },

    remapNote: (from, to) => {
      set((s) => ({ root: remapNote(s.root, from, to) }))
    },

    restore: (isValidNote) => {
      const persisted = loadPersisted()
      if (!persisted) return
      const root = dedupe(sanitize(persisted.root, isValidNote))
      const focusedId = pickFocus(root, persisted.focusedId)
      if (persisted.mode === 'sliding') {
        const columns = persisted.columns
          ? reconciled(root, persisted.columns)
          : slide.fromTiles(computeGeometry(root).tiles)
        set({ mode: 'sliding', root, columns, focusedId, zoomedId: null, scrollX: 0 })
        commit({ focusedId })
      } else {
        set({ mode: 'dwindle', root, columns: [], focusedId, zoomedId: null, scrollX: 0 })
      }
    },

    setTilingMode: (mode) => {
      const s = get()
      if (s.mode === mode) return
      if (mode === 'sliding') {
        const columns = slide.fromTiles(computeGeometry(s.root).tiles)
        set({ mode, columns, zoomedId: null, scrollX: 0 })
        commit({ focusedId: s.focusedId })
      } else {
        const byId = new Map(leaves(s.root).map((l) => [l.id, l]))
        const order = reconciled(s.root, s.columns)
        const root = slide.toTree(order, (id) => byId.get(id)!, s.aspect)
        set({ mode, root, columns: [], zoomedId: null, scrollX: 0 })
      }
    },

    toggleTilingMode: () => get().setTilingMode(get().mode === 'dwindle' ? 'sliding' : 'dwindle'),

    cycleColumnWidth: (step = 1) => {
      const { mode, columns, focusedId } = get()
      if (mode !== 'sliding') return
      const col = slide.columnOf(columns, focusedId)
      if (col) commit({ columns: slide.cycleWidth(columns, col.id, step) })
    },

    setColumnWidth: (columnId, width, reveal = false) => {
      if (get().mode !== 'sliding') return
      commit({ columns: slide.setWidth(get().columns, columnId, width) }, reveal)
    },

    scrollTo: (scrollX) => {
      const { mode, columns } = get()
      if (mode !== 'sliding') return
      const next = slide.clampScroll(columns, scrollX)
      if (next !== get().scrollX) set({ scrollX: next })
    },
  }
})

/** Note shown (or boarded) in the focused tile. */
export function focusedNoteId(state: Pick<LayoutState, 'root' | 'focusedId'>): number | null {
  const l = findLeaf(state.root, state.focusedId)
  return l ? tileNoteId(l.content) : null
}

/** Note ids currently visible in any tile — used to keep their content loaded. */
export function visibleNoteIds(root: LayoutNode): number[] {
  const ids = new Set<number>()
  for (const l of leaves(root)) {
    const id = tileNoteId(l.content)
    if (id != null) ids.add(id)
  }
  return [...ids]
}

// Persist layout (per browser — a viewer convenience, not durable data).
let persistTimer: ReturnType<typeof setTimeout> | null = null
let restored = false
export function markLayoutRestored(): void {
  restored = true
}

useLayoutStore.subscribe((state, prev) => {
  if (!restored) return
  if (
    state.root === prev.root &&
    state.focusedId === prev.focusedId &&
    state.mode === prev.mode &&
    state.columns === prev.columns
  ) {
    return
  }
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const { root, focusedId, mode, columns } = useLayoutStore.getState()
      // Temp (negative) ids never survive a reload — store the tree without them.
      const durable = sanitize(root, (id) => id > 0)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 3, mode, root: durable, focusedId, columns: mode === 'sliding' ? columns : [] }))
    } catch {
      // Storage unavailable — layout simply won't be restored.
    }
  }, 300)
})
