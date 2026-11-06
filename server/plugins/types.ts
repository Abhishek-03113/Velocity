import type { Hono } from 'hono'

/** A server-side plugin: a router mounted at `/api/plugins/<id>`. */
export interface ServerPlugin {
  id: string
  name: string
  router: Hono
  /** Create or update the plugin's own tables. Runs once per process, when plugins are mounted. */
  migrate?: () => void
  /** Release timers and connections (tests, shutdown). */
  dispose?: () => void
}
