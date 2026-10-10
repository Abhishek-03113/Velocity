/**
 * One-time migration of whiteboards from localStorage (`velocity.whiteboard.v1.<id>`)
 * to the server. Idempotent and failure-tolerant: a key is removed only once the
 * scene is safely on the server (or the note/board makes it pointless to keep).
 */

export const LEGACY_PREFIX = 'velocity.whiteboard.v1.'
export const LEGACY_INDEX_KEY = 'velocity.whiteboard.index.v1'

export interface LegacyNote {
  id: number
  has_whiteboard?: boolean | number
}

export interface MigrationDeps {
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'key' | 'length'>
  notes: LegacyNote[]
  put: (id: number, scene: { elements: unknown[] }) => Promise<void>
  onUploaded?: (id: number) => void
}

/** Returns the number of boards uploaded. */
export async function migrateLegacyBoards({ storage, notes, put, onUploaded }: MigrationDeps): Promise<number> {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i)
    if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k)
  }
  const byId = new Map(notes.map((n) => [n.id, n]))
  let uploaded = 0

  for (const key of keys) {
    const id = Number(key.slice(LEGACY_PREFIX.length))
    const note = Number.isInteger(id) ? byId.get(id) : undefined
    // Unknown notes (deleted, or a leftover temp id) have nothing to attach to.
    if (!note || id <= 0) {
      storage.removeItem(key)
      continue
    }
    // The server copy wins — it may be newer than this device's.
    if (note.has_whiteboard) {
      storage.removeItem(key)
      continue
    }
    let scene: { elements?: unknown } | null = null
    try {
      scene = JSON.parse(storage.getItem(key) ?? 'null')
    } catch {
      scene = null
    }
    if (!scene || !Array.isArray(scene.elements)) {
      storage.removeItem(key) // corrupt: nothing to salvage
      continue
    }
    try {
      await put(id, scene as { elements: unknown[] })
    } catch (err) {
      // Keep the key; the next startup tries again.
      console.error('[whiteboard] migration failed for note', id, err)
      continue
    }
    storage.removeItem(key)
    onUploaded?.(id)
    uploaded += 1
  }

  // Only remove the old index once nothing is left to retry.
  let remaining = false
  for (let i = 0; i < storage.length; i += 1) if (storage.key(i)?.startsWith(LEGACY_PREFIX)) remaining = true
  if (!remaining) storage.removeItem(LEGACY_INDEX_KEY)
  return uploaded
}
