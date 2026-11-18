// @vitest-environment jsdom
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { readEpubMeta } from './meta'

// 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function buildEpub(withCover: boolean): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>  The Velocity   Sampler </dc:title><dc:creator>Ada Reader</dc:creator><dc:language>en</dc:language>${withCover ? '<meta name="cover" content="cov"/>' : ''}</metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>${withCover ? '<item id="cov" href="cover.png" media-type="image/png" properties="cover-image"/>' : ''}</manifest>
<spine><itemref idref="c1"/></spine></package>`,
  )
  zip.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body><p>Hi</p></body></html>')
  if (withCover) zip.file('OEBPS/cover.png', PNG_B64, { base64: true })
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  // Copy into a jsdom-realm ArrayBuffer (epub.js checks `instanceof ArrayBuffer`).
  const data = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(data).set(bytes)
  return data
}

describe('readEpubMeta', () => {
  it('parses title (whitespace-normalised) and author, no cover', async () => {
    const meta = await readEpubMeta(await buildEpub(false))
    expect(meta.title).toBe('The Velocity Sampler')
    expect(meta.author).toBe('Ada Reader')
    expect(meta.pageCount).toBeNull()
    expect(meta.cover).toBeNull()
  }, 15000)

  it('never throws over the cover; returns a non-empty image when it can read one', async () => {
    const meta = await readEpubMeta(await buildEpub(true))
    expect(meta.title).toBe('The Velocity Sampler')
    // jsdom's blob: URL support is partial, so a null cover is tolerated here (real browsers return the PNG).
    if (meta.cover) expect(meta.cover.size).toBeGreaterThan(0)
  }, 15000)
})
