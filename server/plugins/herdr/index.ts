import { Hono, type Context, type Next } from 'hono'
import { streamSSE } from 'hono/streaming'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { ServerPlugin } from '../types.ts'
import { HerdrError } from './socket.ts'
import { HerdrService, ShareError } from './service.ts'
import * as store from './store.ts'

/**
 * Herdr connector: sends a note to a coding agent running in herdr and tracks it on the Agents
 * board. Off until HERDR_CONNECTOR_TOKEN is set; every route then needs `Authorization: Bearer`.
 */

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }
const fail = (error: string): ApiResponse<never> => ({ success: false, error })

let service: HerdrService | null = null
export function herdr(): HerdrService {
  if (!service) service = new HerdrService()
  return service
}
/** Tests point the connector at a fake herdr socket. */
export function resetHerdrService(next: HerdrService | null) {
  service?.dispose()
  service = next
}

function tokenOk(header: string | undefined, token: string): boolean {
  const given = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim() ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function auth(c: Context, next: Next) {
  const token = process.env.HERDR_CONNECTOR_TOKEN?.trim()
  if (!token) return c.json(fail('The herdr connector is off. Set HERDR_CONNECTOR_TOKEN on the Velocity server.'), 503)
  if (!tokenOk(c.req.header('Authorization'), token)) return c.json(fail('Wrong or missing herdr access token.'), 401)
  await next()
}

function herdrFailure(c: Context, err: unknown) {
  if (err instanceof ShareError) return c.json(fail(err.message), err.status)
  if (err instanceof HerdrError) return c.json(fail(err.message), err.code === 'not_found' ? 404 : 503)
  throw err
}

const shareSchema = z.object({
  noteId: z.number().int().positive(),
  noteTitle: z.string().trim().min(1).max(500),
  paneId: z.string().trim().min(1).max(64),
  text: z.string().min(1, 'Nothing to send').max(100_000, 'Prompts are limited to 100 KB'),
  hashes: z.array(z.string().max(64)).max(2000),
  askSummary: z.boolean().default(true),
  includeWhiteboard: z.boolean().default(true),
  whiteboardPng: z.string().max(28_000_000).nullish(),
})

const router = new Hono()
router.use('*', auth)

router.get('/status', async (c) => {
  try {
    return c.json({ success: true, data: await herdr().status() })
  } catch (err) {
    if (err instanceof HerdrError) return c.json(fail(err.message), 503)
    throw err
  }
})

router.get('/agents', async (c) => {
  try {
    const agents = await herdr().listAgents()
    return c.json({
      success: true,
      data: agents.map((a) => ({
        paneId: a.pane_id,
        name: a.name ?? null,
        kind: a.agent ?? null,
        title: a.terminal_title_stripped ?? a.title ?? null,
        status: a.agent_status,
        cwd: a.foreground_cwd ?? a.cwd ?? null,
        hasSession: !!a.agent_session?.value,
      })),
    })
  } catch (err) {
    return herdrFailure(c, err)
  }
})

router.get('/conversations', (c) => c.json({ success: true, data: store.listConversations() }))

router.post('/share', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(fail('Invalid JSON'), 400)
  }
  const parsed = shareSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const tooBig = issue?.code === 'too_big' && issue.path[0] === 'text'
    return c.json(fail(issue?.message ?? 'Invalid request'), tooBig ? 413 : 400)
  }
  try {
    return c.json({ success: true, data: await herdr().share(parsed.data) }, 202)
  } catch (err) {
    return herdrFailure(c, err)
  }
})

const idParam = z.object({ id: z.coerce.number().int().positive() })

router.post('/conversations/:id/seen', (c) => {
  const p = idParam.safeParse(c.req.param())
  if (!p.success || !store.getConversation(p.data.id)) return c.json(fail('Not found'), 404)
  store.updateConversation(p.data.id, { seen: 1 })
  return c.json({ success: true, data: { id: p.data.id } })
})

router.post('/conversations/archive-seen', (c) => c.json({ success: true, data: { archived: store.archiveSeen() } }))

const paneQuery = z.object({ pane: z.string().trim().min(1).max(64) })

router.post('/agents/focus', async (c) => {
  const p = paneQuery.safeParse(c.req.query())
  if (!p.success) return c.json(fail('pane is required'), 400)
  try {
    await herdr().focus(p.data.pane)
    return c.json({ success: true, data: { pane: p.data.pane } })
  } catch (err) {
    return herdrFailure(c, err)
  }
})

router.get('/agents/screen', async (c) => {
  const p = paneQuery.safeParse(c.req.query())
  if (!p.success) return c.json(fail('pane is required'), 400)
  try {
    return c.json({ success: true, data: { text: await herdr().screen(p.data.pane) } })
  } catch (err) {
    return herdrFailure(c, err)
  }
})

router.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    const queue: string[] = []
    let wake: (() => void) | null = null
    const off = herdr().subscribe((e) => {
      queue.push(JSON.stringify(e))
      wake?.()
    })
    stream.onAbort(() => {
      off()
      wake?.()
    })
    await stream.writeSSE({ event: 'ready', data: '{}' })
    while (!stream.aborted) {
      while (queue.length) await stream.writeSSE({ event: 'herdr', data: queue.shift()! })
      await Promise.race([
        new Promise<void>((r) => (wake = r)),
        stream.sleep(15_000).then(() => stream.writeSSE({ event: 'ping', data: '{}' })),
      ])
      wake = null
    }
    off()
  }),
)

export const herdrPlugin: ServerPlugin = {
  id: 'herdr',
  name: 'Herdr',
  router,
  migrate: () => store.migrate(),
  dispose: () => resetHerdrService(null),
}
