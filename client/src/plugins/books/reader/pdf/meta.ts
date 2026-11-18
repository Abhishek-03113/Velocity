import type { BookFileMeta } from '../types'
import { cleanInfoString } from './helpers'
import { loadPdfjs } from './pdfjs'

const COVER_WIDTH = 600

/** Title, author, page count and a page-1 cover for a PDF being imported. */
export async function readPdfMeta(data: ArrayBuffer): Promise<BookFileMeta> {
  const lib = await loadPdfjs()
  // pdf.js transfers (detaches) the buffer it is given: always hand it a copy.
  const task = lib.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false, enableXfa: false })
  const doc = await task.promise
  try {
    let title: string | null = null
    let author: string | null = null
    try {
      const { info } = await doc.getMetadata()
      const i = (info ?? {}) as Record<string, unknown>
      title = cleanInfoString(i.Title)
      author = cleanInfoString(i.Author)
    } catch {
      /* metadata is optional */
    }
    let cover: Blob | null = null
    try {
      cover = await renderCover(doc)
    } catch {
      cover = null
    }
    return { title, author, pageCount: doc.numPages, cover }
  } finally {
    await doc.destroy()
  }
}

async function renderCover(doc: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['getDocument']>['promise']>): Promise<Blob | null> {
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: COVER_WIDTH / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  canvas.width = 0
  canvas.height = 0
  page.cleanup()
  return blob
}
