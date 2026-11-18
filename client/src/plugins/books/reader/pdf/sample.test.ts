// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildPdf } from '../../../../../e2e/fixtures/books/make-pdf'
import { flattenOutline, type OutlineNode } from './helpers'

describe('sample.pdf fixture', () => {
  it('is what make-pdf.ts generates, and opens in pdf.js with info, 12 pages and the 3-entry outline', async () => {
    const clientRoot = resolve(fileURLToPath(import.meta.url), '../../../../../..')
    const sample = resolve(clientRoot, 'e2e/fixtures/books/sample.pdf')
    const generated = buildPdf()
    expect(readFileSync(sample).equals(generated)).toBe(true)
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve(clientRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    const doc = await lib.getDocument({
      data: new Uint8Array(generated),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise
    try {
      expect(doc.numPages).toBe(12)
      const { info } = await doc.getMetadata()
      expect((info as Record<string, string>).Title).toBe('Velocity PDF Handbook')
      expect((info as Record<string, string>).Author).toBe('Lin Pages')

      const toc = await flattenOutline((await doc.getOutline()) as OutlineNode[], async (dest) => {
        const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest
        return Array.isArray(d) ? (await doc.getPageIndex(d[0])) + 1 : null
      })
      expect(toc.map((t) => [t.label, t.target])).toEqual([
        ['Part I: Basics', 'page:1'],
        ['Part II: Practice', 'page:5'],
        ['Part III: Mastery', 'page:9'],
      ])

      const page = await doc.getPage(7)
      const text = await page.getTextContent()
      expect(text.items.map((i) => ('str' in i ? i.str : '')).join(' ')).toContain('Page 7')
    } finally {
      await doc.destroy()
    }
  })
})
