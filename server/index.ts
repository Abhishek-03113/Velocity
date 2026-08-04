import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import 'dotenv/config'
import { runMigrations } from './db/migrate.ts'
import { pastesRouter } from './routes/pastes.ts'
import { groupsRouter } from './routes/groups.ts'
import { errorHandler } from './middleware/error.ts'
import { startMarkdownSync } from './workers/markdownSync.ts'

runMigrations()
startMarkdownSync()

const app = new Hono()

app.use('*', logger())
app.use('*', cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173' }))
app.use('*', errorHandler)

app.get('/', (c) => c.json({ message: 'Velocity API' }))
app.route('/api/pastes', pastesRouter)
app.route('/api/groups', groupsRouter)

const PORT = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
