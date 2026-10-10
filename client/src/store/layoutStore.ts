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

const STORAGE_KEY = 'velocity.layout.v2'

export type SplitRequest = SplitDir | 'auto'

interface LayoutState {
  root: LayoutNode
  focusedId: string
  /** Monocle: the focused tile fills the workspace. */
  zoomedId: string | null
  /** Workspace width / height in px, kept current by the Workspace's ResizeObserver. */
  aspect: number

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
}

function initialRoot(): LayoutNode {
  return leaf({ kind: 'empty' })
}

function loadPersisted(): { root: LayoutNode; focusedId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { root?: unknown; focusedId?: unknown }
    if (!isLayoutNode(parsed.root)) return null
    return {
      root: parsed.root,
      focusedId: typeof parsed.focusedId === 'string' ? parsed.focusedId : '',
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

export const useLayoutStore = create<LayoutState>((set, get) => ({
  root: first,
  focusedId: first.id,
  zoomedId: null,
  aspect: 16 / 10,

  focus: (id) => {
    if (get().focusedId === id || !findLeaf(get().root, id)) return
    set((s) => ({ focusedId: id, zoomedId: s.zoomedId ? id : null }))
  },

  focusDirection: (dir) => {
    const { root, focusedId } = get()
    const { tiles } = computeGeometry(root)
    const target = neighbor(tiles, focusedId, dir)
    if (target) set({ focusedId: target, zoomedId: null })
    return target
  },

  swapDirection: (dir) => {
    const { root, focusedId } = get()
    const { tiles } = computeGeometry(root)
    const target = neighbor(tiles, focusedId, dir)
    if (!target) return
    // Swap contents; focus follows the content the user is "carrying".
    set({ root: swapContents(root, focusedId, target), focusedId: target, zoomedId: null })
  },

  split: (request, content, opts = {}) => {
    const { root, focusedId, aspect } = get()
    const targetId = opts.targetId ?? focusedId
    const { tiles } = computeGeometry(root)
    const rect = tiles[targetId] ?? { x: 0, y: 0, w: 1, h: 1 }
    const dir = request === 'auto' ? dwindleDir(rect, aspect) : request
    const inserted = leaf(content)
    const next = splitLeaf(root, targetId, dir, inserted, opts.placement ?? 'after')
    set({
      root: next,
      focusedId: opts.focus === false ? focusedId : inserted.id,
      zoomedId: null,
    })
    return inserted.id
  },

  close: (id) => {
    const { root, focusedId } = get()
    const all = leaves(root)
    if (all.length <= 1) {
      set({ root: leaf({ kind: 'empty' }, all[0]?.id), zoomedId: null })
      return
    }
    // Focus moves to the geometric neighbour (prefer the sibling side).
    const { tiles } = computeGeometry(root)
    let nextFocus = focusedId
    if (focusedId === id) {
      nextFocus =
        neighbor(tiles, id, 'left') ??
        neighbor(tiles, id, 'up') ??
        neighbor(tiles, id, 'right') ??
        neighbor(tiles, id, 'down') ??
        all.find((l) => l.id !== id)!.id
    }
    const next = removeLeaf(root, id) ?? initialRoot()
    set({ root: next, focusedId: pickFocus(next, nextFocus), zoomedId: null })
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

  equalize: () => set((s) => ({ root: equalize(s.root) })),

  rotate: (id) => set((s) => ({ root: rotateParent(s.root, id ?? s.focusedId) })),

  toggleZoom: () => {
    const { zoomedId, focusedId, root } = get()
    if (leaves(root).length <= 1) return
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
      if (existing.id !== focusedId) set((s) => ({ focusedId: existing.id, zoomedId: s.zoomedId ? existing.id : null }))
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
    set({
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
    let { root } = get()
    const affected = leaves(root).filter((l) => tileNoteId(l.content) === noteId)
    if (affected.length === 0) return
    for (const l of affected) {
      if (leaves(root).length > 1) {
        const pruned = removeLeaf(root, l.id)
        if (pruned) root = pruned
      } else {
        root = updateLeaf(root, l.id, () => ({ kind: 'empty' }))
      }
    }
    const focusedId = get().focusedId
    let nextFocus = focusedId
    if (!findLeaf(root, focusedId)) {
      const { tiles } = computeGeometry(get().root)
      const candidates = (['left', 'up', 'right', 'down'] as const)
        .map((d) => neighbor(tiles, focusedId, d))
        .filter((id): id is string => id != null && findLeaf(root, id) != null)
      nextFocus = candidates[0] ?? leaves(root)[0]!.id
    }
    set({ root, focusedId: pickFocus(root, nextFocus), zoomedId: null })
  },

  remapNote: (from, to) => {
    set((s) => ({ root: remapNote(s.root, from, to) }))
  },

  restore: (isValidNote) => {
    const persisted = loadPersisted()
    if (!persisted) return
    const root = dedupe(sanitize(persisted.root, isValidNote))
    set({ root, focusedId: pickFocus(root, persisted.focusedId), zoomedId: null })
  },
}))

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
  if (state.root === prev.root && state.focusedId === prev.focusedId) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const { root, focusedId } = useLayoutStore.getState()
      // Temp (negative) ids never survive a reload — store the tree without them.
      const durable = sanitize(root, (id) => id > 0)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ root: durable, focusedId }))
    } catch {
      // Storage unavailable — layout simply won't be restored.
    }
  }, 300)
})
