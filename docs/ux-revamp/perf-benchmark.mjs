// Input-to-next-frame typing benchmark used for RESULTS.md.
// Usage: start the API + two clients (old on :5300, new on :5173), create a note titled
// "Large note", then run: node docs/ux-revamp/perf-benchmark.mjs
import { chromium } from 'playwright'
async function measure(url, label) {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  await p.goto(url); await p.waitForTimeout(2500)
  // open the large note via its sidebar row
  await p.getByText('Large note', { exact: true }).first().click()
  await p.waitForTimeout(1500)
  await p.locator('.cm-content').first().click()
  await p.keyboard.press('Control+End')
  await p.evaluate(() => {
    window.__lat = []; window.__long = 0
    new PerformanceObserver((l) => { window.__long += l.getEntries().length }).observe({ type: 'longtask', buffered: false })
    window.addEventListener('keydown', () => {
      const t0 = performance.now()
      requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t0), 0))
    }, true)
  })
  for (let i = 0; i < 120; i++) { await p.keyboard.type('x'); await p.waitForTimeout(25) }
  await p.waitForTimeout(500)
  const { lat, long } = await p.evaluate(() => ({ lat: window.__lat, long: window.__long }))
  lat.sort((a, b) => a - b)
  const q = (f) => lat[Math.min(lat.length - 1, Math.floor(lat.length * f))].toFixed(1)
  console.log(`${label}: keystrokes=${lat.length} median=${q(0.5)}ms p95=${q(0.95)}ms max=${lat[lat.length-1].toFixed(1)}ms longTasks=${long}`)
  await b.close()
}
await measure('http://localhost:5300', 'before (main)')
await measure('http://localhost:5173', 'after (redesign)')
await measure('http://localhost:5300', 'before (main)')
await measure('http://localhost:5173', 'after (redesign)')
