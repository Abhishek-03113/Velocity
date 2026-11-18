import { TEST_ROOT } from './setup.ts'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const { createApp } = await import('../app.ts')
const app = createApp({ log: false })

const BOOKS_DIR = path.join(TEST_ROOT, 'books')

before(() => {
  process.env.BOOKS_MAX_BYTES = String(4096)
})

after(() => {
  delete process.env.BOOKS_MAX_BYTES
})

/** A PDF as far as the server is concerned: only the header is sniffed. */
function pdf(tag: string, pad = 0): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${tag}\n${'x'.repeat(pad)}\n%%EOF\n`)
}

/** A stored ZIP local header for `mimetype` followed by filler, enough for sniffing. */
function epub(tag: string): Buffer {
  const mime = Buffer.from('application/epub+zip')
  const name = Buffer.from('mimetype')
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0)
  h.writeUInt16LE(20, 4)
  h.writeUInt32LE(mime.length, 18)
  h.writeUInt32LE(mime.length, 22)
  h.writeUInt16LE(name.length, 26)
  return Buffer.concat([h, name, mime, Buffer.from(`PK-filler ${tag}`)])
}

const post = (body: Buffer | string, name?: string) =>
  app.request('/api/plugins/books', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/octet-stream', ...(name ? { 'X-File-Name': encodeURIComponent(name) } : {}) },
  })

const json = async (res: Response) => (await res.json()) as any

const tempFiles = () => (existsSync(BOOKS_DIR) ? readdirSync(BOOKS_DIR).filter((f) => f.startsWith('.upload-')) : [])

test('uploads an epub and a pdf', async () => {
  const r1 = await post(epub('one'), 'Café Stories.epub')
  assert.equal(r1.status, 201)
  const b1 = (await json(r1)).data
  assert.equal(b1.duplicate, false)
  assert.equal(b1.book.format, 'epub')
  assert.equal(b1.book.title, 'Café Stories')
  assert.equal(b1.book.file_name, 'Café Stories.epub')
  assert.equal(b1.book.status, 'unread')
  assert.equal(b1.book.progress, 0)
  assert.equal(b1.book.file_url, `/api/plugins/books/${b1.book.id}/file`)
  assert.ok(existsSync(path.join(BOOKS_DIR, `${b1.book.id}.epub`)))

  const r2 = await post(pdf('one'), '../evil/Paper.pdf')
  assert.equal(r2.status, 201)
  const b2 = (await json(r2)).data.book
  assert.equal(b2.format, 'pdf')
  assert.equal(b2.file_name, '.._evil_Paper.pdf')
  assert.equal(b2.byte_size, pdf('one').length)
  assert.equal(b2.sha256.length, 64)
  assert.equal(tempFiles().length, 0)
})

test('duplicate content returns the existing book', async () => {
  const first = (await json(await post(pdf('dup'), 'a.pdf'))).data.book
  const res = await post(pdf('dup'), 'b.pdf')
  assert.equal(res.status, 200)
  const data = (await json(res)).data
  assert.equal(data.duplicate, true)
  assert.equal(data.book.id, first.id)
  assert.equal(tempFiles().length, 0)
})

test('rejects junk (415), empty (400) and oversize (413) uploads without leaving temp files', async () => {
  const junk = await post(Buffer.from('hello, this is not a book'), 'x.pdf')
  assert.equal(junk.status, 415)
  assert.equal((await json(junk)).error, 'Only EPUB and PDF files are supported')

  const zip = await post(Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(100)]), 'x.epub')
  assert.equal(zip.status, 415)

  const empty = await post(Buffer.alloc(0), 'x.pdf')
  assert.equal(empty.status, 400)

  const big = await post(pdf('big', 5000), 'big.pdf')
  assert.equal(big.status, 413)
  assert.equal((await json(big)).error, 'Book exceeds 4 KB limit')
  assert.equal(tempFiles().length, 0)
})

test('rejects a declared Content-Length over the cap immediately', async () => {
  const res = await app.request('/api/plugins/books', {
    method: 'POST',
    body: pdf('declared'),
    headers: { 'Content-Length': '999999999' },
  })
  assert.equal(res.status, 413)
})

test('lists most recently opened first, then newest added', async () => {
  const a = (await json(await post(pdf('list-a'), 'A.pdf'))).data.book
  const b = (await json(await post(pdf('list-b'), 'B.pdf'))).data.book
  const c = (await json(await post(pdf('list-c'), 'C.pdf'))).data.book
  let list = (await json(await app.request('/api/plugins/books'))).data as { id: number }[]
  const ids = list.map((x) => x.id)
  assert.ok(ids.indexOf(c.id) < ids.indexOf(b.id) && ids.indexOf(b.id) < ids.indexOf(a.id))

  const res = await app.request(`/api/plugins/books/${a.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opened: true }),
  })
  assert.equal(res.status, 200)
  assert.ok((await json(res)).data.last_opened_at)
  list = (await json(await app.request('/api/plugins/books'))).data
  assert.equal(list[0].id, a.id)
})

test('PATCH updates fields and validates input', async () => {
  const book = (await json(await post(pdf('patch'), 'Patch.pdf'))).data.book
  const patch = (body: unknown, id: number | string = book.id) =>
    app.request(`/api/plugins/books/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const ok = await patch({
    title: '  New title ',
    author: 'Ann',
    cover_url: '/api/assets/12',
    position: 'page:4',
    progress: 0.4,
    status: 'reading',
    page_count: 120,
  })
  assert.equal(ok.status, 200)
  const d = (await json(ok)).data
  assert.deepEqual(
    [d.title, d.author, d.cover_url, d.position, d.progress, d.status, d.page_count],
    ['New title', 'Ann', '/api/assets/12', 'page:4', 0.4, 'reading', 120],
  )

  const cleared = (await json(await patch({ author: null, cover_url: null }))).data
  assert.equal(cleared.author, null)
  assert.equal(cleared.cover_url, null)
  assert.equal(cleared.title, 'New title')

  assert.equal((await patch({ cover_url: 'https://evil/x.png' })).status, 400)
  assert.equal((await patch({ progress: 1.5 })).status, 400)
  assert.equal((await patch({ status: 'done' })).status, 400)
  assert.equal((await patch({ title: '   ' })).status, 400)
  assert.equal((await patch({ opened: false })).status, 400)
  assert.equal((await patch({ sha256: 'x' })).status, 400)
  assert.equal((await patch({ title: 'x' }, 99999)).status, 404)
})

test('GET /:id/file serves bytes, ranges, 416 and 304', async () => {
  const bytes = pdf('file', 100)
  const book = (await json(await post(bytes, 'Ünï cödé.pdf'))).data.book
  const url = `/api/plugins/books/${book.id}/file`

  const full = await app.request(url)
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('content-type'), 'application/pdf')
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(full.headers.get('etag'), `"${book.sha256}"`)
  assert.equal(full.headers.get('cache-control'), 'private, max-age=31536000, immutable')
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(full.headers.get('content-length'), String(bytes.length))
  assert.equal(
    full.headers.get('content-disposition'),
    `inline; filename*=UTF-8''${encodeURIComponent('Ünï cödé.pdf')}`,
  )
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)

  const part = await app.request(url, { headers: { Range: 'bytes=0-9' } })
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-range'), `bytes 0-9/${bytes.length}`)
  assert.equal(part.headers.get('content-length'), '10')
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(0, 10))

  const open = await app.request(url, { headers: { Range: 'bytes=20-' } })
  assert.equal(open.status, 206)
  assert.deepEqual(Buffer.from(await open.arrayBuffer()), bytes.subarray(20))

  const suffix = await app.request(url, { headers: { Range: 'bytes=-5' } })
  assert.equal(suffix.status, 206)
  assert.equal(suffix.headers.get('content-range'), `bytes ${bytes.length - 5}-${bytes.length - 1}/${bytes.length}`)
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(bytes.length - 5))

  const past = await app.request(url, { headers: { Range: `bytes=${bytes.length}-` } })
  assert.equal(past.status, 416)
  assert.equal(past.headers.get('content-range'), `bytes */${bytes.length}`)
  const multi = await app.request(url, { headers: { Range: 'bytes=0-1,4-5' } })
  assert.equal(multi.status, 416)

  const cached = await app.request(url, { headers: { 'If-None-Match': `"${book.sha256}"` } })
  assert.equal(cached.status, 304)
  assert.equal((await cached.arrayBuffer()).byteLength, 0)
})

test('serves epub with its content type', async () => {
  const book = (await json(await post(epub('serve'), 'E.epub'))).data.book
  const res = await app.request(`/api/plugins/books/${book.id}/file`)
  assert.equal(res.headers.get('content-type'), 'application/epub+zip')
  await res.arrayBuffer()
})

test('DELETE removes the row and the file', async () => {
  const book = (await json(await post(pdf('delete'), 'D.pdf'))).data.book
  const file = path.join(BOOKS_DIR, `${book.id}.pdf`)
  assert.ok(existsSync(file))
  const res = await app.request(`/api/plugins/books/${book.id}`, { method: 'DELETE' })
  assert.equal(res.status, 200)
  assert.deepEqual((await json(res)).data, { id: book.id })
  assert.equal(existsSync(file), false)
  assert.equal((await app.request(`/api/plugins/books/${book.id}`)).status, 404)
  assert.equal((await app.request(`/api/plugins/books/${book.id}/file`)).status, 404)
  assert.equal((await app.request(`/api/plugins/books/${book.id}`, { method: 'DELETE' })).status, 404)
})
