/**
 * Browser-storage health for the browser-only runtime (see lib/local/kv.ts).
 *
 * `bytes` / `quota` feed Settings → Storage; `full` feeds the status bar. The kv layer reports
 * usage after every write, which can be once per keystroke-debounce, so usage updates are
 * throttled to at most one store update per second (a single trailing timer, never one per
 * write) — React subscribers don't re-render per save. `full` flips immediately: it is rare and
 * the user needs to see it.
 */
import { create } from 'zustand'

interface StorageState {
  /** Estimated bytes used by Velocity's keys (UTF-16: 2 bytes per char). */
  bytes: number
  /** Estimated localStorage quota in bytes (~5 MiB of chars). */
  quota: number
  /** True after a write failed for lack of space; cleared by the next successful write. */
  full: boolean
}

export const useStorageStore = create<StorageState>(() => ({
  bytes: 0,
  quota: 5 * 1024 * 1024 * 2,
  full: false,
}))

const THROTTLE_MS = 1000

let lastPublish = 0
let timer: ReturnType<typeof setTimeout> | null = null
let pending: { bytes: number; quota: number } | null = null

function publish() {
  timer = null
  if (!pending) return
  const { bytes, quota } = pending
  pending = null
  lastPublish = Date.now()
  const s = useStorageStore.getState()
  if (s.bytes !== bytes || s.quota !== quota) useStorageStore.setState({ bytes, quota })
}

/** Report fresh usage numbers (throttled). Called by kv after writes/removes. */
export function reportUsage(bytes: number, quota: number): void {
  pending = { bytes, quota }
  if (timer) return // the trailing publish will pick up the latest numbers
  const wait = THROTTLE_MS - (Date.now() - lastPublish)
  if (wait <= 0) publish()
  else timer = setTimeout(publish, wait)
}

/** Report a successful (`false`) or quota-failed (`true`) write. Immediate, but only on change. */
export function reportFull(full: boolean): void {
  if (useStorageStore.getState().full !== full) useStorageStore.setState({ full })
}

/** Test helper: drop pending timers and reset state. */
export function resetStorageStore(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
  lastPublish = 0
  useStorageStore.setState({ bytes: 0, quota: 5 * 1024 * 1024 * 2, full: false })
}
