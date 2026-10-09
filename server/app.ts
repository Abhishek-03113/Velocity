import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { compress } from 'hono/compress'
import { pastesRouter } from './routes/pastes.ts'
import { whiteboardRouter } from './routes/whiteboards.ts'
import { groupsRouter } from './routes/groups.ts'
import { assetsRouter } from './routes/assets.ts'
import { errorHandler } from './middleware/error.ts'

/** HTTP app, separate from `serve()` so tests can call `app.request()` directly. */
export function createApp(opts: { log?: boolean } = {}) {
  const app = new Hono()

  if (opts.log !== false) app.use('*', logger())
  app.use('*', cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173' }))
  // Note bodies are text — gzip makes cold loads of large notes much cheaper.
  app.use('/api/pastes/*', compress())
  app.use('*', errorHandler)

  app.get('/', (c) => c.json({ message: 'Velocity API' }))
  app.route('/api/pastes', whiteboardRouter)
  app.route('/api/pastes', pastesRouter)
  app.route('/api/groups', groupsRouter)
  app.route('/api/assets', assetsRouter)
  return app
}
