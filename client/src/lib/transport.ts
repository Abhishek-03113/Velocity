/**
 * The single network seam. Every call to the Velocity API goes through `apiFetch`.
 *
 * - Server mode (default): exactly `fetch(base + path, init)`, so behaviour is unchanged.
 * - Browser-only mode (`VITE_APP_ENV=production`): the request is answered in-process by the
 *   localStorage backend (lib/local/backend.ts) and nothing ever leaves the page.
 *
 * The local backend is a dynamic import behind `BROWSER_ONLY` so server builds tree-shake it out.
 */
import { BROWSER_ONLY } from './runtime'

/** Configured API origin from env (no trailing slash). Empty ⇒ same-origin / proxy. */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL
  if (typeof raw !== 'string' || !raw.trim()) return ''
  return raw.trim().replace(/\/$/, '')
}

type LocalBackend = { handle: (method: string, path: string, body?: string) => Promise<Response> }

/** Loaded once; kept as a resolved value too so later calls can start synchronously (see below). */
let backendPromise: Promise<LocalBackend> | null = null
let backendReady: LocalBackend | null = null

function loadBackend(): Promise<LocalBackend> {
  if (!backendPromise) {
    backendPromise = import('./local/backend').then((m) => {
      backendReady = m.localBackend()
      return backendReady
    })
  }
  return backendPromise
}

// Start loading at startup so the backend is resident long before the first pagehide flush.
if (BROWSER_ONLY) void loadBackend()

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!BROWSER_ONLY) return fetch(`${apiBaseUrl()}${path}`, init)

  const method = init.method ?? 'GET'
  const body = typeof init.body === 'string' ? init.body : ''
  // Once loaded, call straight in: the storage write then happens synchronously inside this call,
  // which is what a keepalive flush from `pagehide` needs (no await before the write).
  if (backendReady) return backendReady.handle(method, path, body)
  return loadBackend().then((b) => b.handle(method, path, body))
}
