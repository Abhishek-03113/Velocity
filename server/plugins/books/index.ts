import fs from 'fs'
import { Readable } from 'stream'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { ServerPlugin } from '../types.ts'
import { annotationsRouter } from './annotations.ts'
import {
  bookPath,
  formatLimit,
  maxBytes,
  parseRange,
  sanitizeFileName,
  sniffFile,
  streamToTemp,
  titleFromFileName,
  TooLargeError,
  type StoredUpload,
} from './files.ts'
import {
  deleteBookRow,
  getBookBySha,
  getBookRow,
  insertBook,
  listBooks,
  migrate,
  patchBook,
  toBook,
  type Book,
} from './store.ts'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

const router = new Hono()

const fail = (c: Context, error: string, status: 400 | 404 | 413 | 415 | 500) =>
  c.json<ApiResponse<never>>({ success: false, error }, status)

const idSchema = z.coerce.number().int().positive()

const patchSchema = z
  .object({
    title: z.string().trim().min(1, 'title is required').max(300, 'title is too long'),
    author: z.string().max(300, 'author is too long').nullable(),
    cover_url: z.string().regex(/^\/api\/assets\/\d+$/, 'cover_url must be /api/assets/<id>').nullable(),
    position: z.string().max(4000, 'position is too long').nullable(),
    progress: z.number().min(0, 'progress must be between 0 and 1').max(1, 'progress must be between 0 and 1'),
    status: z.enum(['unread', 'reading', 'finished']),
    page_count: z.number().int().min(0, 'page_count must be 0 or more').nullable(),
    opened: z.literal(true),
  })
  .partial()
  .strict()

router.get('/', (c) => c.json<ApiResponse<Book[]>>({ success: true, data: listBooks() }))

router.post('/', async (c) => {
  const cap = maxBytes()
  const tooLarge = () => fail(c, `Book exceeds ${formatLimit(cap)} limit`, 413)
  const declared = Number(c.req.header('content-length'))
  if (Number.isFinite(declared) && declared > cap) return tooLarge()
  const body = c.req.raw.body
  if (!body) return fail(c, 'Empty file', 400)

  let tempPath: string | null = null
  try {
    let upload: StoredUpload
    try {
      upload = await streamToTemp(body, cap)
    } catch (err) {
      if (err instanceof TooLargeError) return tooLarge()
      throw err
    }
    tempPath = upload.tempPath
    if (upload.size === 0) return fail(c, 'Empty file', 400)
    const format = sniffFile(tempPath)
    if (!format) return fail(c, 'Only EPUB and PDF files are supported', 415)

    const existing = getBookBySha(upload.sha256)
    if (existing) {
      return c.json<ApiResponse<{ book: Book; duplicate: boolean }>>({
        success: true,
        data: { book: toBook(existing), duplicate: true },
      })
    }

    const name = sanitizeFileName(c.req.header('x-file-name'))
    const id = insertBook({
      format,
      title: titleFromFileName(name),
      file_name: name || `book.${format}`,
      byte_size: upload.size,
      sha256: upload.sha256,
    })
    try {
      await fs.promises.rename(tempPath, bookPath(id, format))
      tempPath = null
    } catch (err) {
      deleteBookRow(id)
      throw err
    }
    return c.json<ApiResponse<{ book: Book; duplicate: boolean }>>(
      { success: true, data: { book: toBook(getBookRow(id)!), duplicate: false } },
      201,
    )
  } catch (err) {
    console.error('[books] upload failed', err)
    return fail(c, 'Could not store the book', 500)
  } finally {
    if (tempPath) await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
})

router.get('/:id', (c) => {
  const id = idSchema.safeParse(c.req.param('id'))
  const row = id.success ? getBookRow(id.data) : undefined
  if (!row) return fail(c, 'Book not found', 404)
  return c.json<ApiResponse<Book>>({ success: true, data: toBook(row) })
})

router.patch('/:id', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'))
  if (!id.success || !getBookRow(id.data)) return fail(c, 'Book not found', 404)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return fail(c, 'Expected a JSON body', 400)
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? 'Invalid body', 400)
  const row = patchBook(id.data, parsed.data)
  if (!row) return fail(c, 'Book not found', 404)
  return c.json<ApiResponse<Book>>({ success: true, data: toBook(row) })
})

router.delete('/:id', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'))
  const row = id.success ? getBookRow(id.data) : undefined
  if (!row) return fail(c, 'Book not found', 404)
  await fs.promises.rm(bookPath(row.id, row.format), { force: true })
  deleteBookRow(row.id)
  return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id: row.id } })
})

router.get('/:id/file', (c) => {
  const id = idSchema.safeParse(c.req.param('id'))
  const row = id.success ? getBookRow(id.data) : undefined
  if (!row) return fail(c, 'Book not found', 404)
  const file = bookPath(row.id, row.format)
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    return fail(c, 'Book file not found', 404)
  }

  const etag = `"${row.sha256}"`
  const encodedName = encodeURIComponent(row.file_name).replace(
    /['()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
  )
  const headers: Record<string, string> = {
    'Content-Type': row.format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
  }

  const inm = c.req.header('if-none-match')
  if (inm && inm.split(',').some((t) => t.trim() === '*' || t.trim().replace(/^W\//, '') === etag)) {
    return new Response(null, { status: 304, headers })
  }

  const range = parseRange(c.req.header('range'), size)
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  }
  const slice = (start: number, end: number) =>
    Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream
  if (range) {
    return new Response(slice(range.start, range.end), {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    })
  }
  if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
  return new Response(slice(0, size - 1), { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
})

router.route('/', annotationsRouter)

export const booksPlugin: ServerPlugin = { id: 'books', name: 'Books', router, migrate }
