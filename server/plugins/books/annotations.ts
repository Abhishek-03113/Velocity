import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.ts'
import { getBookRow } from './store.ts'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

export type AnnotationKind = 'highlight' | 'bookmark'

export interface AnnotationRow {
  id: number
  book_id: number
  kind: AnnotationKind
  locator: string
  text: string | null
  note: string | null
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | null
  style: 'highlight' | 'underline' | 'strike' | 'squiggle' | null
  chapter: string | null
  progress: number
  page: number | null
  created_at: string
  updated_at: string
}

export function migrateAnnotations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_book_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES plugin_books(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('highlight','bookmark')),
      locator TEXT NOT NULL, text TEXT, note TEXT,
      color TEXT CHECK (color IN ('yellow','green','blue','pink','orange')),
      style TEXT CHECK (style IN ('highlight','underline','strike','squiggle')),
      chapter TEXT, progress REAL NOT NULL DEFAULT 0, page INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS plugin_book_annotations_book ON plugin_book_annotations(book_id, progress);
  `)
}

const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const
const STYLES = ['highlight', 'underline', 'strike', 'squiggle'] as const

const common = {
  locator: z.string().min(1, 'locator is required').max(4000, 'locator is too long'),
  note: z.string().max(10000, 'note is too long').nullable().optional(),
  chapter: z.string().max(300, 'chapter is too long').nullable().optional(),
  progress: z.number().min(0, 'progress must be between 0 and 1').max(1, 'progress must be between 0 and 1'),
  page: z.number().int('page must be an integer').min(1, 'page must be 1 or more').nullable().optional(),
}

const highlightSchema = z
  .object({
    kind: z.literal('highlight'),
    ...common,
    text: z.string().min(1, 'text is required for highlights').max(10000, 'text is too long'),
    color: z.enum(COLORS, { message: 'color is required for highlights' }),
    style: z.enum(STYLES, { message: 'style is required for highlights' }),
  })
  .strict()

const bookmarkSchema = z
  .object({
    kind: z.literal('bookmark'),
    ...common,
    text: z.string().max(10000, 'text is too long').nullable().optional(),
    color: z.null({ message: 'color must be null for bookmarks' }).optional(),
    style: z.null({ message: 'style must be null for bookmarks' }).optional(),
  })
  .strict()

const patchSchema = z
  .object({
    color: z.enum(COLORS, { message: 'invalid color' }),
    style: z.enum(STYLES, { message: 'invalid style' }),
    note: z.string().max(10000, 'note is too long').nullable(),
  })
  .partial()
  .strict()

const idSchema = z.coerce.number().int().positive()
const kindSchema = z.enum(['highlight', 'bookmark'])

const fail = (c: Context, error: string, status: 400 | 404) =>
  c.json<ApiResponse<never>>({ success: false, error }, status)

const get = (bookId: number, id: number) =>
  db.prepare('SELECT * FROM plugin_book_annotations WHERE id = ? AND book_id = ?').get(id, bookId) as
    | AnnotationRow
    | undefined

export const annotationsRouter = new Hono()

function bookId(c: Context): number | null {
  const id = idSchema.safeParse(c.req.param('id'))
  return id.success && getBookRow(id.data) ? id.data : null
}

annotationsRouter.get('/:id/annotations', (c) => {
  const bid = bookId(c)
  if (bid === null) return fail(c, 'Book not found', 404)
  const rows = db
    .prepare('SELECT * FROM plugin_book_annotations WHERE book_id = ? ORDER BY progress ASC, created_at ASC, id ASC')
    .all(bid) as AnnotationRow[]
  return c.json<ApiResponse<AnnotationRow[]>>({ success: true, data: rows })
})

annotationsRouter.post('/:id/annotations', async (c) => {
  const bid = bookId(c)
  if (bid === null) return fail(c, 'Book not found', 404)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return fail(c, 'Expected a JSON body', 400)
  }
  const kind = (body as { kind?: unknown } | null)?.kind
  const parsed =
    kind === 'highlight' ? highlightSchema.safeParse(body) : kind === 'bookmark' ? bookmarkSchema.safeParse(body) : null
  if (!parsed) return fail(c, 'kind must be highlight or bookmark', 400)
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? 'Invalid body', 400)
  const a = parsed.data

  if (a.kind === 'bookmark') {
    const existing = db
      .prepare(
        "SELECT * FROM plugin_book_annotations WHERE book_id = ? AND kind = 'bookmark' AND locator = ? ORDER BY id LIMIT 1",
      )
      .get(bid, a.locator) as AnnotationRow | undefined
    if (existing) return c.json<ApiResponse<AnnotationRow>>({ success: true, data: existing }, 200)
  }
  const info = db
    .prepare(
      `INSERT INTO plugin_book_annotations (book_id, kind, locator, text, note, color, style, chapter, progress, page)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      bid,
      a.kind,
      a.locator,
      a.text ?? null,
      a.note ?? null,
      a.kind === 'highlight' ? a.color : null,
      a.kind === 'highlight' ? a.style : null,
      a.chapter ?? null,
      a.progress,
      a.page ?? null,
    )
  return c.json<ApiResponse<AnnotationRow>>({ success: true, data: get(bid, Number(info.lastInsertRowid))! }, 201)
})

annotationsRouter.patch('/:id/annotations/:aid', async (c) => {
  const bid = bookId(c)
  const aid = idSchema.safeParse(c.req.param('aid'))
  const row = bid !== null && aid.success ? get(bid, aid.data) : undefined
  if (bid === null || !row) return fail(c, bid === null ? 'Book not found' : 'Annotation not found', 404)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return fail(c, 'Expected a JSON body', 400)
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? 'Invalid body', 400)
  const p = parsed.data
  if (row.kind === 'bookmark' && (p.color !== undefined || p.style !== undefined)) {
    return fail(c, 'Bookmarks have no color or style', 400)
  }
  db.prepare(
    `UPDATE plugin_book_annotations SET color = ?, style = ?, note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND book_id = ?`,
  ).run(p.color ?? row.color, p.style ?? row.style, p.note !== undefined ? p.note : row.note, row.id, bid)
  return c.json<ApiResponse<AnnotationRow>>({ success: true, data: get(bid, row.id)! })
})

annotationsRouter.delete('/:id/annotations/:aid', (c) => {
  const bid = bookId(c)
  const aid = idSchema.safeParse(c.req.param('aid'))
  const row = bid !== null && aid.success ? get(bid, aid.data) : undefined
  if (bid === null || !row) return fail(c, bid === null ? 'Book not found' : 'Annotation not found', 404)
  db.prepare('DELETE FROM plugin_book_annotations WHERE id = ?').run(row.id)
  return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id: row.id } })
})

annotationsRouter.delete('/:id/annotations', (c) => {
  const bid = bookId(c)
  if (bid === null) return fail(c, 'Book not found', 404)
  const kind = kindSchema.safeParse(c.req.query('kind'))
  if (!kind.success) return fail(c, 'kind must be highlight or bookmark', 400)
  const info = db.prepare('DELETE FROM plugin_book_annotations WHERE book_id = ? AND kind = ?').run(bid, kind.data)
  return c.json<ApiResponse<{ deleted: number }>>({ success: true, data: { deleted: info.changes } })
})
