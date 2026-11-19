// Generates sample.pdf by hand (no dependencies): 12 pages, Helvetica text, document info and a 3-entry outline.
// Usage: `bun run fixtures:books` (from client/), or `bun e2e/fixtures/books/make-pdf.ts`; output lands beside this script.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PAGES = 12
const OUTLINE: ReadonlyArray<readonly [string, number]> = [
  ['Part I: Basics', 1],
  ['Part II: Practice', 5],
  ['Part III: Mastery', 9],
]
const BODY = [
  'Velocity keeps your notes and your books side by side.',
  'This line is selectable text, used by the reader tests.',
  'Scroll, zoom and jump between pages to try the engine.',
]

// Object numbers.
const CATALOG = 1
const PAGES_ROOT = 2
const FONT = 3
const INFO = 4
const OUTLINES = 5
const OUTLINE_FIRST = 6
const PAGE_FIRST = OUTLINE_FIRST + OUTLINE.length
const pageObj = (i: number): number => PAGE_FIRST + i * 2
const contentObj = (i: number): number => PAGE_FIRST + i * 2 + 1
const total = PAGE_FIRST + PAGES * 2

const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`)

/** The sample PDF as bytes (deterministic). */
export function buildPdf(): Buffer {
  const objects = new Map<number, string>()
  objects.set(CATALOG, `<< /Type /Catalog /Pages ${PAGES_ROOT} 0 R /Outlines ${OUTLINES} 0 R /PageMode /UseOutlines >>`)
  objects.set(
    PAGES_ROOT,
    `<< /Type /Pages /Count ${PAGES} /Kids [${Array.from({ length: PAGES }, (_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`,
  )
  objects.set(FONT, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objects.set(INFO, `<< /Title (${esc('Velocity PDF Handbook')}) /Author (${esc('Lin Pages')}) /Producer (make-pdf.ts) >>`)
  objects.set(
    OUTLINES,
    `<< /Type /Outlines /First ${OUTLINE_FIRST} 0 R /Last ${OUTLINE_FIRST + OUTLINE.length - 1} 0 R /Count ${OUTLINE.length} >>`,
  )
  OUTLINE.forEach(([title, page], i) => {
    const n = OUTLINE_FIRST + i
    const prev = i > 0 ? ` /Prev ${n - 1} 0 R` : ''
    const next = i < OUTLINE.length - 1 ? ` /Next ${n + 1} 0 R` : ''
    objects.set(n, `<< /Title (${esc(title)}) /Parent ${OUTLINES} 0 R${prev}${next} /Dest [${pageObj(page - 1)} 0 R /Fit] >>`)
  })
  for (let i = 0; i < PAGES; i++) {
    objects.set(
      pageObj(i),
      `<< /Type /Page /Parent ${PAGES_ROOT} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentObj(i)} 0 R >>`,
    )
    const lines = [
      'BT /F1 48 Tf 72 680 Td',
      `(Page ${i + 1}) Tj`,
      'ET',
      'BT /F1 16 Tf 72 620 Td 26 TL',
      ...BODY.map((l, k) => `${k === 0 ? '' : 'T* '}(${esc(l)}) Tj`),
      'ET',
    ]
    const stream = lines.join('\n')
    objects.set(contentObj(i), `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  for (let n = 1; n < total; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objects.get(n)!}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let n = 1; n < total; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${total} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = join(dirname(fileURLToPath(import.meta.url)), 'sample.pdf')
  const data = buildPdf()
  writeFileSync(target, data)
  console.log(`wrote ${target} (${data.length} bytes, ${PAGES} pages)`)
}
