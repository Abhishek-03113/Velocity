import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { db } from '../db/client.ts'

type Group = {
  id: number
  name: string
  created_at: string
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

export const groupsRouter = new Hono()

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const groupPayloadSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
})

async function readJson(c: Context) {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

groupsRouter.get('/', (c) => {
  const rows = db
    .prepare('SELECT * FROM groups ORDER BY name ASC')
    .all() as Group[]
  return c.json<ApiResponse<Group[]>>({ success: true, data: rows })
})

groupsRouter.post('/', async (c) => {
  const parsed = groupPayloadSchema.safeParse(await readJson(c))
  if (!parsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, 400)
  }

  const { name } = parsed.data
  try {
    const result = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name)
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid) as Group
    return c.json<ApiResponse<Group>>({ success: true, data: group }, 201)
  } catch {
    return c.json<ApiResponse<never>>({ success: false, error: 'Group name already exists' }, 409)
  }
})

groupsRouter.put('/:id', async (c) => {
  const idParsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!idParsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const bodyParsed = groupPayloadSchema.safeParse(await readJson(c))
  if (!bodyParsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: bodyParsed.error.issues[0]?.message ?? 'Invalid payload' }, 400)
  }

  const { id } = idParsed.data
  const { name } = bodyParsed.data
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
  const parsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!parsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const { id } = parsed.data
  const result = db.prepare('DELETE FROM groups WHERE id = ?').run(id)
  if (result.changes === 0) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id } })
})
