import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  assetPath,
  getAsset,
  parseDataUrl,
  storeImageBuffer,
  type AssetRow,
} from '../db/assets.ts'
import fs from 'fs'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

export const assetsRouter = new Hono()

const createAssetSchema = z.object({
  data_url: z.string().min(1),
})

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

async function readJson(c: Context) {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function publicAsset(asset: AssetRow) {
  return {
    id: asset.id,
    mime_type: asset.mime_type,
    ext: asset.ext,
    byte_size: asset.byte_size,
    sha256: asset.sha256,
    url: `/api/assets/${asset.id}`,
    created_at: asset.created_at,
  }
}

assetsRouter.post('/', async (c) => {
  const parsed = createAssetSchema.safeParse(await readJson(c))
  if (!parsed.success) {
    return c.json<ApiResponse<never>>(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      400
    )
  }

  const decoded = parseDataUrl(parsed.data.data_url)
  if (!decoded) {
    return c.json<ApiResponse<never>>(
      { success: false, error: 'Invalid or unsupported image data URL' },
      400
    )
  }

  // Soft guard — keep individual assets under ~5MB decoded
  const MAX_BYTES = 5 * 1024 * 1024
  if (decoded.buffer.byteLength > MAX_BYTES) {
    return c.json<ApiResponse<never>>(
      { success: false, error: 'Image exceeds 5MB limit' },
      413
    )
  }

  try {
    const asset = storeImageBuffer(decoded.mime, decoded.buffer)
    return c.json<ApiResponse<ReturnType<typeof publicAsset>>>(
      { success: true, data: publicAsset(asset) },
      201
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to store asset'
    console.error(`[${new Date().toISOString()}] asset write failure:`, message)
    return c.json<ApiResponse<never>>({ success: false, error: message }, 500)
  }
})

assetsRouter.get('/:id', (c) => {
  const parsed = idParamSchema.safeParse({ id: c.req.param('id') })
  if (!parsed.success) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Invalid id' }, 400)
  }

  const asset = getAsset(parsed.data.id)
  if (!asset) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Not found' }, 404)
  }

  const file = assetPath(asset.id, asset.ext)
  if (!fs.existsSync(file)) {
    return c.json<ApiResponse<never>>({ success: false, error: 'File missing' }, 404)
  }

  const body = fs.readFileSync(file)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': asset.mime_type,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})
