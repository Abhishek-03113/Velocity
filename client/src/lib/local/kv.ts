/**
 * Thin namespaced localStorage wrapper for the browser-only database.
 *
 * - Every key lives under `velocity.db.v1.` so it can't collide with preferences, layout, etc.
 * - Quota errors (every browser flavour) become a typed `StorageFullError`.
 * - Usage is an *incremental* estimate: one pass over our keys the first time it is needed, then
 *   adjusted per set/remove. Never rescanned, so a write costs O(that value), not O(library).
 * - localStorage is synchronous, so writes made from `pagehide` complete before the page goes.
 */
import { reportFull, reportUsage } from '../../store/storageStore'

export const NAMESPACE = 'velocity.db.v1.'

/**
 * Browsers give an origin ~5 MiB of localStorage, measured in UTF-16 chars (≈ 2 bytes each), so
 * ~10 MiB of bytes. There is no API to ask; this is an estimate shown to the user.
 */
export const QUOTA_BYTES = 5 * 1024 * 1024 * 2

export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full')
    this.name = 'StorageFullError'
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: number }
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
    e.code === 22 ||
    e.code === 1014
  )
}

/** UTF-16 byte cost of one entry. */
const cost = (key: string, value: string) => (key.length + value.length) * 2

/** `null` until the first pass; then adjusted incrementally. */
let bytes: number | null = null

function ensureBytes(): number {
  if (bytes !== null) return bytes
  let total = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(NAMESPACE)) total += cost(k, localStorage.getItem(k) ?? '')
    }
  } catch {
    /* storage unavailable — report 0 */
  }
  bytes = total
  return total
}

export function usage(): { bytes: number; quota: number } {
  return { bytes: ensureBytes(), quota: QUOTA_BYTES }
}

export function get(key: string): string | null {
  return localStorage.getItem(NAMESPACE + key)
}

export function set(key: string, value: string): void {
  const full = NAMESPACE + key
  const before = ensureBytes() // establish the baseline before this write changes anything
  const old = localStorage.getItem(full)
  try {
    localStorage.setItem(full, value)
  } catch (err) {
    if (isQuotaError(err)) {
      reportFull(true)
      throw new StorageFullError()
    }
    throw err
  }
  bytes = before - (old === null ? 0 : cost(full, old)) + cost(full, value)
  reportFull(false)
  reportUsage(bytes, QUOTA_BYTES)
}

export function remove(key: string): void {
  const full = NAMESPACE + key
  const before = ensureBytes()
  const old = localStorage.getItem(full)
  if (old === null) return
  localStorage.removeItem(full)
  bytes = before - cost(full, old)
  reportUsage(bytes, QUOTA_BYTES)
}

/** Keys (without the namespace) starting with `prefix`. O(total localStorage keys); startup/rare paths only. */
export function keys(prefix = ''): string[] {
  const out: string[] = []
  const start = NAMESPACE + prefix
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(start)) out.push(k.slice(NAMESPACE.length))
  }
  return out
}

/** Test helper: forget the cached estimate (next `usage()` rescans). */
export function resetUsageCache(): void {
  bytes = null
}
