import type { EditorView } from '@codemirror/view'
import { assetMarkdownUrl, uploadAssetDataUrl } from './api'

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i
/** Downscale large screenshots so upload + decode stay cheap. */
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

function isImageFile(file: File): boolean {
  if (IMAGE_MIME.test(file.type)) return true
  // Some clipboard sources omit MIME — fall back to extension.
  if (file.type) return false
  return IMAGE_EXT.test(file.name)
}

/** Markdown image whose src is an embedded data URL (the slow path). */
const DATA_IMAGE_MD =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/g

/** In-doc marker while an asset upload is in flight. */
export const PENDING_IMAGE_PREFIX = 'velocity-pending:'

type PreviewEntry = {
  blobUrl: string
}

/** pending id → local blob preview while uploading */
const pendingPreviews = new Map<string, PreviewEntry>()
/** final markdown url → local blob kept until the remote image paints */
const handoffPreviews = new Map<string, PreviewEntry>()

export function isPendingImageUrl(url: string): boolean {
  return url.startsWith(PENDING_IMAGE_PREFIX)
}

/** Local object URL to show while uploading or until the remote asset loads. */
export function getLocalPreviewUrl(url: string): string | null {
  if (isPendingImageUrl(url)) {
    const id = url.slice(PENDING_IMAGE_PREFIX.length)
    return pendingPreviews.get(id)?.blobUrl ?? null
  }
  return handoffPreviews.get(url)?.blobUrl ?? null
}

export function releaseLocalPreview(url: string): void {
  const entry = handoffPreviews.get(url)
  if (!entry) return
  URL.revokeObjectURL(entry.blobUrl)
  handoffPreviews.delete(url)
}

function registerPendingPreview(id: string, blobUrl: string): string {
  pendingPreviews.set(id, { blobUrl })
  return `${PENDING_IMAGE_PREFIX}${id}`
}

function promotePendingToHandoff(pendingUrl: string, finalUrl: string): void {
  if (!isPendingImageUrl(pendingUrl)) return
  const id = pendingUrl.slice(PENDING_IMAGE_PREFIX.length)
  const entry = pendingPreviews.get(id)
  if (!entry) return
  pendingPreviews.delete(id)
  // Keep the blob available under the final asset path until <img> loads it remotely.
  handoffPreviews.set(finalUrl, entry)
}

function dropPendingPreview(pendingUrl: string): void {
  if (!isPendingImageUrl(pendingUrl)) return
  const id = pendingUrl.slice(PENDING_IMAGE_PREFIX.length)
  const entry = pendingPreviews.get(id)
  if (entry) {
    URL.revokeObjectURL(entry.blobUrl)
    pendingPreviews.delete(id)
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read image'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

function altFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

function insertImageMarkdown(view: EditorView, alt: string, url: string): void {
  const { from, to } = view.state.selection.main
  const before = from > 0 ? view.state.doc.sliceString(from - 1, from) : '\n'
  const prefix = before === '\n' || from === 0 ? '' : '\n'
  const markdown = `${prefix}![${alt}](${url})\n`
  // Leave the caret on the following line so live-preview can render the image widget.
  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length },
  })
}

function replaceUrlInDoc(view: EditorView, fromUrl: string, toUrl: string): boolean {
  const text = view.state.doc.toString()
  const idx = text.indexOf(fromUrl)
  if (idx < 0) return false
  view.dispatch({
    changes: { from: idx, to: idx + fromUrl.length, insert: toUrl },
  })
  return true
}

/** Resize oversized bitmaps; leave SVG / tiny images untouched. */
async function fileToUploadDataUrl(file: File): Promise<string> {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return readFileAsDataUrl(file)
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return readFileAsDataUrl(file)
  }

  try {
    const maxEdge = Math.max(bitmap.width, bitmap.height)
    if (maxEdge <= MAX_EDGE) {
      return readFileAsDataUrl(file)
    }

    const scale = MAX_EDGE / maxEdge
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return readFileAsDataUrl(file)
    ctx.drawImage(bitmap, 0, 0, w, h)

    if (file.type === 'image/png') {
      return canvas.toDataURL('image/png')
    }
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    bitmap.close()
  }
}

/**
 * Rewrite legacy `data:image/...` embeds to short `/api/assets/:id` URLs.
 */
export async function migrateEmbeddedDataUrls(view: EditorView): Promise<void> {
  const text = view.state.doc.toString()
  if (!text.includes('data:image/')) return

  const matches = [...text.matchAll(DATA_IMAGE_MD)]
  if (matches.length === 0) return

  const uploaded = new Map<string, string>()

  for (const match of matches) {
    const rawDataUrl = match[2]!
    const normalized = rawDataUrl.replace(/\s+/g, '')
    try {
      let url = uploaded.get(normalized)
      if (!url) {
        const asset = await uploadAssetDataUrl(normalized)
        url = assetMarkdownUrl(asset)
        uploaded.set(normalized, url)
      }
      replaceUrlInDoc(view, rawDataUrl, url)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[editor:image] migrate failed:', message)
    }
  }
}

/**
 * Insert images with an immediate local preview, then swap to `/api/assets/:id`.
 */
export async function insertImageFiles(view: EditorView, files: File[]): Promise<boolean> {
  const images = files.filter(isImageFile)
  if (images.length === 0) return false

  for (const file of images) {
    const alt = altFromFilename(file.name)
    const pendingId = crypto.randomUUID()
    const blobUrl = URL.createObjectURL(file)
    const pendingUrl = registerPendingPreview(pendingId, blobUrl)
    insertImageMarkdown(view, alt, pendingUrl)

    try {
      const dataUrl = await fileToUploadDataUrl(file)
      const asset = await uploadAssetDataUrl(dataUrl)
      const url = assetMarkdownUrl(asset)
      promotePendingToHandoff(pendingUrl, url)
      if (!replaceUrlInDoc(view, pendingUrl, url)) {
        console.error('[editor:image] pending URL missing after upload')
        dropPendingPreview(pendingUrl)
        releaseLocalPreview(url)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[editor:image] upload failed:', message)
      try {
        const dataUrl = await readFileAsDataUrl(file)
        promotePendingToHandoff(pendingUrl, dataUrl)
        if (!replaceUrlInDoc(view, pendingUrl, dataUrl)) {
          dropPendingPreview(pendingUrl)
        }
      } catch (fallbackErr) {
        dropPendingPreview(pendingUrl)
        const fallbackMsg =
          fallbackErr instanceof Error ? fallbackErr.message : 'unknown error'
        console.error('[editor:image] fallback embed failed:', fallbackMsg)
      }
    }
  }
  return true
}
