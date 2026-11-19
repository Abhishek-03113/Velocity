import { runMigrations } from './db/migrate.ts'
import { createApp } from './app.ts'
import { startMarkdownSync } from './workers/markdownSync.ts'
import { startEmptyNoteCleanup } from './workers/emptyNoteCleanup.ts'
import { maxBytes } from './plugins/books/files.ts'

// Bun loads `.env` from the working directory on its own; no dotenv needed.
runMigrations()
startMarkdownSync()
startEmptyNoteCleanup()

const app = createApp()
const PORT = Number(process.env.PORT ?? 3000)

Bun.serve({
  fetch: app.fetch,
  port: PORT,
  // Bun caps request bodies at 128 MB by default; Books uploads stream up to
  // BOOKS_MAX_BYTES (200 MB) and enforce that limit themselves with a clear 413.
  maxRequestBodySize: Math.max(256 * 1024 * 1024, maxBytes() + 16 * 1024 * 1024),
  // Herdr SSE and LaTeX compiles (30 s) can sit idle longer than Bun's 10 s default.
  idleTimeout: 0,
})
console.log(`Server running on http://localhost:${PORT}`)
