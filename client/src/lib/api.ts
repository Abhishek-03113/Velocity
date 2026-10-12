import type { ApiResponse, Asset } from '../types'
import { BROWSER_ONLY } from './runtime'
import { apiBaseUrl, apiFetch } from './transport'
import { localMediaUrl } from './local/media'

export { apiBaseUrl }

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await apiFetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  const json = await res.json() as ApiResponse<T>
  if (!res.ok) throw new Error((json.error) ?? `HTTP ${res.status}`)
  return json
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/** Portable path stored in markdown — never bake host/port into paste content. */
export function assetMarkdownUrl(asset: Pick<Asset, 'url' | 'id'>): string {
  if (asset.url.startsWith('/')) return asset.url
  return `/api/assets/${asset.id}`
}

/**
 * Resolve a media href for the browser using `VITE_API_URL`.
 * Relative `/api/...` paths stay same-origin when possible (Vite proxy / client
 * nginx both forward `/api`), so <img> loads don't depend on a second host/port.
 */
export function resolveMediaUrl(href: string): string {
  const trimmed = href.trim()
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('velocity-pending:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed
  }
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  // Browser-only: images live in localStorage; hand <img> a cached blob: URL (unknown ids pass through).
  if (BROWSER_ONLY && path.startsWith('/api/assets/')) return localMediaUrl(path)
  // Browser: prefer same-origin /api so docker client (:37801) and vite proxy work.
  if (typeof window !== 'undefined' && path.startsWith('/api/')) {
    return path
  }
  const base = apiBaseUrl()
  return base ? `${base}${path}` : path
}

/** Upload a data URL and return the stored asset row. */
export async function uploadAssetDataUrl(dataUrl: string): Promise<Asset> {
  const res = await api.post<Asset>('/api/assets', { data_url: dataUrl })
  if (!res.success || !res.data) {
    throw new Error(res.error ?? 'Asset upload failed')
  }
  return res.data
}
