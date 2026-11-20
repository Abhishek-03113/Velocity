/**
 * Commands run recently, per browser (like preferences). The command palette shows
 * them first when you type ">" with nothing else, so the common choices are a
 * handful instead of every command (Hick's law).
 */
const KEY = 'velocity.commands.recent.v1'
const KEEP = 12

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Remember that a command ran (most recent first, no duplicates). */
export function recordCommand(id: string): void {
  const next = [id, ...read().filter((x) => x !== id)].slice(0, KEEP)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable: the palette falls back to suggestions and the full list.
  }
}

/** Most recent first. */
export function recentCommandIds(limit = 5): string[] {
  return read().slice(0, limit)
}

export interface SuggestionContext {
  /** A note is focused in the workspace. */
  noteOpen: boolean
  /** Number of tiles in the workspace. */
  tileCount: number
}

/** Commands that fit the current context, in priority order (the palette keeps the first few it can run). */
export function suggestedCommandIds(ctx: SuggestionContext): string[] {
  const out: string[] = []
  if (ctx.noteOpen) out.push('note.export', 'note.moveToFolder')
  if (ctx.tileCount > 1) out.push('tile.zoom', 'tile.equalize')
  else out.push('tile.splitRight')
  if (ctx.noteOpen) out.push('view.read')
  return out
}
