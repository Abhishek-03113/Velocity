/** Typed client for /api/plugins/books. Upload goes through XHR for progress; the rest is fetch. */
import { apiBaseUrl } from '../../lib/api'
import type { Book, BookStatus } from './types'

const ROOT = '/api/plugins/books'

export const MSG_TOO_LARGE = 'Too large — books can be up to 200 MB'
export const MSG_NOT_A_BOOK = 'Not an EPUB or PDF file'
export const MSG_UNREACHABLE = 'Couldn’t reach the Velocity server'

export class BooksApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'BooksApiError'
    this.status = status
  }
}

/** A user-facing sentence for a failed upload. `status` 0 means the request never got an answer. */
export function uploadErrorMessage(status: number, serverMessage?: string | null): string {
  if (status === 0) return MSG_UNREACHABLE
  if (status === 413) return MSG_TOO_LARGE
  if (status === 415) return MSG_NOT_A_BOOK
  const text = serverMessage?.trim()
  return text || `The server couldn’t add this book (error ${status})`
}

export function isBookFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.(epub|pdf)$/i.test(file.name) || file.type === 'application/epub+zip' || file.type === 'application/pdf'
}

function mimeFor(file: Pick<File, 'name' | 'type'>): string {
  if (file.type === 'application/epub+zip' || file.type === 'application/pdf') return file.type
  if (/\.epub$/i.test(file.name)) return 'application/epub+zip'
  if (/\.pdf$/i.test(file.name)) return 'application/pdf'
  return 'application/octet-stream'
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

function parseEnvelope<T>(text: string): Envelope<T> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Envelope<T>) : null
  } catch {
    return null
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${apiBaseUrl()}${ROOT}${path}`, init)
  } catch {
    throw new BooksApiError(MSG_UNREACHABLE, 0)
  }
  const body = parseEnvelope<T>(await res.text())
  if (!res.ok || !body || body.success === false) {
    throw new BooksApiError(body?.error ?? `Request failed (${res.status})`, res.status)
  }
  return body.data as T
}

export const listBooks = () => request<Book[]>('')
export const getBook = (id: number) => request<Book>(`/${id}`)

export interface BookPatch {
  title?: string
  author?: string | null
  cover_url?: string | null
  position?: string | null
  progress?: number
  status?: BookStatus
  page_count?: number | null
  /** Per-book reader settings JSON (bookSettings.ts). */
  settings?: string | null
  opened?: true
}

export function patchBook(id: number, patch: BookPatch, opts: { keepalive?: boolean } = {}): Promise<Book> {
  return request<Book>(`/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    keepalive: opts.keepalive || undefined,
  })
}

export async function deleteBook(id: number): Promise<void> {
  await request<unknown>(`/${id}`, { method: 'DELETE' })
}

export const bookFileUrl = (book: Pick<Book, 'file_url'>) => `${apiBaseUrl()}${book.file_url}`
export const coverSrc = (book: Pick<Book, 'cover_url'>) => (book.cover_url ? `${apiBaseUrl()}${book.cover_url}` : null)

export interface UploadResult {
  book: Book
  duplicate: boolean
}

/** Upload a file as a raw body with progress (0..1). Rejects with a BooksApiError carrying a user-facing message. */
export function uploadBook(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const fail = (status: number, message?: string | null) => reject(new BooksApiError(uploadErrorMessage(status, message), status))
    if (signal?.aborted) return reject(new BooksApiError('Cancelled', 0))
    xhr.open('POST', `${apiBaseUrl()}${ROOT}`)
    xhr.setRequestHeader('Content-Type', mimeFor(file))
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total))
    }
    xhr.onerror = () => fail(0)
    xhr.ontimeout = () => fail(0)
    xhr.onabort = () => reject(new BooksApiError('Cancelled', 0))
    xhr.onload = () => {
      const body = parseEnvelope<UploadResult>(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300 && body?.success && body.data) {
        onProgress(1)
        resolve({ book: body.data.book, duplicate: Boolean(body.data.duplicate) })
      } else {
        fail(xhr.status, body?.error)
      }
    }
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

const COVER_MAX_WIDTH = 600

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unreadable cover')))
    reader.onerror = () => reject(reader.error ?? new Error('Unreadable cover'))
    reader.readAsDataURL(blob)
  })
}

/** Scale a cover down to at most 600 px wide (JPEG 0.85); smaller images are passed through. */
async function coverDataUrl(blob: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob)
    if (bitmap.width <= COVER_MAX_WIDTH && blob.size <= 4 * 1024 * 1024) {
      bitmap.close?.()
      return blobToDataUrl(blob)
    }
    const scale = Math.min(1, COVER_MAX_WIDTH / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const g = canvas.getContext('2d')
    if (!g) {
      bitmap.close?.()
      return blobToDataUrl(blob)
    }
    g.fillStyle = '#fff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return blobToDataUrl(blob)
  }
}

/** Store a cover through the core assets route. Returns '/api/assets/<id>'. */
export async function uploadCover(blob: Blob): Promise<string> {
  const data_url = await coverDataUrl(blob)
  let res: Response
  try {
    res = await fetch(`${apiBaseUrl()}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url }),
    })
  } catch {
    throw new BooksApiError(MSG_UNREACHABLE, 0)
  }
  const body = parseEnvelope<{ id: number; url: string }>(await res.text())
  if (!res.ok || !body?.success || !body.data) throw new BooksApiError(body?.error ?? 'Cover upload failed', res.status)
  return body.data.url.startsWith('/') ? body.data.url : `/api/assets/${body.data.id}`
}
