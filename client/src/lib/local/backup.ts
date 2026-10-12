/**
 * Whole-library backup for the browser-only build: every `velocity.db.v1.*` entry as one JSON file.
 * Built on the kv wrapper so the namespace prefix and byte accounting stay in one place. Backups are
 * produced and restored on demand (a user click), never on a hot path.
 */
import { get, keys, remove, set } from './kv'

export const BACKUP_FORMAT = 'velocity-backup'
export const BACKUP_VERSION = 1

interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exported_at: string
  /** kv keys (namespace stripped) → stored string values, exactly as persisted. */
  entries: Record<string, string>
}

export function exportBackup(): string {
  const entries: Record<string, string> = {}
  for (const key of keys('')) {
    const value = get(key)
    if (value !== null && value !== undefined) entries[key] = value
  }
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    entries,
  }
  return JSON.stringify(file)
}

function parse(json: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('This file is not a Velocity backup.')
  }
  const file = data as Partial<BackupFile> | null
  if (!file || typeof file !== 'object' || file.format !== BACKUP_FORMAT) {
    throw new Error('This file is not a Velocity backup.')
  }
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Velocity.')
  }
  const entries = file.entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error('This backup is damaged.')
  }
  for (const value of Object.values(entries)) {
    if (typeof value !== 'string') throw new Error('This backup is damaged.')
  }
  return file as BackupFile
}

/** Throws a user-readable Error unless `json` is a usable backup; returns the number of notes it holds. */
export function validateBackup(json: string): number {
  const { entries } = parse(json)
  return Object.keys(entries).filter((k) => /^p\.\d+\.m$/.test(k)).length
}

/** Replace the whole library with the backup. Validates fully before touching storage. */
export function importBackup(json: string): void {
  const { entries } = parse(json)
  const previous = new Map<string, string>()
  for (const key of keys('')) {
    const value = get(key)
    if (value !== null && value !== undefined) previous.set(key, value)
  }
  try {
    for (const key of previous.keys()) remove(key)
    for (const [key, value] of Object.entries(entries)) set(key, value)
  } catch (err) {
    // Quota or storage failure midway: put the old library back so nothing is lost.
    try {
      for (const key of keys('')) remove(key)
      for (const [key, value] of previous) set(key, value)
    } catch {
      // Nothing more we can do.
    }
    throw err
  }
}
