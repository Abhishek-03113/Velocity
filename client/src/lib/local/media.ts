/**
 * Pasted images in the browser-only runtime.
 *
 * Notes reference images as `/api/assets/<id>`; there is no server to answer, so <img> srcs are
 * rewritten (lib/api.ts `resolveMediaUrl`) to a `blob:` URL built once per asset from the stored
 * data URL. The cache is bounded by the number of stored assets, never creates a second URL for
 * the same id, and is revoked when the asset is deleted.
 */
import * as kv from './kv'

const ASSET_PATH = /^\/api\/assets\/(\d+)$/

/** asset id -> blob: URL. */
const urls = new Map<number, string>()

/** Decode a base64 data URL into bytes + mime. Null if it isn't one. */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const bin = atob(m[2]!.replace(/\s+/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { mime: m[1]!, bytes }
  } catch {
    return null
  }
}

/** `/api/assets/:id` -> cached blob: URL; anything else (or an unknown id) is returned unchanged. */
export function localMediaUrl(href: string): string {
  const m = ASSET_PATH.exec(href)
  if (!m) return href
  const id = Number(m[1])
  const cached = urls.get(id)
  if (cached) return cached
  if (typeof URL.createObjectURL !== 'function') return href
  const dataUrl = kv.get(`a.${id}`)
  if (dataUrl === null) return href
  const decoded = decodeDataUrl(dataUrl)
  if (!decoded) return href
  const url = URL.createObjectURL(new Blob([decoded.bytes as BlobPart], { type: decoded.mime }))
  urls.set(id, url)
  return url
}

/** Drop (and revoke) the cached blob: URL of a deleted asset. */
export function forgetLocalMedia(id: number): void {
  const url = urls.get(id)
  if (!url) return
  urls.delete(id)
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

/** Revoke everything (tests). */
export function clearLocalMedia(): void {
  for (const id of [...urls.keys()]) forgetLocalMedia(id)
}
