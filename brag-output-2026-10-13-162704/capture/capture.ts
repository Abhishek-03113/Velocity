/**
 * Launch-video footage capture for /brag.
 *
 * Drives the real Velocity app (API + Vite dev server already running) with Playwright and records
 * each feature as a lossless-ish CDP screencast (JPEG q95 frames + timestamps), then assembles a
 * constant-30fps H.264 clip per feature into ../composition/assets/footage/.
 *
 *   cd client && E2E_API_PORT=3299 WEB=http://localhost:5299 npx tsx ../brag-output-2026-10-13-162704/capture/capture.ts [clip...]
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, type Browser, type BrowserContext, type CDPSession, type Page } from '../../client/node_modules/@playwright/test/index.mjs'
import { api } from '../../client/e2e/helpers'
import { keyLabel, seed, sleep, typeSlow } from '../../client/e2e/capture/kit'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '../composition/assets/footage')
const RAW = path.resolve(here, '.raw')
const WEB = process.env.WEB ?? 'http://localhost:5299'
const VIEW = { width: 1280, height: 800 }
const DPR = 2
mkdirSync(OUT, { recursive: true })

// ───────────────────────────── overlay (keycap HUD + cursor) ─────────────────────────────

const OVERLAY = `
(() => {
  if (window.__captureOverlay) return
  window.__captureOverlay = true
  const mount = () => {
    const css = document.createElement('style')
    css.textContent = \`
      #__hud{position:fixed;left:50%;bottom:44px;transform:translate(-50%,14px) scale(.94);z-index:2147483647;pointer-events:none;
        display:flex;gap:9px;align-items:center;padding:12px 16px;border-radius:20px;opacity:0;
        background:rgba(29,32,33,.86);-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);
        box-shadow:0 14px 50px rgba(0,0,0,.45),0 0 0 1px rgba(254,128,25,.65) inset;
        transition:opacity .16s ease,transform .24s cubic-bezier(.2,.9,.3,1.25)}
      #__hud.on{opacity:1;transform:translate(-50%,0) scale(1)}
      #__hud kbd{font:650 22px/1 -apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;color:#fbf1c7;
        min-width:44px;height:44px;padding:0 11px;display:inline-flex;align-items:center;justify-content:center;border-radius:11px;
        background:linear-gradient(180deg,rgba(235,219,178,.24),rgba(235,219,178,.10));
        box-shadow:0 2px 0 rgba(0,0,0,.55),0 0 0 1px rgba(254,128,25,.5) inset}
      #__hud kbd.w{padding:0 16px;font-size:17px}
      #__cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:26px;height:26px;opacity:0;transition:opacity .2s;
        filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));will-change:transform}
      .__ripple{position:fixed;z-index:2147483646;pointer-events:none;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;
        border:2px solid rgba(254,128,25,.95);background:rgba(254,128,25,.2);animation:__rip .5s ease-out forwards}
      @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    \`
    document.head.appendChild(css)
    const hud = document.createElement('div'); hud.id = '__hud'; document.body.appendChild(hud)
    const cur = document.createElement('div'); cur.id = '__cursor'
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="26" height="26"><path d="M3 2l14 7.2-6 1.6-2.4 6z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    document.body.appendChild(cur)
    let timer
    window.__hud = (keys, ms = 1100) => {
      hud.innerHTML = keys.map((k) => '<kbd class="' + (k.length > 1 ? 'w' : '') + '">' + k + '</kbd>').join('')
      hud.classList.add('on')
      clearTimeout(timer)
      timer = setTimeout(() => hud.classList.remove('on'), ms)
    }
    addEventListener('mousemove', (e) => {
      cur.style.opacity = '1'
      cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'
    }, true)
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__ripple'
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'
      document.body.appendChild(r); setTimeout(() => r.remove(), 600)
    }, true)
  }
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount)
})()
`

const MAC = `
Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS', mobile: false, brands: [] }) })
`

// ───────────────────────────── screencast recorder ─────────────────────────────

interface Rec {
  name: string
  ctx: BrowserContext
  page: Page
  cdp: CDPSession
  frames: Array<{ file: string; t: number }>
  dir: string
  marks: { start?: number; end?: number }
  events: Array<{ t: number; keys: string[]; label?: string }>
}

let browser: Browser
let current: Rec | undefined
/** Log a moment (key press, click) so the composition can sync motion graphics to the footage. */
const mark = (keys: string[], label?: string) => current?.events.push({ t: Date.now() / 1000, keys, label })
async function launch() {
  browser ??= await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-renderer-backgrounding'],
  })
  return browser
}

interface OpenOpts {
  prefs?: Record<string, unknown>
  chrome?: { sidebarOpen: boolean; foldersOpen: boolean }
}

async function open(name: string, opts: OpenOpts = {}): Promise<Rec> {
  const b = await launch()
  const prefs = {
    theme: 'dark',
    themeFamily: 'gruvbox',
    themeVariants: { gruvbox: { dark: 'hard', light: 'hard' } },
    accent: 'theme',
    ...(opts.prefs ?? {}),
  }
  const ctx = await b.newContext({ baseURL: WEB, viewport: VIEW, deviceScaleFactor: DPR, colorScheme: 'dark' })
  await ctx.addInitScript('window.__name = (f) => f')
  await ctx.addInitScript(MAC)
  await ctx.addInitScript(
    `try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded','1'); localStorage.setItem('velocity.prefs.v1', ${JSON.stringify(
      JSON.stringify(prefs),
    )}); ${opts.chrome ? `localStorage.setItem('velocity.chrome.v1', ${JSON.stringify(JSON.stringify(opts.chrome))});` : ''} } } catch (e) {}`,
  )
  await ctx.addInitScript(OVERLAY)
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.locator('[data-tile-id]').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  const dir = path.join(RAW, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const cdp = await ctx.newCDPSession(page)
  const rec: Rec = { name, ctx, page, cdp, frames: [], dir, marks: {}, events: [] }
  current = rec
  let n = 0
  cdp.on('Page.screencastFrame', (ev) => {
    const file = path.join(dir, `f${String(n++).padStart(5, '0')}.jpg`)
    writeFileSync(file, Buffer.from(ev.data, 'base64'))
    rec.frames.push({ file, t: ev.metadata.timestamp ?? Date.now() / 1000 })
    void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
  })
  return rec
}

const now = () => Date.now() / 1000

async function start(r: Rec) {
  await r.cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: VIEW.width * DPR,
    maxHeight: VIEW.height * DPR,
    everyNthFrame: 1,
  })
  // A tiny invisible repaint loop keeps the compositor producing frames during still moments.
  await r.page.evaluate(() => {
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:2147483647;pointer-events:none;opacity:.01;background:#000'
    document.body.appendChild(d)
    let i = 0
    const tick = () => {
      d.style.transform = `translateX(${(i++ % 2) * 0.01}px)`
      requestAnimationFrame(tick)
    }
    tick()
  })
  await sleep(r.page, 300)
  r.marks.start = now()
}

async function finish(r: Rec) {
  r.marks.end = now()
  await sleep(r.page, 200)
  await r.cdp.send('Page.stopScreencast').catch(() => {})
  await r.ctx.close()
  const { start: s = 0, end: e = Infinity } = r.marks
  // Frames carry compositor timestamps (seconds, same clock family as Date.now in practice).
  const frames = r.frames.filter((f) => f.t >= s - 0.05 && f.t <= e + 0.05)
  if (frames.length < 2) throw new Error(`${r.name}: no frames`)
  const lines: string[] = []
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? Math.max(1 / 120, frames[i + 1].t - frames[i].t) : 1 / 30
    lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(4)}`)
  }
  lines.push(`file '${frames[frames.length - 1].file}'`)
  const list = path.join(r.dir, 'list.txt')
  writeFileSync(list, lines.join('\n'))
  const out = path.join(OUT, `${r.name}.mp4`)
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=2240:1400:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-g', '30', '-movflags', '+faststart', '-an', out],
    { stdio: 'inherit' },
  )
  const span = frames[frames.length - 1].t - frames[0].t
  const t0 = frames[0].t
  const events = r.events.map((e) => ({ ...e, t: Number((e.t - t0).toFixed(3)) }))
  writeFileSync(path.join(OUT, `${r.name}.events.json`), JSON.stringify({ duration: Number(span.toFixed(3)), clockSkew: Number((r.marks.start! - t0).toFixed(3)), events }, null, 2))
  console.log(`✓ ${r.name}: ${frames.length} frames over ${span.toFixed(2)}s (${(frames.length / span).toFixed(1)} fps avg) → ${out}`)
}

// ───────────────────────────── input helpers ─────────────────────────────

async function key(page: Page, combo: string, after = 450, hud = false) {
  mark(keyLabel(combo))
  if (hud) {
    await page.evaluate((k) => (window as unknown as { __hud?: (k: string[]) => void }).__hud?.(k), keyLabel(combo))
    await page.waitForTimeout(280)
  }
  await page.keyboard.press(combo)
  await page.waitForTimeout(after)
}

async function glideClick(page: Page, target: ReturnType<Page['locator']>, steps = 22) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
  await page.waitForTimeout(160)
  await page.mouse.down()
  await page.waitForTimeout(70)
  await page.mouse.up()
}

const editor = (page: Page) => page.locator('section[data-tile-id][class*="tileFocused"] .cm-content')

async function openNote(page: Page, title: string) {
  await page.locator('[data-note-row]').filter({ hasText: title }).first().click()
  await expect(page.locator('header').getByRole('button', { name: title }).first()).toBeVisible()
}

async function quickOpen(page: Page, q: string) {
  await page.keyboard.press('Meta+KeyP')
  await typeSlow(page, q, 10)
  await sleep(page, 200)
  await page.keyboard.press('Enter')
  await sleep(page, 700)
}

async function addTile(page: Page, combo: string, query: string) {
  await key(page, combo, 450)
  await typeSlow(page, query, 45)
  await sleep(page, 300)
  await page.keyboard.press('Enter')
  await sleep(page, 650)
}

// ───────────────────────────── clips ─────────────────────────────

const clips: Record<string, () => Promise<void>> = {
  async editor() {
    await seed()
    const r = await open('editor', { chrome: { sidebarOpen: true, foldersOpen: true } })
    const { page } = r
    await openNote(page, 'Q4 Launch Plan')
    await page.mouse.move(900, 520)
    await sleep(page, 600)
    await start(r)
    await sleep(page, 350)
    const line = editor(page).locator('.cm-line', { hasText: 'Flip the flag' })
    const box = (await line.boundingBox())!
    const lx = box.x + 260
    const ly = box.y + box.height / 2
    await page.mouse.move(lx, ly, { steps: 18 })
    mark(['click'], 'click-line')
    await page.mouse.click(lx, ly)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    mark(['type'], 'type-start')
    await typeSlow(page, 'Send the **changelog** to beta users', 38)
    mark(['type'], 'type-end')
    await sleep(page, 350)
    const todo = editor(page).locator('.cm-line', { hasText: 'Write the migration guide' }).locator('.cm-md-task')
    const tb = (await todo.boundingBox())!
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 16 })
    await sleep(page, 120)
    mark(['click'], 'tick')
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await sleep(page, 600)
    await key(page, 'Meta+KeyE', 1700)
    await key(page, 'Meta+KeyE', 500)
    await finish(r)
  },

  async palette() {
    await seed()
    const r = await open('palette', { chrome: { sidebarOpen: true, foldersOpen: false } })
    const { page } = r
    await openNote(page, 'Q4 Launch Plan')
    await page.mouse.move(900, 520)
    await start(r)
    await sleep(page, 350)
    await key(page, 'Meta+KeyP', 350)
    mark(['type'], 'type-start')
    await typeSlow(page, 'search index', 70)
    mark(['type'], 'type-end')
    await sleep(page, 1100)
    mark(['↩'], 'enter')
    await page.keyboard.press('Enter')
    await sleep(page, 900)
    await finish(r)
  },

  async tiling() {
    await seed()
    const r = await open('tiling', { chrome: { sidebarOpen: false, foldersOpen: false } })
    const { page } = r
    await quickOpen(page, 'Q4')
    await page.mouse.move(640, 400)
    await start(r)
    await sleep(page, 350)
    await addTile(page, 'Control+Alt+Backslash', 'design')
    await addTile(page, 'Control+Alt+Minus', 'standup')
    await key(page, 'Control+Alt+Shift+ArrowLeft', 800)
    await key(page, 'Control+Alt+Enter', 1000)
    await key(page, 'Control+Alt+Enter', 600)
    await finish(r)
  },

  async sliding() {
    await seed()
    const r = await open('sliding', { chrome: { sidebarOpen: false, foldersOpen: false } })
    const { page } = r
    await quickOpen(page, 'Q4')
    await page.mouse.move(640, 400)
    await start(r)
    await sleep(page, 300)
    await key(page, 'Control+Alt+KeyT', 700)
    await addTile(page, 'Control+Alt+Backslash', 'design')
    await addTile(page, 'Control+Alt+Backslash', 'standup')
    await addTile(page, 'Control+Alt+Backslash', 'reading')
    await key(page, 'Control+Alt+ArrowLeft', 600)
    await key(page, 'Control+Alt+ArrowLeft', 600)
    await key(page, 'Control+Alt+KeyC', 800)
    await finish(r)
  },

  async whiteboard() {
    await seed()
    const r = await open('whiteboard', { chrome: { sidebarOpen: false, foldersOpen: false } })
    const { page } = r
    await quickOpen(page, 'Q4')
    // Warm Excalidraw's lazy chunk so the recorded open is instant.
    await page.keyboard.press('Meta+Shift+KeyD')
    await page.locator('.excalidraw canvas.interactive').waitFor({ state: 'visible', timeout: 30_000 })
    await sleep(page, 1200)
    await page.keyboard.press('Meta+Shift+KeyD')
    await sleep(page, 900)
    await page.mouse.move(640, 400)
    await start(r)
    await sleep(page, 300)
    await key(page, 'Meta+Shift+KeyD', 600)
    const canvas = page.locator('.excalidraw canvas.interactive')
    await canvas.waitFor({ state: 'visible', timeout: 25_000 })
    await sleep(page, 350)
    const b = (await canvas.boundingBox())!
    const at = (fx: number, fy: number) => [b.x + b.width * fx, b.y + b.height * fy] as const
    const drag = async (from: readonly [number, number], to: readonly [number, number]) => {
      await page.mouse.move(from[0], from[1], { steps: 12 })
      await sleep(page, 90)
      await page.mouse.down()
      await page.mouse.move(to[0], to[1], { steps: 16 })
      await page.mouse.up()
      await sleep(page, 220)
    }
    await page.mouse.click(...at(0.9, 0.92))
    await page.keyboard.press('r')
    mark(['draw'], 'rect')
    await drag(at(0.12, 0.26), at(0.38, 0.44))
    await page.keyboard.press('o')
    mark(['draw'], 'ellipse')
    await drag(at(0.62, 0.26), at(0.88, 0.44))
    await page.keyboard.press('a')
    mark(['draw'], 'arrow')
    await drag(at(0.4, 0.35), at(0.6, 0.35))
    await page.keyboard.press('d')
    mark(['draw'], 'pen')
    await drag(at(0.38, 0.6), at(0.62, 0.78))
    await page.keyboard.press('Escape')
    await sleep(page, 700)
    await finish(r)
  },

  async blog() {
    await seed()
    await api('POST', '/api/pastes', {
      title: 'Reading notes',
      content: '# Reading notes\n\n- Context switches are costly\n- Quote the best line\n- Sketch the loop\n',
      group_id: null,
    })
    const r = await open('blog', { chrome: { sidebarOpen: true, foldersOpen: false } })
    const { page } = r
    await openNote(page, 'Reading notes')
    await page.mouse.move(900, 520)
    await start(r)
    await sleep(page, 350)
    await key(page, 'Control+Alt+KeyB', 400)
    await expect(page.getByRole('dialog', { name: 'Blog Reader' })).toBeVisible()
    mark(['type'], 'url-start')
    await typeSlow(page, 'http://fieldnotes.blog/posts/side-by-side', 26)
    mark(['type'], 'url-end')
    await sleep(page, 350)
    mark(['↩'], 'enter')
    await page.keyboard.press('Enter')
    const art = page.locator('section[data-tile-id]').filter({ has: page.locator('article') })
    await expect(art.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })
    mark(['article'], 'article')
    await sleep(page, 1300)
    const scroller = art.locator('article').first()
    await scroller.hover()
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 70)
      await sleep(page, 60)
    }
    await sleep(page, 600)
    const row = page.locator('[data-note-row]', { hasText: 'Reading and Note-Taking' })
    await row.hover()
    await sleep(page, 250)
    const btn = row.getByRole('button', { name: 'Mark as Read' })
    const bb = (await btn.boundingBox())!
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 16 })
    await sleep(page, 140)
    mark(['click'], 'mark-read')
    await page.mouse.down()
    await sleep(page, 60)
    await page.mouse.up()
    await sleep(page, 1300)
    await finish(r)
  },

  async themes() {
    await seed()
    const r = await open('themes', { chrome: { sidebarOpen: true, foldersOpen: true } })
    const { page } = r
    await openNote(page, 'Q4 Launch Plan')
    await page.mouse.move(1270, 790)
    await sleep(page, 400)
    await start(r)
    await sleep(page, 500)
    const seq: Array<[string, string, string | null]> = [
      ['catppuccin', 'dark', 'mocha'],
      ['everforest', 'light', 'medium'],
      ['nord', 'dark', null],
      ['solarized', 'light', null],
      ['apple', 'dark', null],
      ['gruvbox', 'dark', 'hard'],
    ]
    for (const [f, t, v] of seq) {
      mark(['theme'], f)
      await page.evaluate(
        ([f, t, v]) => {
          const el = document.documentElement
          el.dataset.themeFamily = f!
          el.dataset.theme = t!
          if (v) el.dataset.themeVariant = v
          else delete el.dataset.themeVariant
        },
        [f, t, v],
      )
      await page.waitForTimeout(546)
    }
    await sleep(page, 500)
    await finish(r)
  },

  async folders() {
    await seed()
    const r = await open('folders', { chrome: { sidebarOpen: true, foldersOpen: true } })
    const { page } = r
    await openNote(page, 'Ideas')
    await page.mouse.move(900, 520)
    await start(r)
    await sleep(page, 400)
    await key(page, 'Control+Alt+KeyM', 500)
    mark(['type'], 'type-start')
    await typeSlow(page, 'work', 110)
    await sleep(page, 600)
    mark(['↩'], 'enter')
    await page.keyboard.press('Enter')
    await sleep(page, 1600)
    await finish(r)
  },

  async stills() {
    await seed()
    const r = await open('stills', { chrome: { sidebarOpen: true, foldersOpen: true } })
    const { page } = r
    await openNote(page, 'Q4 Launch Plan')
    await page.keyboard.press('Meta+Slash')
    await sleep(page, 900)
    await page.evaluate("document.getElementById('__cursor') && (document.getElementById('__cursor').style.display = 'none')")
    await page.screenshot({ path: path.join(OUT, 'shortcuts.png') })
    await page.keyboard.press('Escape')
    await sleep(page, 400)
    await page.screenshot({ path: path.join(OUT, 'app.png') })
    await r.ctx.close()
    console.log('✓ stills')
  },
}

// ───────────────────────────── blog fixture on fieldnotes.blog:80 ─────────────────────────────

function startBlog() {
  const base = 'http://fieldnotes.blog'
  const landscape = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="560" viewBox="0 0 1200 560">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fabd2f"/><stop offset=".55" stop-color="#fe8019"/><stop offset="1" stop-color="#9d0006"/></linearGradient></defs>
<rect width="1200" height="560" fill="url(#sky)"/><circle cx="820" cy="230" r="88" fill="#fbf1c7" opacity=".95"/>
<path d="M0 400 L170 280 L320 370 L520 220 L720 380 L900 290 L1200 410 L1200 560 L0 560Z" fill="#3c3836"/>
<path d="M0 470 L220 390 L430 460 L650 380 L880 470 L1050 410 L1200 460 L1200 560 L0 560Z" fill="#1d2021"/></svg>`
  const post = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Reading and Note-Taking, Side by Side | The Field Notes</title>
<meta property="og:title" content="Reading and Note-Taking, Side by Side"><meta property="og:site_name" content="The Field Notes">
<meta name="author" content="Mira Okafor"><meta property="article:published_time" content="2026-09-14T08:30:00+00:00">
<meta property="og:description" content="Why the best notes are written next to the thing you are reading."></head>
<body><nav><a href="/">Home</a> <a href="/archive">Archive</a> <button>Subscribe</button></nav>
<div class="cookie-banner">We use cookies. <button>Accept all</button></div>
<article class="post"><header><h1>Reading and Note-Taking, Side by Side</h1><p class="byline">By Mira Okafor</p></header>
<div class="entry-content">
<p>Most of us read in one window and take notes in another, and the cost of that small <strong>context switch</strong> is higher than it looks. Each jump away from the page is a chance to lose the thread.</p>
<p>Putting the article and your notes next to each other turns reading into a conversation. You quote, you question, you sketch, and the original stays in view the whole time.</p>
<img src="${base}/img/landscape.svg" alt="Sunset over layered mountains" width="1200" height="560">
<h2>A simple loop</h2>
<p>Read a paragraph. Write one line in your own words. If the idea has a shape, draw it.</p>
<pre><code class="language-ts">export function normalise(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  return url.toString()
}</code></pre>
<blockquote><p>A note you never reread is just a longer way of forgetting.</p></blockquote>
</div></article><footer>&copy; 2026 The Field Notes</footer></body></html>`
  const srv = createServer((req, res) => {
    const p = (req.url ?? '/').split('?')[0]
    if (p.startsWith('/posts/')) res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(post)
    else if (p === '/img/landscape.svg') res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(landscape)
    else res.writeHead(404).end('nope')
  })
  srv.listen(80, '0.0.0.0')
  return srv
}

// ───────────────────────────── main ─────────────────────────────

const want = process.argv.slice(2)
const blog = startBlog()
try {
  for (const [name, fn] of Object.entries(clips)) {
    if (want.length && !want.includes(name)) continue
    console.log(`→ ${name}`)
    await fn()
  }
} finally {
  blog.close()
  await browser?.close()
}
