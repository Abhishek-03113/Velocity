import './setup.ts'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const { createApp } = await import('../app.ts')
const { fetchPage, FetchPageError, isBlockedAddress } = await import('../plugins/shared/fetchPage.ts')
const app = createApp({ log: false })

const PAGE = '<!doctype html><html><head><title>Hello</title></head><body><p>héllo</p></body></html>'
let server: http.Server
let base = ''

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/post') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PAGE)
    } else if (url === '/redirect') {
      res.writeHead(302, { Location: '/post' })
      res.end()
    } else if (url === '/data.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    } else if (url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('x'.repeat(10_000))
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('nope')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.PLUGIN_FETCH_ALLOW_PRIVATE = 'on'
})

after(() => {
  delete process.env.PLUGIN_FETCH_ALLOW_PRIVATE
  server.close()
})

const get = async (path: string) => {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; error?: string } }
}
const fetchUrl = (u: string) => get(`/api/plugins/blog-reader/fetch?url=${encodeURIComponent(u)}`)

test('GET /api/plugins lists blog-reader', async () => {
  const r = await get('/api/plugins')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.data, [{ id: 'blog-reader', name: 'Blog Reader' }])
})

test('fetch returns html in the envelope', async () => {
  const r = await fetchUrl(`${base}/post`)
  assert.equal(r.status, 200)
  assert.equal(r.json.success, true)
  assert.equal(r.json.data.html, PAGE)
  assert.equal(r.json.data.finalUrl, `${base}/post`)
  assert.match(r.json.data.contentType, /text\/html/)
})

test('redirects are followed and reported as finalUrl', async () => {
  const r = await fetchUrl(`${base}/redirect`)
  assert.equal(r.status, 200)
  assert.equal(r.json.data.url, `${base}/redirect`)
  assert.equal(r.json.data.finalUrl, `${base}/post`)
})

test('non-html is rejected with 415', async () => {
  const r = await fetchUrl(`${base}/data.json`)
  assert.equal(r.status, 415)
  assert.equal(r.json.success, false)
})

test('oversize pages are rejected with 413', async () => {
  await assert.rejects(fetchPage(`${base}/big`, { maxBytes: 1000 }), (e: any) => {
    assert.ok(e instanceof FetchPageError)
    assert.equal(e.code, 'too_large')
    assert.equal(e.status, 413)
    return true
  })
})

test('upstream 404 becomes 502', async () => {
  const r = await fetchUrl(`${base}/missing`)
  assert.equal(r.status, 502)
  assert.match(r.json.error ?? '', /404/)
})

test('invalid and non-http urls are 400', async () => {
  assert.equal((await fetchUrl('not a url')).status, 400)
  assert.equal((await fetchUrl('ftp://example.com/file')).status, 400)
  assert.equal((await fetchUrl(`http://user:pw@127.0.0.1/`)).status, 400)
  assert.equal((await get('/api/plugins/blog-reader/fetch')).status, 400)
})

test('private hosts are blocked unless explicitly allowed', async () => {
  process.env.PLUGIN_FETCH_ALLOW_PRIVATE = ''
  try {
    for (const u of [`${base}/post`, 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.1/']) {
      const r = await fetchUrl(u)
      assert.equal(r.status, 403, u)
    }
  } finally {
    process.env.PLUGIN_FETCH_ALLOW_PRIVATE = 'on'
  }
  assert.equal((await fetchUrl(`${base}/post`)).status, 200)
})

test('address classification', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::', '::1', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1', '::ffff:7f00:1']) {
    assert.equal(isBlockedAddress(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedAddress(ip), false, ip)
  }
})
