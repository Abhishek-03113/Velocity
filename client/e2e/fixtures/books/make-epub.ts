// Generates sample.epub next to this script: `npm run fixtures:books` (from client/), or `tsx e2e/fixtures/books/make-epub.ts`.
// EPUB 3 with an NCX for EPUB 2 readers. Output is deterministic (fixed timestamps) so the file diffs cleanly.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import JSZip from 'jszip'

const here = dirname(fileURLToPath(import.meta.url))
const FIXED = new Date('2024-01-01T00:00:00Z')

// 8x12 solid-colour PNG (a few hundred bytes), generated here so no binary blob lives in the source.
function crc32(buf: Buffer): number {
  let c: number
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng(w: number, h: number): Buffer {
  const rows: Buffer[] = []
  for (let y = 0; y < h; y++) {
    const row: number[] = [0]
    for (let x = 0; x < w; x++) {
      const t = y / h
      row.push(Math.round(40 + 90 * t), Math.round(70 + 60 * (x / w)), Math.round(150 - 60 * t))
    }
    rows.push(Buffer.from(row))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

interface Chapter {
  id: string
  title: string
  lead: string
}

export interface EpubOptions {
  title?: string
  author?: string
  /** Number of generated chapters. Leave out for the three-chapter sample. */
  chapters?: number
  /** Paragraphs per chapter (default 8). */
  paragraphs?: number
  /** Include a cover image (default true). */
  cover?: boolean
}

const SAMPLE_CHAPTERS: Chapter[] = [
  { id: 'ch1', title: 'Chapter 1: Departure', lead: 'The harbour woke slowly' },
  { id: 'ch2', title: 'Chapter 2: Momentum', lead: 'By the second week the journey had a rhythm' },
  { id: 'ch3', title: 'Chapter 3: Arrival', lead: 'The coastline appeared as a thin grey line' },
]

const PLACES = ['Aldmere', 'Brackwater', 'Corvin Sound', 'Dunmarrow', 'Esker Point', 'Fenwick Reach', 'Galloway Strait', 'Harrow Cay']

/** Generated chapters for long books: deterministic titles and lead lines. */
function generatedChapters(n: number): Chapter[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `ch${i + 1}`,
    title: `Chapter ${i + 1}: ${PLACES[i % PLACES.length]}`,
    lead: `Chapter ${i + 1} opened at ${PLACES[i % PLACES.length]}, where the tide had already turned`,
  }))
}

const sentences = [
  'Morning light slid across the water and touched every mast in turn, so that the whole harbour seemed to be lit from within.',
  'Nobody spoke for a while; the only sounds were the creak of rope, the slap of small waves, and the distant bell of a buoy.',
  'She checked the map once more, though she already knew the route by heart, because checking was a way of being brave.',
  'The old navigator tapped his pipe against the rail and remarked that the best journeys begin before anyone is quite ready.',
  'A gull circled twice, considered the little boat, and decided it was not worth the effort of following.',
  'By noon the town had shrunk to a smudge of rooftops, and the open sea stretched ahead like a blank page waiting for a sentence.',
  'They shared bread and cheese on deck, passing the knife from hand to hand, and talked about everything except where they were going.',
  'When the wind finally turned in their favour, the sail filled with a soft crack and the boat leaned into the day.',
]

function paragraphs(chapters: Chapter[], chIndex: number, count: number): string {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const a = sentences[(i + chIndex) % sentences.length]!
    const b = sentences[(i + chIndex + 3) % sentences.length]!
    const c = sentences[(i + chIndex + 5) % sentences.length]!
    out.push(`<p>${i === 0 ? chapters[chIndex]!.lead + '. ' : ''}${a} ${b} ${c}</p>`)
  }
  return out.join('\n    ')
}

const xhtml = (title: string, body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head><meta charset="utf-8"/><title>${title}</title></head>
  <body>
${body}
  </body>
</html>
`

/** An EPUB as bytes (deterministic). No options gives `sample.epub`; `{ chapters: 36 }` gives the long fixture. */
export function buildEpub(options: EpubOptions = {}): Promise<Buffer> {
  const chapters = options.chapters !== undefined ? generatedChapters(options.chapters) : SAMPLE_CHAPTERS
  const perChapter = options.paragraphs ?? 8
  const title = options.title ?? 'The Velocity Sampler'
  const author = options.author ?? 'Ada Reader'
  const cover = options.cover ?? true

  const zip = new JSZip()
  const opts = { date: FIXED, createFolders: false }
  zip.file('mimetype', 'application/epub+zip', { ...opts, compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
    opts,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:5b1e2c7a-0000-4000-8000-76656c6f6369</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
${cover ? '    <meta name="cover" content="cover-image"/>\n' : ''}  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${cover ? '    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>\n' : ''}${chapters.map((c) => `    <item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${chapters.map((c) => `    <itemref idref="${c.id}"/>`).join('\n')}
  </spine>
</package>
`,
    opts,
  )
  zip.file(
    'OEBPS/nav.xhtml',
    xhtml(
      'Contents',
      `    <nav epub:type="toc" id="toc"><h1>Contents</h1>
      <ol>
${chapters.map((c) => `        <li><a href="${c.id}.xhtml">${c.title}</a></li>`).join('\n')}
      </ol>
    </nav>`,
    ),
    opts,
  )
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:5b1e2c7a-0000-4000-8000-76656c6f6369"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${chapters
  .map(
    (c, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${c.title}</text></navLabel><content src="${c.id}.xhtml"/></navPoint>`,
  )
  .join('\n')}
  </navMap>
</ncx>
`,
    opts,
  )
  if (cover) zip.file('OEBPS/cover.png', makePng(80, 120), opts)
  chapters.forEach((c, i) => {
    zip.file(`OEBPS/${c.id}.xhtml`, xhtml(c.title, `    <h1>${c.title}</h1>\n    ${paragraphs(chapters, i, perChapter)}`), opts)
  })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/epub+zip' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sample = await buildEpub()
  writeFileSync(join(here, 'sample.epub'), sample)
  console.log(`wrote ${join(here, 'sample.epub')} (${sample.length} bytes)`)
  const long = await buildEpub({ title: 'The Long Crossing', author: 'Ada Reader', chapters: 36, paragraphs: 10 })
  writeFileSync(join(here, 'long.epub'), long)
  console.log(`wrote ${join(here, 'long.epub')} (${long.length} bytes)`)
}
