import fs from 'fs'
import path from 'path'
import { randomBytes, createHash } from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Where book files live: `<id>.epub` / `<id>.pdf`, beside `data/assets` by default. */
export const BOOKS_DIR = process.env.BOOKS_DIR ?? path.resolve(__dirname, '../../../data/books')

export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024

/** Read per request so the cap can be changed without a restart (and in tests). */
export function maxBytes(): number {
  const n = Number(process.env.BOOKS_MAX_BYTES)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES
}

export function formatLimit(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

export function ensureBooksDir() {
  fs.mkdirSync(BOOKS_DIR, { recursive: true })
}

export type BookFormat = 'epub' | 'pdf'

export function bookPath(id: number, format: BookFormat): string {
  return path.join(BOOKS_DIR, `${id}.${format}`)
}

export class TooLargeError extends Error {}

export interface StoredUpload {
  tempPath: string
  size: number
  sha256: string
}

/** Streams a web body to a temp file in BOOKS_DIR while hashing and counting; aborts over `cap`. */
export async function streamToTemp(body: ReadableStream<Uint8Array>, cap: number): Promise<StoredUpload> {
  ensureBooksDir()
  const tempPath = path.join(BOOKS_DIR, `.upload-${randomBytes(8).toString('hex')}`)
  const hash = createHash('sha256')
  const out = fs.createWriteStream(tempPath)
  // Surface write errors through the awaits below instead of an unhandled 'error' event.
  let writeError: Error | null = null
  out.on('error', (e) => {
    writeError = e
  })
  let size = 0
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (writeError) throw writeError
      size += value.byteLength
      if (size > cap) {
        await reader.cancel().catch(() => {})
        throw new TooLargeError()
      }
      hash.update(value)
      if (!out.write(value)) {
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          out.once('drain', done)
          out.once('error', done)
        })
      }
    }
    await new Promise<void>((resolve) => out.end(resolve))
    if (writeError) throw writeError
    return { tempPath, size, sha256: hash.digest('hex') }
  } catch (err) {
    out.destroy()
    await fs.promises.rm(tempPath, { force: true })
    throw err
  }
}

/** Format from the first bytes of a file, or null when it is neither a PDF nor an EPUB. */
export function sniffFile(file: string): BookFormat | null {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1024)
    const n = fs.readSync(fd, buf, 0, 1024, 0)
    const head = buf.subarray(0, n)
    if (head.includes('%PDF-')) return 'pdf'
    // ZIP local header, first entry named "mimetype" (stored) holding application/epub+zip.
    if (
      n >= 58 &&
      head.readUInt32LE(0) === 0x04034b50 &&
      head.toString('latin1', 30, 38) === 'mimetype' &&
      head.toString('latin1', 38, 58) === 'application/epub+zip'
    ) {
      return 'epub'
    }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

/** Decodes the X-File-Name header; strips path separators and control characters; max 255 chars. */
export function sanitizeFileName(raw: string | undefined | null): string {
  let name = raw ?? ''
  try {
    name = decodeURIComponent(name)
  } catch {
    /* keep the raw header */
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]+/g, '_').trim()
  return name.slice(0, 255)
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.(epub|pdf)$/i, '').trim()
  return (base || 'Untitled book').slice(0, 300)
}

export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null

/** Parses a `bytes=` range. null = no/ignorable header; 'unsatisfiable' also covers multi-range. */
export function parseRange(header: string | undefined | null, size: number): RangeResult {
  if (!header) return null
  const m = /^bytes=(.+)$/i.exec(header.trim())
  if (!m) return null
  if (m[1].includes(',')) return 'unsatisfiable'
  const r = /^(\d*)-(\d*)$/.exec(m[1].trim())
  if (!r || (r[1] === '' && r[2] === '')) return null
  if (r[1] === '') {
    const n = Number(r[2])
    if (n === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(r[1])
  const end = r[2] === '' ? size - 1 : Math.min(Number(r[2]), size - 1)
  if (start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}
