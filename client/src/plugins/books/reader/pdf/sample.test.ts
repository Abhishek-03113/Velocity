// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { flattenOutline, type OutlineNode } from './helpers'

// Runs in Node, and the client tsconfig has no Node typings: load the built-ins through variable specifiers.
const node = async (name: string) => (await import(/* @vite-ignore */ name)) as any // eslint-disable-line @typescript-eslint/no-explicit-any

describe('sample.pdf fixture', () => {
  it('opens in pdf.js with info, 12 pages and the 3-entry outline', async () => {
    const { execFileSync } = await node('node:child_process')
    const { readFileSync } = await node('node:fs')
    const { resolve } = await node('node:path')
    const { pathToFileURL, fileURLToPath } = await node('node:url')
    const clientRoot = resolve(fileURLToPath(import.meta.url), '../../../../../..')
    const script = resolve(clientRoot, 'e2e/fixtures/books/make-pdf.mjs')
    const sample = resolve(clientRoot, 'e2e/fixtures/books/sample.pdf')
    execFileSync((await node('node:process')).execPath, [script])
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve(clientRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    const doc = await lib.getDocument({
      data: new Uint8Array(readFileSync(sample)),
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
