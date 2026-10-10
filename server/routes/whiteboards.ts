import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/client.ts'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

/** Excalidraw scenes embed images (`files`) as data URLs, so the cap is generous. */
export const MAX_SCENE_BYTES = 10 * 1024 * 1024

const idParamSchema = z.object({ id: z.coerce.number().int().positive() })

const sceneSchema = z.object({
  scene: z.object({ elements: z.array(z.unknown()) }).passthrough(),
})

/** Mounted at `/api/pastes`; handles `/:id/whiteboard`. */
export const whiteboardRouter = new Hono()

function fail(message: string): ApiResponse<never> {
  return { success: false, error: message }
}

whiteboardRouter.get('/:id/whiteboard', (c) => {
  const parsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!parsed.success) return c.json(fail('Invalid id'), 400)

  const row = db
    .prepare('SELECT scene, updated_at FROM whiteboards WHERE paste_id = ?')
    .get(parsed.data.id) as { scene: string; updated_at: string } | undefined
  if (!row) return c.json(fail('Not found'), 404)

  return c.json<ApiResponse<{ scene: unknown; updated_at: string }>>({
    success: true,
    data: { scene: JSON.parse(row.scene), updated_at: row.updated_at },
  })
})

whiteboardRouter.put('/:id/whiteboard', async (c) => {
  const idParsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!idParsed.success) return c.json(fail('Invalid id'), 400)
  const id = idParsed.data.id

  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > MAX_SCENE_BYTES + 1024) return c.json(fail('Whiteboard too large'), 413)

  const raw = await c.req.text()
  if (Buffer.byteLength(raw) > MAX_SCENE_BYTES + 1024) return c.json(fail('Whiteboard too large'), 413)

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return c.json(fail('Invalid JSON'), 400)
  }
  const parsed = sceneSchema.safeParse(body)
  if (!parsed.success) return c.json(fail('scene must be an object with an elements array'), 400)

  const serialized = JSON.stringify(parsed.data.scene)
  if (Buffer.byteLength(serialized) > MAX_SCENE_BYTES) return c.json(fail('Whiteboard too large'), 413)

  if (!db.prepare('SELECT 1 FROM pastes WHERE id = ?').get(id)) return c.json(fail('Not found'), 404)

  try {
    db.prepare(
      `INSERT INTO whiteboards (paste_id, scene, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(paste_id) DO UPDATE SET scene = excluded.scene, updated_at = CURRENT_TIMESTAMP`
    ).run(id, serialized)
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] whiteboard write failure pasteId=${id} error=${err instanceof Error ? err.message : String(err)}`
    )
    return c.json(fail('Failed to save whiteboard'), 500)
  }
  return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id } })
})

whiteboardRouter.delete('/:id/whiteboard', (c) => {
  const parsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!parsed.success) return c.json(fail('Invalid id'), 400)
  const result = db.prepare('DELETE FROM whiteboards WHERE paste_id = ?').run(parsed.data.id)
  if (result.changes === 0) return c.json(fail('Not found'), 404)
  return c.json<ApiResponse<{ id: number }>>({ success: true, data: { id: parsed.data.id } })
})
