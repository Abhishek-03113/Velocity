import type { Context, Next } from 'hono'

export async function errorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    console.error(err)
    c.status(500)
    return c.json({ error: 'Internal server error' })
  }
}
