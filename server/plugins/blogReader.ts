import { Hono } from 'hono'
import { z } from 'zod'
import type { ServerPlugin } from './types.ts'
import { fetchPage, FetchPageError } from './shared/fetchPage.ts'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

const querySchema = z.object({
  url: z.string().trim().min(1, 'url is required').max(2048, 'url is too long'),
})

const router = new Hono()

// Dumb transport: returns the page HTML; the client extracts it and creates the note.
router.get('/fetch', async (c) => {
  const parsed = querySchema.safeParse({ url: c.req.query('url') ?? '' })
  if (!parsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' }, 400)
  }
  try {
    const page = await fetchPage(parsed.data.url)
    return c.json<ApiResponse<{ url: string; finalUrl: string; contentType: string; html: string }>>({
      success: true,
      data: { url: page.url, finalUrl: page.finalUrl, contentType: page.contentType, html: page.body },
    })
  } catch (err) {
    if (err instanceof FetchPageError) {
      return c.json<ApiResponse<never>>({ success: false, error: err.message }, err.status)
    }
    throw err
  }
})

export const blogReaderPlugin: ServerPlugin = { id: 'blog-reader', name: 'Blog Reader', router }
