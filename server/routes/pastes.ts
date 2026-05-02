import { Hono } from 'hono'
import { db } from '../db/client.ts'

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

pastesRouter.get('/', (c) => {
  const rows = db
    .prepare('SELECT id, title, updated_at FROM pastes ORDER BY updated_at DESC')
    .all() as Pick<Paste, 'id' | 'title' | 'updated_at'>[]
  return c.json<ApiResponse<typeof rows>>({ success: true, data: rows })
})

pastesRouter.post('/', async (c) => {
  const body = await c.req.json<{ title?: string; content?: string }>()
  const title = body.title?.trim() ?? 'Untitled'
  const content = body.content ?? ''

  const result = db
    .prepare('INSERT INTO pastes (title, content) VALUES (?, ?)')
    .run(title, content)

  const paste = db
    .prepare('SELECT * FROM pastes WHERE id = ?')
    .get(result.lastInsertRowid) as Paste

  return c.json<ApiResponse<Paste>>({ success: true, data: paste }, 201)
})

pastesRouter.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const paste = db.prepare('SELECT * FROM pastes WHERE id = ?').get(id) as Paste | undefined
  if (!paste) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  return c.json<ApiResponse<Paste>>({ success: true, data: paste })
})

pastesRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const body = await c.req.json<{ title?: string; content?: string }>()

  const existing = db.prepare('SELECT id FROM pastes WHERE id = ?').get(id)
  if (!existing) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  db.prepare(
    'UPDATE pastes SET title = COALESCE(?, title), content = COALESCE(?, content), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(body.title ?? null, body.content ?? null, id)

  const paste = db.prepare('SELECT * FROM pastes WHERE id = ?').get(id) as Paste
  return c.json<ApiResponse<Paste>>({ success: true, data: paste })
})

pastesRouter.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const result = db.prepare('DELETE FROM pastes WHERE id = ?').run(id)
  if (result.changes === 0) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id } })
})
