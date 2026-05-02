import { Hono } from 'hono'

export const routes = new Hono()

routes.get('/health', (c) => c.json({ status: 'ok' }))
