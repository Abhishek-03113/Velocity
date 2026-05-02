import { Hono } from 'hono'
import { db } from '../db/client.ts'

type Group = {
  id: number
  name: string
  created_at: string
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

export const groupsRouter = new Hono()

groupsRouter.get('/', (c) => {
  const rows = db
    .prepare('SELECT * FROM groups ORDER BY name ASC')
    .all() as Group[]
  return c.json<ApiResponse<Group[]>>({ success: true, data: rows })
})

groupsRouter.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name) {
    return c.json<ApiResponse<never>>({ success: false, error: 'name is required' }, 400)
  }

  try {
    const result = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name)
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid) as Group
    return c.json<ApiResponse<Group>>({ success: true, data: group }, 201)
  } catch {
    return c.json<ApiResponse<never>>({ success: false, error: 'Group name already exists' }, 409)
  }
})

groupsRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name) {
    return c.json<ApiResponse<never>>({ success: false, error: 'name is required' }, 400)
  }

  const existing = db.prepare('SELECT id FROM groups WHERE id = ?').get(id)
  if (!existing) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  try {
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id)
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group
    return c.json<ApiResponse<Group>>({ success: true, data: group })
  } catch {
    return c.json<ApiResponse<never>>({ success: false, error: 'Group name already exists' }, 409)
  }
})

groupsRouter.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const result = db.prepare('DELETE FROM groups WHERE id = ?').run(id)
  if (result.changes === 0) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id } })
})
