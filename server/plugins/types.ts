import type { Hono } from 'hono'

/** A server-side plugin: a router mounted at `/api/plugins/<id>`. */
export interface ServerPlugin {
  id: string
  name: string
  router: Hono
}
