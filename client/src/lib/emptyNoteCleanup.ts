/**
 * Automatic cleanup of empty, unnamed, inactive notes.
 *
 * Product rule: inactive empty notes without names get deleted. LRU strategy: keep
 * only the last KEEP_EMPTY_NOTES (5) used empty inactive notes; every other empty
 * note is removed, including ones never opened in this browser.
 *
 * Definitions (the single source of truth for temp and server notes):
 *
 *  EMPTY    content is empty or whitespace-only (zero bytes after trim), AND
 *           the note has no explicit title (blank or "Untitled"), AND
 *           the note has no whiteboard (`hasBoard(id)` or `paste.has_whiteboard`).
 *           When the body isn't loaded yet, the server's `is_empty` list flag is used.
 *           A note whose emptiness is unknown is never deleted.
 *
 *  ACTIVE   open in a tab, visible in a tile, the active note, being edited (dirty or
 *           a pending/saving/failed sync status), having its title edited, or created
 *           / last used less than GRACE_MS (30 s) ago.
 *
 *  LRU      last-used time = max(note `updated_at`, client-recorded last-used stamp).
 *           Stamps are recorded when a note is activated, deactivated (closed) or
 *           shown in a tile, and persisted in localStorage (`velocity.lastUsed.v1`),
 *           pruned to existing ids.
 *
 *  POLICY   among notes that are EMPTY and not ACTIVE, keep the KEEP_EMPTY_NOTES most
 *           recently used and delete the rest. Notes with any non-whitespace content,
 *           an explicit title or a whiteboard are never touched.
 *
 * Runs after the initial load, when a note stops being active (tab closed, tile
 * changed) and every 2 minutes, always in an idle callback so typing is never blocked.
 * Deletion is silent (no toasts). The server independently refuses to delete a note
 * that gained content (`DELETE ?only_if_empty=1`).
 */
import { syncEngine, useEditorStore } from '../store/editorStore'
import { useLayoutStore, visibleNoteIds } from '../store/layoutStore'
import { hasBoard } from '../store/whiteboardStore'
import type { Paste } from '../types'
import { hasExplicitTitle, parseTimestamp } from './noteMeta'

export const KEEP_EMPTY_NOTES = 5
export const GRACE_MS = 30_000
export const CLEANUP_INTERVAL_MS = 120_000
export const LAST_USED_KEY = 'velocity.lastUsed.v1'

export type LastUsedMap = Record<number, number>

/** True when the body is blank. Unknown (not loaded, no server flag) counts as NOT empty. */
export function isBlankBody(paste: Pick<Paste, 'content' | 'is_empty'>): boolean {
  if (paste.content !== undefined) return paste.content.trim().length === 0
  return paste.is_empty === true
}

/** Empty + unnamed + no whiteboard: eligible for cleanup once inactive. */
export function isEmptyUnnamed(
  paste: Paste,
  boardCheck: (id: number) => boolean = hasBoard,
): boolean {
  if (hasExplicitTitle(paste.title)) return false
  if (!isBlankBody(paste)) return false
  if (paste.has_whiteboard || boardCheck(paste.id)) return false
  return true
}

export interface CleanupInput {
  pastes: readonly Paste[]
  /** Ids open in a tab or visible in any tile (plus the active note). */
  activeIds: ReadonlySet<number>
  lastUsed: Readonly<LastUsedMap>
  now: number
  /** Ids with unsaved or in-flight changes. */
  pendingIds?: ReadonlySet<number>
  hasBoard?: (id: number) => boolean
  keep?: number
  graceMs?: number
}

/** Pure policy: which note ids should be deleted right now. */
export function planEmptyNoteCleanup(input: CleanupInput): number[] {
  const keep = input.keep ?? KEEP_EMPTY_NOTES
  const grace = input.graceMs ?? GRACE_MS
  const boardCheck = input.hasBoard ?? hasBoard

  const candidates: Array<{ id: number; usedAt: number }> = []
  for (const paste of input.pastes) {
    if (!isEmptyUnnamed(paste, boardCheck)) continue
    if (input.activeIds.has(paste.id) || paste.dirty || input.pendingIds?.has(paste.id)) continue
    const usedAt = Math.max(
      parseTimestamp(paste.updated_at),
      input.lastUsed[paste.id] ?? 0,
    )
    const born = parseTimestamp(paste.created_at)
    if (input.now - Math.max(usedAt, born) < grace) continue
    candidates.push({ id: paste.id, usedAt })
  }
  // Most recently used first; newer ids win ties (higher id = created later, temp ids are negative).
  candidates.sort((a, b) => b.usedAt - a.usedAt || b.id - a.id)
  return candidates.slice(keep).map((c) => c.id)
}

// ---------------------------------------------------------------------------
// Last-used bookkeeping
// ---------------------------------------------------------------------------

function readLastUsed(): LastUsedMap {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: LastUsedMap = {}
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k)
      if (Number.isInteger(id) && id > 0 && typeof v === 'number') out[id] = v
    }
    return out
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function activeNoteIds(): Set<number> {
  const { openTabIds, activeId, editingTitleId } = useEditorStore.getState()
  const ids = new Set<number>(openTabIds)
  for (const id of visibleNoteIds(useLayoutStore.getState().root)) ids.add(id)
  if (activeId != null) ids.add(activeId)
  if (editingTitleId != null) ids.add(editingTitleId)
  return ids
}

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }

function whenIdle(task: () => void): void {
  const w = window as IdleWindow
  if (w.requestIdleCallback) w.requestIdleCallback(task, { timeout: 5_000 })
  else setTimeout(task, 50)
}

/** Start the cleanup loop. Call once after the first load; returns a stop function. */
export function startEmptyNoteCleanup(): () => void {
  const lastUsed = readLastUsed()
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let runTimer: ReturnType<typeof setTimeout> | null = null
  let prevActive = new Set<number>()

  const saveLater = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        localStorage.setItem(LAST_USED_KEY, JSON.stringify(Object.fromEntries(Object.entries(lastUsed).filter(([k]) => Number(k) > 0))))
      } catch {
        // Storage unavailable — LRU falls back to updated_at.
      }
    }, 1_000)
  }

  const touch = (id: number) => {
    lastUsed[id] = Date.now()
    saveLater()
  }

  const run = () => {
    const { pastes, syncStatus } = useEditorStore.getState()
    // Prune stamps for notes that no longer exist.
    const existing = new Set(pastes.map((p) => p.id))
    let pruned = false
    for (const key of Object.keys(lastUsed)) {
      if (!existing.has(Number(key))) {
        delete lastUsed[Number(key)]
        pruned = true
      }
    }
    if (pruned) saveLater()

    const pendingIds = new Set<number>(syncEngine.pendingIds())
    for (const key of Object.keys(syncStatus)) pendingIds.add(Number(key))
    const doomed = planEmptyNoteCleanup({
      pastes,
      activeIds: activeNoteIds(),
      lastUsed,
      now: Date.now(),
      pendingIds,
    })
    if (doomed.length) useEditorStore.getState().discardNotes(doomed)
  }

  const schedule = (delay = 1_500) => {
    if (runTimer) return
    runTimer = setTimeout(() => {
      runTimer = null
      whenIdle(run)
    }, delay)
  }

  const refreshActive = () => {
    const next = activeNoteIds()
    let lost = false
    for (const id of prevActive) {
      if (!next.has(id)) {
        touch(id) // it was in use until now
        lost = true
      }
    }
    for (const id of next) if (!prevActive.has(id)) touch(id)
    prevActive = next
    if (lost) schedule()
  }

  refreshActive()
  schedule(500)

  const unsubEditor = useEditorStore.subscribe((state, prev) => {
    if (
      state.openTabIds !== prev.openTabIds ||
      state.activeId !== prev.activeId ||
      state.editingTitleId !== prev.editingTitleId
    ) {
      refreshActive()
    }
  })
  const unsubLayout = useLayoutStore.subscribe((state, prev) => {
    if (state.root !== prev.root) refreshActive()
  })
  const interval = setInterval(() => schedule(0), CLEANUP_INTERVAL_MS)

  return () => {
    unsubEditor()
    unsubLayout()
    clearInterval(interval)
    if (runTimer) clearTimeout(runTimer)
    if (saveTimer) clearTimeout(saveTimer)
  }
}
