import { serve } from '@hono/node-server'
import 'dotenv/config'
import { runMigrations } from './db/migrate.ts'
import { createApp } from './app.ts'
import { startMarkdownSync } from './workers/markdownSync.ts'
import { startEmptyNoteCleanup } from './workers/emptyNoteCleanup.ts'

runMigrations()
startMarkdownSync()
startEmptyNoteCleanup()

const app = createApp()
const PORT = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
