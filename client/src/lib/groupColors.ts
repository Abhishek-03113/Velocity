/** Folder tints — semantic system colors so they adapt to light/dark. */
const GROUP_COLORS = [
  'var(--system-blue)',
  'var(--system-orange)',
  'var(--system-green)',
  'var(--system-purple)',
  'var(--system-pink)',
  'var(--system-teal)',
  'var(--system-indigo)',
  'var(--system-yellow)',
  'var(--system-red)',
]

export function groupColor(index: number): string {
  return GROUP_COLORS[((index % GROUP_COLORS.length) + GROUP_COLORS.length) % GROUP_COLORS.length]!
}

/** Stable color for a group id given the current ordering of groups. */
export function groupColorFor(groups: Array<{ id: number }>, groupId: number | null | undefined): string | undefined {
  if (groupId == null) return undefined
  const index = groups.findIndex((g) => g.id === groupId)
  return index >= 0 ? groupColor(index) : undefined
}

export const NOTE_DRAG_TYPE = 'application/x-velocity-note'
