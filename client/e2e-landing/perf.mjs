/**
 * Opt-in hero frame-time benchmark (not part of test:landing).
 *   npm run perf:landing                      # measures ../landing
 *   LANDING_DIR=/path/to/landing npm run perf:landing
 * Serves the folder statically, throttles the CPU 4x at 1440x900 and reports rAF frame
 * intervals while idling on the hero and while wheel-scrolling 0 -> 1200 px over ~2 s.
 */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(process.env.LANDING_DIR ?? path.join(here, '../../landing'))
const THROTTLE = Number(process.env.CPU_THROTTLE ?? 4)
const RUNS = Number(process.env.RUNS ?? 3)
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  try {
    let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if ((await stat(p).catch(() => null))?.isDirectory()) p = path.join(p, 'index.html')
    const buf = await readFile(p)
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

const SAMPLER = `window.__sample = (ms) => new Promise((done) => {
  const t = []; let last = 0; const t0 = performance.now();
  const f = (now) => { if (last) t.push(now - last); last = now;
    if (now - t0 < ms) requestAnimationFrame(f); else done(t) };
  requestAnimationFrame(f) })`

const stats = (t) => {
  const s = [...t].sort((a, b) => a - b)
  const avg = t.reduce((a, b) => a + b, 0) / t.length
  return {
    frames: t.length,
    fps: 1000 / avg,
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    max: s[s.length - 1],
    over33: (100 * t.filter((x) => x > 33.4).length) / t.length,
    over50: t.filter((x) => x > 50).length,
  }
}

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}
const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - (a[k] ?? 0)]))

async function once(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(url, { waitUntil: 'load' })
  await page.addScriptTag({ content: SAMPLER })
  if (process.env.PERF_CSS) await page.addStyleTag({ content: process.env.PERF_CSS }) // ablation experiments
  await page.waitForTimeout(3500) // entrance animations + video start
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
  await page.waitForTimeout(500)

  const m0 = await metrics(cdp)
  const idle = await page.evaluate(() => window.__sample(3000))
  const m1 = await metrics(cdp)

  await page.mouse.move(720, 450)
  const scrollP = page.evaluate(() => window.__sample(2300))
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 30)
    await page.waitForTimeout(50)
  }
  const scroll = await scrollP
  const m2 = await metrics(cdp)
  await ctx.close()
  return { idle: stats(idle), scroll: stats(scroll), idleM: diff(m0, m1), scrollM: diff(m1, m2) }
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const results = []
for (let i = 0; i < RUNS; i++) results.push(await once(browser))
await browser.close()
server.close()

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const pick = (phase, k) => median(results.map((r) => r[phase][k]))
const pickM = (phase, k) => median(results.map((r) => r[phase + 'M'][k] ?? 0))
console.log(`\nLanding hero perf (${ROOT}, 1440x900, CPU ${THROTTLE}x, median of ${RUNS})`)
console.log('| phase  | avg FPS | p95 ms | max ms | % >33ms | frames >50ms | layouts | style recalcs | script ms | task ms |')
console.log('|--------|---------|--------|--------|---------|--------------|---------|---------------|-----------|---------|')
for (const phase of ['idle', 'scroll']) {
  console.log(
    `| ${phase.padEnd(6)} | ${pick(phase, 'fps').toFixed(1)} | ${pick(phase, 'p95').toFixed(1)} | ${pick(phase, 'max').toFixed(1)} | ${pick(phase, 'over33').toFixed(1)} | ${pick(phase, 'over50')} | ${pickM(phase, 'LayoutCount')} | ${pickM(phase, 'RecalcStyleCount')} | ${(pickM(phase, 'ScriptDuration') * 1000).toFixed(0)} | ${(pickM(phase, 'TaskDuration') * 1000).toFixed(0)} |`,
  )
}
