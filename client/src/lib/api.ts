import type { ApiResponse } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
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

/** Fire-and-forget durable store for an inline image data URL (B). */
export function persistAssetDataUrl(dataUrl: string): void {
  void api
    .post('/api/assets', { data_url: dataUrl })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[assets] persist failed:', message)
    })
}

