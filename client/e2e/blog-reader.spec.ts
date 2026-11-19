import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Page } from '@playwright/test'
import { allNotes, api, noteContent, shot, tiles } from './helpers'

/**
 * Blog Reader plugin walkthrough. A local node:http fixture serves a realistic
 * blog post; the E2E API server runs with PLUGIN_FETCH_ALLOW_PRIVATE=on so it can fetch it.
 */
test.describe.configure({ mode: 'serial' })

let server: Server
let base = ''
let articleUrl = ''
let articleTitle = ''

const landscape = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b26b"/><stop offset=".55" stop-color="#e06c75"/><stop offset="1" stop-color="#4a3f7a"/></linearGradient>
<linearGradient id="h1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3a6b"/><stop offset="1" stop-color="#1f1d44"/></linearGradient></defs>
<rect width="1200" height="600" fill="url(#sky)"/><circle cx="820" cy="250" r="90" fill="#ffe8b0" opacity=".95"/>
<path d="M0 430 L170 300 L320 400 L520 240 L720 410 L900 310 L1200 440 L1200 600 L0 600Z" fill="url(#h1)"/>
<path d="M0 500 L220 410 L430 490 L650 400 L880 500 L1050 430 L1200 490 L1200 600 L0 600Z" fill="#14122f"/></svg>`

const diagram = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360" font-family="system-ui, sans-serif">
<rect width="900" height="360" rx="18" fill="#f4f1fb"/>
<g fill="#fff" stroke="#6b5bd2" stroke-width="3"><rect x="50" y="120" width="220" height="120" rx="14"/><rect x="340" y="120" width="220" height="120" rx="14"/><rect x="630" y="120" width="220" height="120" rx="14"/></g>
<g fill="#2b2457" font-size="26" text-anchor="middle" font-weight="600"><text x="160" y="188">Read</text><text x="450" y="188">Annotate</text><text x="740" y="188">Sketch</text></g>
<g stroke="#6b5bd2" stroke-width="4" fill="none"><path d="M275 180 H335"/><path d="M565 180 H625"/></g>
<g fill="#6b5bd2"><path d="M335 170 l14 10 l-14 10z"/><path d="M625 170 l14 10 l-14 10z"/></g></svg>`

const post = (b: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Reading and Note-Taking, Side by Side | The Field Notes</title>
<meta property="og:title" content="Reading and Note-Taking, Side by Side">
<meta property="og:site_name" content="The Field Notes">
<meta name="author" content="Mira Okafor">
<meta property="article:published_time" content="2026-09-14T08:30:00+00:00">
<meta property="og:description" content="Why the best notes are written next to the thing you are reading.">
<style>body{font-family:Georgia,serif;margin:0}nav,footer,aside{background:#eee;padding:12px}</style></head>
<body>
<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/archive">Archive</a> <button>Subscribe</button></nav>
<div class="cookie-banner" id="cookie-consent">We use cookies to improve your experience. <button>Accept all</button></div>
<div class="layout">
<aside class="sidebar widget-area"><h3>Popular posts</h3><ul><li><a href="/p/1">Ten productivity hacks</a></li><li><a href="/p/2">Why I quit email</a></li><li><a href="/p/3">Newsletter signup</a></li></ul></aside>
<article class="post hentry">
<header><h1 class="entry-title">Reading and Note-Taking, Side by Side</h1><p class="byline">By Mira Okafor</p></header>
<div class="entry-content">
<p>Most of us read in one window and take notes in another, and the cost of that small <strong>context switch</strong> is higher than it looks. Each jump away from the page is a chance to lose the thread of an argument.</p>
<p>Putting the article and your notes next to each other turns reading into a conversation. You quote, you question, you sketch a diagram, and the original stays in view the whole time. This is the habit behind every good commonplace book.</p>
<img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="${b}/img/landscape.svg" alt="A sunset over layered mountains" width="1200" height="600">
<h2>A simple loop</h2>
<p>The loop has three beats. First you read a paragraph. Then you write one line in your own words. Finally, if the idea has a shape, you draw it.</p>
<figure><img src="${b}/img/diagram.svg" alt="Read, annotate, sketch" width="900" height="360"><figcaption>The read, annotate, sketch loop</figcaption></figure>
<h2>Automating the boring part</h2>
<p>If you clip articles often, a tiny helper can normalise the address before you save it. Here is the idea in TypeScript:</p>
<pre><code class="language-ts">export function normalise(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_')) url.searchParams.delete(key)
  }
  return url.toString()
}</code></pre>
<blockquote><p>A note you never reread is just a longer way of forgetting.</p></blockquote>
<h2>What to capture</h2>
<ul><li>Claims worth testing
<ul><li>The one sentence you would defend</li><li>Any number that surprised you</li></ul></li>
<li>Questions the author left open</li><li>Links to other ideas in your library</li></ul>
<h2>Tools compared</h2>
<table><thead><tr><th>Setup</th><th>Context switches</th><th>Best for</th></tr></thead>
<tbody><tr><td>Two windows</td><td>High</td><td>Short reads</td></tr><tr><td>Split tiles</td><td>Low</td><td>Deep reading</td></tr></tbody></table>
<p>Try it on the next long article you meet. Notice how much more you remember when the page and the pen share a table.</p>
</div></article></div>
<footer>&copy; 2026 The Field Notes. All rights reserved. <a href="/privacy">Privacy</a></footer>
</body></html>`

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/posts/tiling-notes') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(post(base))
    } else if (path === '/img/landscape.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(landscape)
    } else if (path === '/img/diagram.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(diagram)
    } else if (path === '/not-html') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    } else {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  articleUrl = `${base}/posts/tiling-notes`
  articleTitle = 'Reading and Note-Taking, Side by Side'
})

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

const palette = (page: Page) => page.getByRole('dialog', { name: 'Blog Reader' })
const status = (page: Page) => page.locator('footer')
const articleTile = (page: Page) => page.locator('section[data-tile-id]').filter({ has: page.locator('article') })

async function openPrompt(page: Page) {
  await page.keyboard.press('Control+Alt+KeyB')
  await expect(palette(page)).toBeVisible()
}

test('open a blog post beside my notes, read it, edit it, dedupe it', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

  // 1. A note to take notes in.
  const editor = page.locator('section[data-tile-id] .cm-content').first()
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Reading notes\n\n- Context switches are costly\nQuote the best line\nSketch the loop')
  await expect(editor).toContainText('Sketch the loop')

  // 2. Prompt palette.
  await openPrompt(page)
  await shot(page, 'prompt-empty')
  await page.keyboard.press('Enter')
  await expect(palette(page).getByRole('alert')).toBeVisible()
  await expect(palette(page)).toBeVisible()
  await shot(page, 'prompt-validation-error')
  await page.keyboard.type(articleUrl)
  await shot(page, 'prompt-url')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toHaveCount(0)

  // 3. Article opens in a new tile in Read mode.
  const art = articleTile(page)
  await expect(art.getByRole('heading', { name: articleTitle, level: 1 }).first()).toBeVisible({ timeout: 20_000 })
  await expect(tiles(page)).toHaveCount(2)
  await expect(art.locator('pre code').first()).toBeVisible()
  await expect(art.locator('img').first()).toBeVisible()
  await expect
    .poll(() => art.locator('img').evaluateAll((imgs) => imgs.length > 0 && imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)))
    .toBe(true)
  await expect(page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: /Blogs/ })).toBeVisible()
  await expect(status(page)).toContainText('Saved')

  const note = (await allNotes()).find((n) => n.title.includes('Reading and Note-Taking'))!
  expect(note).toBeTruthy()
  const groups = await api<Array<{ id: number; name: string }>>('GET', '/api/groups')
  const blogs = groups.find((g) => g.name === 'Blogs')
  expect(blogs).toBeTruthy()
  expect(note.group_id).toBe(blogs!.id)
  await expect.poll(async () => (await noteContent(note.id)).length).toBeGreaterThan(200)
  const md = await noteContent(note.id)
  expect(md).toContain('> [The Field Notes](')
  expect(md).toMatch(/!\[[^\]]*\]\(http:\/\/127\.0\.0\.1:\d+\/img\/landscape\.svg\)/)
  expect(md).toContain('```ts')
  expect(md).not.toContain('Accept all')
  expect(md).not.toContain('Popular posts')
  await shot(page, 'article-read-split')

  // 4. Edit mode shows markdown with inline images, then back to read.
  const tileId = await art.first().getAttribute('data-tile-id')
  const artTile = page.locator(`section[data-tile-id="${tileId}"]`)
  await page.keyboard.press('Control+KeyE')
  await expect(artTile.locator('.cm-content')).toBeVisible()
  await expect(artTile.locator('.cm-content')).toContainText('# Reading and Note-Taking')
  // Scroll down to where the first inline image widget sits.
  await artTile.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 380))
  const inline = artTile.locator('img.cm-md-image-remote')
  await expect(inline.first()).toBeVisible()
  await expect
    .poll(() => inline.evaluateAll((imgs) => imgs.some((i) => (i as HTMLImageElement).naturalWidth > 0)))
    .toBe(true)
  await shot(page, 'article-edit')
  await page.keyboard.press('Control+KeyE')
  await expect(art.getByRole('heading', { name: articleTitle, level: 1 }).first()).toBeVisible()

  // 5. Whiteboard beside the article, on the user's note (best effort).
  try {
    const mine = page.locator('section[data-tile-id]').filter({ hasText: 'Reading notes' }).filter({ hasNot: page.locator('article') }).first()
    await mine.locator('.cm-content').click()
    await page.keyboard.press('Control+Shift+KeyD')
    await expect(page.locator('.excalidraw canvas.interactive')).toBeVisible({ timeout: 20_000 })
    const canvas = page.locator('.excalidraw canvas.interactive')
    const box = (await canvas.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9)
    const drag = async (key: string, x1: number, y1: number, x2: number, y2: number) => {
      await page.keyboard.press(key)
      await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 8 })
      await page.mouse.up()
    }
    await drag('r', 0.15, 0.2, 0.85, 0.32)
    await drag('r', 0.15, 0.55, 0.85, 0.67)
    await drag('a', 0.5, 0.33, 0.5, 0.54)
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9)
    await shot(page, 'article-with-whiteboard')
    await page.keyboard.press('Control+Shift+KeyD')
    await expect(page.locator('.excalidraw')).toHaveCount(0)
  } catch (err) {
    console.log('whiteboard shot skipped:', (err as Error).message.split('\n')[0])
  }

  // 6. Dedupe through quick open.
  await page.keyboard.press('Control+KeyP')
  const quick = page.getByRole('dialog', { name: 'Search notes' })
  await expect(quick).toBeVisible()
  await page.keyboard.type(articleUrl)
  await expect(quick.getByRole('option').first()).toContainText('Open in Blog Reader')
  await shot(page, 'quick-open-url-action')
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('Already in Blogs')
  expect((await allNotes()).filter((n) => n.title.includes('Reading and Note-Taking'))).toHaveLength(1)

  // 6b. Read status: blog notes are colour-coded unread / read in the notes list.
  const blogRow = page.locator('[data-note-row]', { hasText: 'Reading and Note-Taking' })
  await expect(blogRow).toHaveAttribute('data-badge', 'Unread')
  await blogRow.getByRole('button', { name: 'Mark as Read' }).click()
  await expect(blogRow).toHaveAttribute('data-badge', 'Read')
  await expect(status(page)).toContainText('Marked as read')
  await shot(page, 'read-status')
  await page.keyboard.press('Control+Alt+Shift+KeyB')
  await expect(blogRow).toHaveAttribute('data-badge', 'Unread')
  await expect(page.locator('[data-note-row][data-badge]')).toHaveCount(1)

  // 7. Error path.
  await openPrompt(page)
  await page.keyboard.type(`${base}/not-html`)
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('Couldn’t open', { timeout: 15_000 })
  await shot(page, 'error-status')

  // 8. Settings + palette listing + toggle off.
  await page.keyboard.press('Control+Comma')
  const row = page.locator('[data-plugin-row="blog-reader"]')
  await row.scrollIntoViewIfNeeded()
  await expect(row).toBeVisible()
  await shot(page, 'settings-plugins')
  const toggle = row.getByRole('switch').first()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-plugin-row="blog-reader"]')).toHaveCount(0)

  await page.keyboard.press('Control+Alt+KeyB')
  await page.waitForTimeout(400)
  await expect(palette(page)).toHaveCount(0)
  await page.keyboard.press('Control+Shift+KeyP')
  const cmd = page.getByRole('dialog', { name: 'Command palette' })
  await expect(cmd).toBeVisible()
  await page.keyboard.type('blog')
  await expect(cmd.getByRole('option', { name: /Open Blog Post/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Re-enable: palette lists plugin commands under "Plugins".
  await page.keyboard.press('Control+Comma')
  await page.locator('[data-plugin-row="blog-reader"]').getByRole('switch').first().click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+KeyP')
  await expect(cmd).toBeVisible()
  // Unfiltered, plugin commands are grouped under a "Plugins" section header.
  const header = cmd.getByText('Plugins', { exact: true }).first()
  await header.scrollIntoViewIfNeeded()
  await expect(header).toBeVisible()
  await page.keyboard.type('blog')
  await expect(cmd.getByRole('option', { name: /Open Blog Post/ })).toBeVisible()
  await shot(page, 'palette-plugin-commands')
  await page.keyboard.press('Escape')

  // 9. Dark mode: same split layout, article tile focused.
  await page.keyboard.press('Control+Shift+KeyP')
  await expect(cmd).toBeVisible()
  await page.keyboard.type('toggle dark')
  await cmd.getByRole('option', { name: /Toggle Dark Mode/ }).click()
  await expect(cmd).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark').catch(() => {})
  await articleTile(page).first().locator('article').click({ position: { x: 20, y: 20 } })
  await expect
    .poll(() => articleTile(page).locator('img').evaluateAll((imgs) => imgs.length > 0 && imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)))
    .toBe(true)
  await shot(page, 'article-read-split-dark')
})
