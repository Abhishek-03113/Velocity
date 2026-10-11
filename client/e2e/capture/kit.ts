import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { api } from '../helpers'

/** Shared helpers for the landing-media capture (never imported by the app or the normal suite). */

const here = path.dirname(fileURLToPath(import.meta.url))
export const OUT = path.resolve(here, '../../../landing/media')
export const SCRATCH = process.env.CAPTURE_SCRATCH ?? path.join(os.tmpdir(), 'velocity-capture')
mkdirSync(OUT, { recursive: true })
mkdirSync(SCRATCH, { recursive: true })

export const sleep = (page: Page, ms: number) => page.waitForTimeout(ms)

// ───────────────────────────── seed data ─────────────────────────────

const note = (lines: string[]) => lines.join('\n') + '\n'

export const SEED = {
  launch: {
    title: 'Q4 Launch Plan',
    folder: 'Work',
    content: note([
      '# Q4 Launch Plan',
      '',
      'Ship the new workspace to everyone by **November 18**. Owner: Maya. Reviewers: Dev, Priya.',
      '',
      '## Milestones',
      '',
      '- [x] Freeze the tiling API',
      '- [x] Dogfood with the design team',
      '- [ ] Write the migration guide',
      '- [ ] Record the launch walkthrough',
      '- [ ] Flip the flag for 100% of users',
      '',
      '## Risks',
      '',
      '> Sliding mode is the part people will remember. It has to feel instant on a three-year-old laptop.',
      '',
      '```ts',
      'const rollout = { stage: "canary", percent: 10, rollbackOn: "p95 > 120ms" }',
      '```',
      '',
    ]),
  },
  review: {
    title: 'Design Review — Tiling',
    folder: 'Work',
    content: note([
      '# Design Review — Tiling',
      '',
      'Notes from Tuesday. The split tree stays pure; the view only reads positions.',
      '',
      '## Decisions',
      '',
      '1. Tiles are keyed by id so editors never remount.',
      '2. Focus follows the nearest edge, not the nearest centre.',
      '3. Zoom is a view state, never a layout change.',
      '',
      '## Follow-ups',
      '',
      '- [ ] Spring curve for swap animation',
      '- [ ] Column width presets: ⅓, ½, ⅔, full',
      '',
      '> “The best window manager is the one you forget is there.”',
      '',
    ]),
  },
  reading: {
    title: 'Reading List',
    folder: 'Personal',
    content: note([
      '# Reading List',
      '',
      '## In progress',
      '',
      '- **The Pragmatic Programmer**: chapter 6, on concurrency',
      '- *A Philosophy of Software Design*: deep modules',
      '',
      '## Next up',
      '',
      '- [ ] Designing Data-Intensive Applications',
      '- [ ] The Mythical Man-Month',
      '- [ ] Refactoring UI',
      '',
    ]),
  },
  standup: {
    title: 'Standup Notes',
    folder: 'Work',
    content: note([
      '# Standup Notes',
      '',
      '## Yesterday',
      '',
      '- Landed the sliding minimap',
      '- Reviewed the export worker PR',
      '',
      '## Today',
      '',
      '- [ ] Polish theme transitions',
      '- [ ] Pair with Priya on whiteboards',
      '',
      '## Blockers',
      '',
      'None. Search index hydrates in under 10 ms now.',
      '',
    ]),
  },
  ideas: {
    title: 'Ideas',
    folder: null as string | null,
    content: note([
      '# Ideas',
      '',
      '- A weekly review template that pulls open tasks from every note',
      '- Pin a note to a tile so it survives a layout reset',
      '- Quick capture from the menu bar',
      '- Share a read-only link to a single note',
      '',
      '> Small, sharp tools. Keep the editor out of the way.',
      '',
    ]),
  },
  sync: {
    title: 'Local-first Sync',
    folder: 'Research',
    content: note([
      '# Local-first Sync',
      '',
      'Why the UI never waits for the network.',
      '',
      '## Principles',
      '',
      '- The device is the source of truth while you work',
      '- Writes are debounced and retried with back-off',
      '- Search runs against a local index in under 10 ms',
      '',
      '```ts',
      'const delay = Math.min(800 * 2 ** attempt, 5000)',
      '```',
      '',
    ]),
  },
  trip: {
    title: 'Weekend in Lisbon',
    folder: 'Personal',
    content: note([
      '# Weekend in Lisbon',
      '',
      '- [x] Book the tram tour',
      '- [ ] Pastéis de Belém before 10',
      '- [ ] Sunset at Miradouro da Graça',
      '',
    ]),
  },
  roadmap: {
    title: 'Roadmap Sync',
    folder: 'Work',
    content: note([
      '# Roadmap Sync',
      '',
      'Themes for next quarter: **speed**, **focus**, **sharing**.',
      '',
      '- [ ] Decide on sharing scope',
      '- [ ] Draft the keyboard-first onboarding',
      '',
    ]),
  },
} as const

export type SeedKey = keyof typeof SEED
export type Seeded = Record<SeedKey, number> & { groups: Record<string, number> }

/** Wipe the throwaway DB and insert the product-y sample notes. Newest-created sorts first in the sidebar. */
export async function seed(order: SeedKey[] = ['trip', 'sync', 'reading', 'roadmap', 'ideas', 'standup', 'review', 'launch']): Promise<Seeded> {
  const existing = await api<Array<{ id: number }>>('GET', '/api/pastes')
  for (const n of existing) await api('DELETE', `/api/pastes/${n.id}`)
  const groups = await api<Array<{ id: number }>>('GET', '/api/groups')
  for (const g of groups) await api('DELETE', `/api/groups/${g.id}`)

  const ids: Record<string, number> = {}
  for (const name of ['Work', 'Personal', 'Research']) {
    ids[name] = (await api<{ id: number }>('POST', '/api/groups', { name })).id
  }
  const out: Record<string, number> = {}
  for (const key of order) {
    const n = SEED[key]
    const created = await api<{ id: number }>('POST', '/api/pastes', {
      title: n.title,
      content: n.content,
      group_id: n.folder ? ids[n.folder]! : null,
    })
    out[key] = created.id
    await new Promise((r) => setTimeout(r, 1100)) // distinct updated_at so ordering is stable
  }
  return { ...(out as Record<SeedKey, number>), groups: ids }
}

// ───────────────────────────── page setup ─────────────────────────────

export interface Prefs {
  theme?: 'light' | 'dark'
  themeFamily?: string
  accent?: string
  tileGaps?: boolean
  themeVariants?: Record<string, Record<string, string>>
}

/** On-screen keycap HUD + fake cursor, injected only into captured pages. */
const OVERLAY_SCRIPT = `
(() => {
  if (window.__captureOverlay) return
  window.__captureOverlay = true
  const mount = () => {
    const css = document.createElement('style')
    css.textContent = \`
      #__hud{position:fixed;left:50%;bottom:34px;transform:translate(-50%,12px) scale(.96);z-index:2147483647;pointer-events:none;
        display:flex;gap:7px;align-items:center;padding:10px 14px;border-radius:18px;opacity:0;
        background:rgba(29,32,33,.80);-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);
        box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 0 .5px rgba(254,128,25,.6) inset;
        transition:opacity .16s ease,transform .22s cubic-bezier(.2,.9,.3,1.2)}
      #__hud.on{opacity:1;transform:translate(-50%,0) scale(1)}
      #__hud kbd{font:600 17px/1 -apple-system,BlinkMacSystemFont,'Inter','SF Pro Text',system-ui,sans-serif;color:#ebdbb2;
        min-width:34px;height:34px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;
        background:linear-gradient(180deg,rgba(235,219,178,.20),rgba(235,219,178,.10));
        box-shadow:0 1px 0 rgba(0,0,0,.5),0 0 0 .5px rgba(254,128,25,.45) inset}
      #__hud kbd.w{padding:0 14px;font-size:14px}
      #__cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;opacity:0;transition:opacity .2s;
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));will-change:transform}
      .__ripple{position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
        border:2px solid rgba(254,128,25,.9);background:rgba(254,128,25,.18);animation:__rip .5s ease-out forwards}
      @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}
    \`
    document.head.appendChild(css)
    const hud = document.createElement('div'); hud.id = '__hud'; document.body.appendChild(hud)
    const cur = document.createElement('div'); cur.id = '__cursor'
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 7.2-6 1.6-2.4 6z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    document.body.appendChild(cur)
    let timer
    window.__hud = (keys, ms = 1000) => {
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

/** Pretend to be a Mac so shortcuts render as ⌘ ⌃ ⌥ and Mod means Meta. */
const MAC_SCRIPT = `
Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS', mobile: false, brands: [] }) })
`

export interface CtxOpts {
  prefs?: Prefs
  video?: boolean
  name?: string
  viewport?: { width: number; height: number }
  scale?: number
  mobile?: boolean
  hud?: boolean
  /** Sidebar state before first paint (default: both columns open). */
  chrome?: { sidebarOpen: boolean; foldersOpen: boolean }
}

export interface Session {
  ctx: BrowserContext
  page: Page
  t0: number
}

let own: Browser | undefined
/** The test runner's fixture browser strips recordVideo, so captures launch their own Chromium. */
export async function launch(): Promise<Browser> {
  own ??= await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: ['--hide-scrollbars', '--force-color-profile=srgb'],
  })
  return own
}

export async function openApp(opts: CtxOpts = {}): Promise<Session> {
  const browser = await launch()
  const viewport = opts.viewport ?? { width: 1440, height: 900 }
  const dir = path.join(SCRATCH, 'raw', opts.name ?? 'tmp')
  if (opts.video) rmSync(dir, { recursive: true, force: true })
  // Landing pages use Gruvbox (Hard contrast, theme-default orange accent) unless a clip overrides it.
  const prefs = {
    theme: 'dark',
    themeFamily: 'gruvbox',
    themeVariants: { gruvbox: { dark: 'hard', light: 'hard' } },
    accent: 'theme',
    ...(opts.prefs ?? {}),
  }
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: opts.scale ?? 1,
    isMobile: opts.mobile ?? false,
    hasTouch: opts.mobile ?? false,
    colorScheme: prefs.theme === 'dark' ? 'dark' : 'light',
    userAgent: opts.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
    recordVideo: opts.video ? { dir, size: viewport } : undefined,
  })
  await ctx.addInitScript(MAC_SCRIPT)
  await ctx.addInitScript(
    `try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded','1'); localStorage.setItem('velocity.prefs.v1', ${JSON.stringify(
      JSON.stringify(prefs),
    )}); ${opts.chrome ? `localStorage.setItem('velocity.chrome.v1', ${JSON.stringify(JSON.stringify(opts.chrome))});` : ''} } } catch (e) {}`,
  )
  if (opts.hud !== false) await ctx.addInitScript(OVERLAY_SCRIPT)
  const t0 = Date.now()
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.locator('[data-tile-id]').first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  return { ctx, page, t0 }
}

/** Open a note from the sidebar by title. */
export async function openNote(page: Page, title: string) {
  await page.locator('[data-note-row]').filter({ hasText: title }).first().click()
  await expect(page.locator('header').getByRole('button', { name: title }).first()).toBeVisible()
}

// ───────────────────────────── human input ─────────────────────────────

const GLYPH: Record<string, string> = {
  Meta: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Backslash: '\\',
  Minus: '−',
  Equal: '=',
  Enter: '↩',
  Comma: ',',
  Slash: '/',
  Escape: 'esc',
  Backspace: '⌫',
}

export function keyLabel(combo: string): string[] {
  return combo.split('+').map((p) => GLYPH[p] ?? p.replace(/^Key|^Digit/, ''))
}

/** Press a shortcut, flashing the keycap HUD first so the viewer sees what was pressed. */
export async function key(page: Page, combo: string, opts: { hud?: boolean; after?: number } = {}) {
  if (opts.hud !== false) {
    await page.evaluate((k) => (window as unknown as { __hud?: (k: string[]) => void }).__hud?.(k), keyLabel(combo))
    await page.waitForTimeout(260)
  }
  await page.keyboard.press(combo)
  await page.waitForTimeout(opts.after ?? 450)
}

export async function typeSlow(page: Page, text: string, delay = 45) {
  await page.keyboard.type(text, { delay })
}

/** Glide the mouse to the centre of a locator, then click it. */
export async function glideClick(page: Page, target: ReturnType<Page['locator']>, steps = 22) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
  await page.waitForTimeout(160)
  await page.mouse.down()
  await page.waitForTimeout(70)
  await page.mouse.up()
}

// ───────────────────────────── video / image encoding ─────────────────────────────

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

export interface ClipMarks {
  /** Seconds (from context creation) where the trimmed clip starts / ends. */
  start: number
  end: number
  /** Seconds into the trimmed clip to use for the poster. */
  poster?: number
  /** Fade colour (matches the app background) for the soft loop seam. */
  fade?: string
}

/** Close the context and encode raw video → mp4 + webm + poster in OUT. */
export async function finishClip(s: Session, name: string, marks: ClipMarks) {
  const video = s.page.video()!
  await s.ctx.close()
  const raw = await video.path()
  const ss = marks.start.toFixed(2)
  const dur = (marks.end - marks.start).toFixed(2)
  const fade = marks.fade ?? 'black'
  const vf = (extra = '') =>
    `fps=30,fade=t=in:st=0:d=0.3:color=${fade},fade=t=out:st=${(marks.end - marks.start - 0.4).toFixed(2)}:d=0.4:color=${fade}${extra}`
  const base = ['-ss', ss, '-t', dur, '-i', raw]
  ff([...base, '-vf', `${vf()},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-movflags', '+faststart', '-an', path.join(OUT, `${name}.mp4`)])
  ff([...base, '-vf', vf(), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-an', path.join(OUT, `${name}.webm`)])
  ff(['-ss', (marks.start + (marks.poster ?? 0.8)).toFixed(2), '-i', raw, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', path.join(OUT, `${name}-poster.webp`)])
}

/** Screenshot the page at the context's scale and encode to webp under the size budget. */
export async function still(page: Page, name: string, budgetKb = 560) {
  await page.waitForTimeout(500)
  const png = path.join(SCRATCH, `${name}.png`)
  await page.screenshot({ path: png })
  const dest = path.join(OUT, `${name}.webp`)
  for (const q of [88, 85, 80, 74, 68, 60]) {
    ff(['-i', png, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', dest])
    if (statSync(dest).size <= budgetKb * 1024) break
  }
}

export function listMedia(): string[] {
  return existsSync(OUT) ? readdirSync(OUT) : []
}
