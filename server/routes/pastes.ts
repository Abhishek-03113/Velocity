import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { requestMarkdownSync } from '../workers/markdownSync.ts'

type Paste = {
  id: number
  title: string | null
  content: string | null
  group_id: number | null
  created_at: string
  updated_at: string
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

export const pastesRouter = new Hono()

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const createPasteSchema = z.object({
  title: z.string().trim().optional(),
  content: z.string().optional(),
  group_id: z.number().int().positive().nullable().optional(),
})

const updatePasteSchema = z
  .object({
    title: z.string().optional(),
    content: z.string().optional(),
    group_id: z.number().int().positive().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required')

function logPasteWriteFailure(action: string, pasteId: number | null, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(
    `[${new Date().toISOString()}] paste write failure action=${action} pasteId=${pasteId ?? 'new'} error=${message}`
  )
}

async function readJson(c: Context) {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function groupExists(groupId: number | null | undefined): boolean {
  if (groupId == null) return true
  return Boolean(db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId))
}

pastesRouter.get('/', (c) => {
  const rows = db
    .prepare(
      `SELECT id, title, group_id, updated_at,
              EXISTS(SELECT 1 FROM whiteboards w WHERE w.paste_id = pastes.id) AS has_whiteboard
       FROM pastes ORDER BY updated_at DESC`
    )
    .all() as (Pick<Paste, 'id' | 'title' | 'group_id' | 'updated_at'> & { has_whiteboard: 0 | 1 })[]
  return c.json<ApiResponse<typeof rows>>({ success: true, data: rows })
})

pastesRouter.post('/', async (c) => {
  const parsed = createPasteSchema.safeParse(await readJson(c))
  if (!parsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, 400)
  }

  const title = parsed.data.title || 'Untitled'
  const content = parsed.data.content ?? ''
  const groupId = parsed.data.group_id ?? null

  if (!groupExists(groupId)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Group not found' }, 400)
  }

  try {
    const result = db
      .prepare('INSERT INTO pastes (title, content, group_id) VALUES (?, ?, ?)')
      .run(title, content, groupId)

    const paste = db
      .prepare('SELECT * FROM pastes WHERE id = ?')
      .get(result.lastInsertRowid) as Paste

    requestMarkdownSync(paste.id)
    return c.json<ApiResponse<Paste>>({ success: true, data: paste }, 201)
  } catch (err) {
    logPasteWriteFailure('create', null, err)
    return c.json<ApiResponse<never>>({ success: false, error: 'Failed to create paste' }, 500)
  }
})

pastesRouter.get('/:id', (c) => {
  const parsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!parsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const { id } = parsed.data
  const paste = db.prepare('SELECT * FROM pastes WHERE id = ?').get(id) as Paste | undefined
  if (!paste) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  return c.json<ApiResponse<Paste>>({ success: true, data: paste })
})

pastesRouter.put('/:id', async (c) => {
  const idParsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!idParsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const id = idParsed.data.id
  const bodyParsed = updatePasteSchema.safeParse(await readJson(c))
  if (!bodyParsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: bodyParsed.error.issues[0]?.message ?? 'Invalid payload' }, 400)
  }

  const body = bodyParsed.data

  const existing = db.prepare('SELECT id FROM pastes WHERE id = ?').get(id)
  if (!existing) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  if (!groupExists(body.group_id)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Group not found' }, 400)
  }

  try {
    db.prepare(
      `UPDATE pastes
       SET title = COALESCE(?, title),
           content = COALESCE(?, content),
           group_id = CASE WHEN ? THEN ? ELSE group_id END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      body.title ?? null,
      body.content ?? null,
      Object.prototype.hasOwnProperty.call(body, 'group_id') ? 1 : 0,
      body.group_id ?? null,
      id
    )

    // Autosave sends the body on every save — don't echo it back.
    const paste = db
      .prepare('SELECT id, title, group_id, created_at, updated_at FROM pastes WHERE id = ?')
      .get(id) as Omit<Paste, 'content'>
    requestMarkdownSync(id)
    return c.json<ApiResponse<Omit<Paste, 'content'>>>({ success: true, data: paste })
  } catch (err) {
    logPasteWriteFailure('update', id, err)
    return c.json<ApiResponse<never>>({ success: false, error: 'Failed to update paste' }, 500)
  }
})

pastesRouter.delete('/:id', (c) => {
  const parsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!parsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const { id } = parsed.data
  try {
    const result = db.prepare('DELETE FROM pastes WHERE id = ?').run(id)
    if (result.changes === 0) {
      return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
    }

    requestMarkdownSync(id)
    return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id } })
  } catch (err) {
    logPasteWriteFailure('delete', id, err)
    return c.json<ApiResponse<never>>({ success: false, error: 'Failed to delete paste' }, 500)
  }
})
