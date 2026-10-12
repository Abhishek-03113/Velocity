import type { Hono } from 'hono'
import type { ServerPlugin } from './types.ts'
import { blogReaderPlugin } from './blogReader.ts'

/** The single additive list of server plugins. */
export const SERVER_PLUGINS: ServerPlugin[] = [blogReaderPlugin]

/** Mounts every plugin router and exposes `GET /api/plugins`. */
export function mountPlugins(app: Hono) {
  app.get('/api/plugins', (c) =>
    c.json({ success: true, data: SERVER_PLUGINS.map(({ id, name }) => ({ id, name })) }),
  )
  for (const p of SERVER_PLUGINS) app.route(`/api/plugins/${p.id}`, p.router)
}
