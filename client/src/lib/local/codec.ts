/**
 * Self-describing text packing for localStorage values.
 *
 * localStorage holds ~5M UTF-16 chars, so note bodies and whiteboard scenes are compressed with
 * lz-string's UTF-16 codec when (and only when) that is actually smaller. The first char tags the
 * format — `r` raw, `z` lz-string UTF-16 — so a future codec can be added without a migration.
 */
import { compressToUTF16, decompressFromUTF16 } from 'lz-string'

/** Below this the tag + dictionary overhead can't win; skip the compression work. */
const MIN_COMPRESS_CHARS = 64

export function pack(text: string): string {
  const raw = `r${text}`
  if (text.length < MIN_COMPRESS_CHARS) return raw
  const z = `z${compressToUTF16(text)}`
  return z.length < raw.length ? z : raw
}

/** Inverse of `pack`. Throws on an unknown tag or corrupt payload rather than returning '' (which a save would then persist). */
export function unpack(stored: string): string {
  const tag = stored.charAt(0)
  const body = stored.slice(1)
  if (tag === 'r') return body
  if (tag === 'z') {
    const out = decompressFromUTF16(body)
    if (out == null) throw new Error('Corrupt compressed data')
    return out
  }
  throw new Error('Unknown storage format')
}
