import type { BookFileMeta } from '../types'

interface PackageMeta {
  title?: string
  creator?: string
}

export function cleanMetaText(s: string | undefined | null): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t || null
}

/** Reads title, author and cover from an EPUB at import time. A missing or broken cover yields `cover: null`. */
export async function readEpubMeta(data: ArrayBuffer): Promise<BookFileMeta> {
  const { default: ePub } = await import('epubjs')
  const book = ePub(data.slice(0))
  let coverUrl: string | null = null
  try {
    await book.ready
    const md = (await book.loaded.metadata) as unknown as PackageMeta
    let cover: Blob | null = null
    try {
      coverUrl = await book.coverUrl()
      if (coverUrl) {
        const res = await fetch(coverUrl)
        if (res.ok) cover = await res.blob()
      }
    } catch {
      cover = null
    }
    return { title: cleanMetaText(md.title), author: cleanMetaText(md.creator), pageCount: null, cover }
  } finally {
    if (coverUrl?.startsWith('blob:')) URL.revokeObjectURL(coverUrl)
    book.destroy()
  }
}
