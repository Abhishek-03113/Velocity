/**
 * Landing-page media capture: motion clips (mp4 + webm + poster) and stills (webp) written to
 * landing/media/. Runs on demand only (the normal suite ignores e2e/capture/).
 *
 *   One command (from the repo root):   cd client && npm run capture:landing
 *   One clip:                           cd client && npm run capture:landing -- -g "hero"
 *   Custom ports:                       E2E_API_PORT=3250 E2E_WEB_PORT=5250 npm run capture:landing
 *
 * Requires ffmpeg (libx264, libvpx-vp9, libwebp) on PATH. The keycap HUD and cursor are injected
 * by e2e/capture/kit.ts into the captured page only; the app itself is untouched.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, type Page } from '@playwright/test'
import {
  finishClip,
  glideClick,
  key,
  openApp,
  OUT,
  openNote,
  seed,
  sleep,
  still,
  typeSlow,
  type Session,
} from './kit'

test.describe.configure({ mode: 'serial' })

const secs = (s: Session) => (Date.now() - s.t0) / 1000
const BG_DARK = '#1d2021' // Gruvbox dark0_hard
const editor = (page: Page) => page.locator('section[data-tile-id][class*="tileFocused"] .cm-content')

test('clip: hero', async () => {
  await seed()
  const s = await openApp({ name: 'hero', video: true, chrome: { sidebarOpen: true, foldersOpen: false } })
  const { page } = s
  await openNote(page, 'Q4 Launch Plan')
  await page.mouse.move(900, 500)
  await sleep(page, 900)
  const start = secs(s)

  // Type a new task at the end of the milestones list.
  const line = editor(page).locator('.cm-line', { hasText: 'Flip the flag' })
  const box = (await line.boundingBox())!
  await page.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 24 })
  await page.mouse.click(box.x + box.width + 40, box.y + box.height / 2)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await typeSlow(page, 'Send the changelog to beta users', 42)
  await sleep(page, 600)

  // Command palette → split.
  await key(page, 'Meta+Shift+KeyP', { after: 500 })
  await typeSlow(page, 'split', 55)
  await sleep(page, 700)
  await page.keyboard.press('Enter')
  await sleep(page, 700)

  // Open another note in the new tile.
  await typeSlow(page, 'design', 55)
  await sleep(page, 500)
  await page.keyboard.press('Enter')
  await sleep(page, 900)

  // Move focus between tiles, zoom in and out.
  await key(page, 'Control+Alt+ArrowLeft', { after: 800 })
  await key(page, 'Control+Alt+ArrowRight', { after: 800 })
  await key(page, 'Control+Alt+Enter', { after: 1100 })
  await key(page, 'Control+Alt+Enter', { after: 700 })

  await finishClip(s, 'hero', { start, end: secs(s), poster: 0.5, fade: '#1c1c1e' })
})

/** Split via shortcut, then open a note in the fresh tile through its launcher. */
async function addTile(page: Page, combo: string, query: string) {
  await key(page, combo, { after: 450 })
  await typeSlow(page, query, 45)
  await sleep(page, 300)
  await page.keyboard.press('Enter')
  await sleep(page, 650)
}

/** Draw a small flow diagram: box -> arrow -> ellipse, with a label. */
async function drawBoard(page: Page, animate = true) {
  const canvas = page.locator('.excalidraw canvas.interactive')
  await canvas.waitFor({ state: 'visible', timeout: 25_000 })
  await sleep(page, 900)
  const b = (await canvas.boundingBox())!
  const at = (fx: number, fy: number) => [b.x + b.width * fx, b.y + b.height * fy] as const
  const steps = animate ? 22 : 4
  const drag = async (from: readonly [number, number], to: readonly [number, number]) => {
    await page.mouse.move(from[0], from[1], { steps })
    await sleep(page, animate ? 180 : 20)
    await page.mouse.down()
    await page.mouse.move(to[0], to[1], { steps })
    await page.mouse.up()
    await sleep(page, animate ? 420 : 40)
  }
  await page.mouse.click(...at(0.9, 0.9))
  await page.keyboard.press('r')
  await drag(at(0.14, 0.28), at(0.38, 0.46))
  await page.keyboard.press('o')
  await drag(at(0.62, 0.28), at(0.86, 0.46))
  await page.keyboard.press('a')
  await drag(at(0.4, 0.37), at(0.6, 0.37))
  await page.keyboard.press('d')
  await drag(at(0.4, 0.58), at(0.6, 0.78))
  await page.keyboard.press('Escape')
  await sleep(page, 300)
}

async function openBoard(page: Page) {
  await key(page, 'Meta+Shift+KeyD', { after: 600 })
}

test('clip: palette', async () => {
  await seed()
  const s = await openApp({ name: 'palette', video: true })
  const { page } = s
  await openNote(page, 'Q4 Launch Plan')
  await page.mouse.move(980, 520)
  await sleep(page, 900)
  const start = secs(s)
  await sleep(page, 600)
  await key(page, 'Meta+KeyP', { after: 600 })
  await typeSlow(page, 'tiling', 130)
  await sleep(page, 1500)
  await page.keyboard.press('ArrowDown')
  await sleep(page, 600)
  await page.keyboard.press('ArrowUp')
  await sleep(page, 600)
  await page.keyboard.press('Enter')
  await sleep(page, 1800)
  await finishClip(s, 'palette', { start, end: secs(s), poster: 2.4, fade: BG_DARK })
})

test('clip: tiling', async () => {
  await seed()
  const s = await openApp({ name: 'tiling', video: true, chrome: { sidebarOpen: false, foldersOpen: false } })
  const { page } = s
  await page.keyboard.press('Meta+KeyP')
  await typeSlow(page, 'Q4', 10)
  await page.keyboard.press('Enter')
  await sleep(page, 700)
  await page.mouse.move(720, 450)
  const start = secs(s)
  await sleep(page, 700)
  await addTile(page, 'Control+Alt+Backslash', 'design')
  await addTile(page, 'Control+Alt+Minus', 'standup')
  await sleep(page, 500)
  await key(page, 'Control+Alt+Shift+ArrowUp', { after: 800 })
  await key(page, 'Control+Alt+Shift+ArrowLeft', { after: 900 })
  await key(page, 'Control+Alt+KeyQ', { after: 900 })
  await sleep(page, 300)
  await finishClip(s, 'tiling', { start, end: secs(s), poster: 4.5, fade: BG_DARK })
})

test('clip: sliding', async () => {
  await seed()
  const s = await openApp({ name: 'sliding', video: true, chrome: { sidebarOpen: false, foldersOpen: false } })
  const { page } = s
  await page.keyboard.press('Meta+KeyP')
  await typeSlow(page, 'Q4', 10)
  await page.keyboard.press('Enter')
  await sleep(page, 700)
  await page.mouse.move(720, 450)
  const start = secs(s)
  await sleep(page, 300)
  await key(page, 'Control+Alt+KeyT', { after: 800 })
  await addTile(page, 'Control+Alt+Backslash', 'design')
  await addTile(page, 'Control+Alt+Backslash', 'standup')
  await key(page, 'Control+Alt+ArrowLeft', { after: 800 })
  await key(page, 'Control+Alt+ArrowLeft', { after: 800 })
  await key(page, 'Control+Alt+KeyC', { after: 900 })
  await key(page, 'Control+Alt+ArrowRight', { after: 800 })
  await key(page, 'Control+Alt+ArrowRight', { after: 800 })
  await finishClip(s, 'sliding', { start, end: secs(s), poster: 5, fade: BG_DARK })
})

test('clip: themes', async () => {
  await seed()
  const s = await openApp({ name: 'themes', video: true })
  const { page } = s
  await openNote(page, 'Design Review')
  await page.mouse.move(980, 520)
  await sleep(page, 800)
  const start = secs(s)
  await key(page, 'Meta+Comma', { after: 700 })
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  const themes = sheet.getByRole('radiogroup', { name: 'Theme' })
  for (const name of ['Catppuccin', 'Everforest', 'Nord', 'Apple', 'Gruvbox']) {
    await glideClick(page, themes.getByRole('radio', { name, exact: true }), 14)
    await sleep(page, 900)
  }
  await sleep(page, 700) // Contrast row visible with Hard selected
  await page.keyboard.press('Escape')
  await sleep(page, 500)
  await finishClip(s, 'themes', { start, end: secs(s), poster: 3, fade: BG_DARK })
})

test('clip: whiteboard', async () => {
  await seed()
  const s = await openApp({ name: 'whiteboard', video: true, chrome: { sidebarOpen: false, foldersOpen: false } })
  const { page } = s
  await page.keyboard.press('Meta+KeyP')
  await typeSlow(page, 'Q4', 10)
  await page.keyboard.press('Enter')
  await sleep(page, 700)
  // Warm the lazy Excalidraw chunk, then close the board so the clip never shows "Loading board…".
  await key(page, 'Meta+Shift+KeyD', { hud: false, after: 500 })
  await page.locator('.excalidraw canvas.interactive').waitFor({ state: 'visible', timeout: 25_000 })
  await sleep(page, 1200)
  await key(page, 'Meta+Shift+KeyD', { hud: false, after: 900 })
  await page.mouse.move(720, 450)
  const start = secs(s)
  await sleep(page, 400)
  await openBoard(page)
  await drawBoard(page)
  await sleep(page, 900)
  await finishClip(s, 'whiteboard', { start, end: secs(s), poster: 6, fade: BG_DARK })
})

test('clip: folders', async () => {
  const ids = await seed()
  void ids
  const s = await openApp({ name: 'folders', video: true })
  const { page } = s
  await openNote(page, 'Ideas')
  await page.mouse.move(980, 520)
  await sleep(page, 900)
  const start = secs(s)
  await sleep(page, 1200)
  await key(page, 'Control+Alt+KeyM', { after: 700 })
  await typeSlow(page, 'work', 140)
  await sleep(page, 1100)
  await page.keyboard.press('Enter')
  await sleep(page, 3200)
  await finishClip(s, 'folders', { start, end: secs(s), poster: 1.6, fade: BG_DARK })
})

test('clip: markdown', async () => {
  await seed()
  const s = await openApp({ name: 'markdown', video: true, chrome: { sidebarOpen: false, foldersOpen: false } })
  const { page } = s
  await key(page, 'Control+Alt+KeyN', { hud: false, after: 900 })
  await page.mouse.move(720, 450)
  const start = secs(s)
  await sleep(page, 500)
  // List and quote markers auto-continue on Enter, so only the first line of each carries the marker.
  const lines: Array<[string, number]> = [
    ['# Weekly Review', 1],
    ['A **short** summary of what shipped, with `inline code`.', 1],
    ['## Next steps', 0],
    ['- [ ] Ship sliding mode', 0],
    ['Write the changelog', 1],
    ['> Small, sharp tools.', 1],
  ]
  for (const [text, extraEnters] of lines) {
    await typeSlow(page, text, 32)
    await page.keyboard.press('Enter')
    for (let i = 0; i < extraEnters; i++) await page.keyboard.press('Enter')
    await sleep(page, 150)
  }
  await sleep(page, 700)
  await key(page, 'Meta+KeyE', { after: 2400 })
  await key(page, 'Meta+KeyE', { after: 1200 })
  await finishClip(s, 'markdown', { start, end: secs(s), poster: 9, fade: BG_DARK })
})

// ───────────────────────────── stills (2880x1800) ─────────────────────────────

const retina = { scale: 2 as const }

test('still: dark (two tiles)', async () => {
  await seed()
  const s = await openApp({ name: 'still-dark', hud: false, ...retina, chrome: { sidebarOpen: true, foldersOpen: false } })
  const { page } = s
  await openNote(page, 'Q4 Launch Plan')
  await key(page, 'Control+Alt+Backslash', { hud: false, after: 500 })
  await typeSlow(page, 'design', 5)
  await page.keyboard.press('Enter')
  await sleep(page, 900)
  await still(page, 'shot-dark')
  await s.ctx.close()
})

test('still: light', async () => {
  await seed()
  const s = await openApp({ name: 'still-light', hud: false, ...retina, prefs: { theme: 'light' } })
  const { page } = s
  await openNote(page, 'Q4 Launch Plan')
  await still(page, 'shot-light')
  await s.ctx.close()
})

test('still: themes', async () => {
  await seed()
  const s = await openApp({ name: 'still-themes', hud: false, ...retina })
  const { page } = s
  await openNote(page, 'Design Review')
  await key(page, 'Meta+Comma', { hud: false, after: 900 })
  await still(page, 'shot-themes')
  await s.ctx.close()
})

test('still: shortcuts', async () => {
  await seed()
  const s = await openApp({ name: 'still-shortcuts', hud: false, ...retina })
  const { page } = s
  await openNote(page, 'Q4 Launch Plan')
  await key(page, 'Meta+Slash', { hud: false, after: 900 })
  await still(page, 'shot-shortcuts')
  await s.ctx.close()
})

test('still: palette', async () => {
  await seed()
  const s = await openApp({ name: 'still-palette', hud: false, ...retina })
  const { page } = s
  await openNote(page, 'Q4 Launch Plan')
  await key(page, 'Meta+Shift+KeyP', { hud: false, after: 700 })
  await typeSlow(page, 'tile', 20)
  await sleep(page, 500)
  await still(page, 'shot-palette')
  await s.ctx.close()
})

test('still: sliding', async () => {
  await seed()
  const s = await openApp({ name: 'still-sliding', hud: false, ...retina, chrome: { sidebarOpen: false, foldersOpen: false } })
  const { page } = s
  await page.keyboard.press('Meta+KeyP')
  await typeSlow(page, 'Q4', 10)
  await page.keyboard.press('Enter')
  await sleep(page, 600)
  await key(page, 'Control+Alt+KeyT', { hud: false, after: 700 })
  await addTileQuiet(page, 'design')
  await addTileQuiet(page, 'standup')
  await addTileQuiet(page, 'reading')
  await key(page, 'Control+Alt+ArrowLeft', { hud: false, after: 900 })
  await still(page, 'shot-sliding')
  await s.ctx.close()
})

async function addTileQuiet(page: Page, query: string) {
  await key(page, 'Control+Alt+Backslash', { hud: false, after: 500 })
  await typeSlow(page, query, 5)
  await page.keyboard.press('Enter')
  await sleep(page, 800)
}

test('still: whiteboard', async () => {
  await seed()
  const s = await openApp({ name: 'still-board', hud: false, ...retina, chrome: { sidebarOpen: false, foldersOpen: false } })
  const { page } = s
  await page.keyboard.press('Meta+KeyP')
  await typeSlow(page, 'Q4', 10)
  await page.keyboard.press('Enter')
  await sleep(page, 600)
  await key(page, 'Meta+Shift+KeyD', { hud: false, after: 600 })
  await drawBoard(page, false)
  await still(page, 'shot-whiteboard')
  await s.ctx.close()
})

test('still: phone', async () => {
  await seed()
  const s = await openApp({ name: 'still-phone', hud: false, viewport: { width: 390, height: 844 }, scale: 3, mobile: true })
  const { page } = s
  await sleep(page, 800)
  await still(page, 'shot-phone')
  await s.ctx.close()
})

// ───────────────────────────── manifest ─────────────────────────────

const CAPTIONS: Record<string, string> = {
  hero: 'Type, open the command palette, split into a second tile, move focus with the keyboard, zoom and unzoom.',
  palette: 'Quick open finds notes by title and full text, with highlighted matches, and Enter opens the result.',
  tiling: 'Dwindle tiling: split right and down, swap notes between tiles, close a tile.',
  sliding: 'Sliding mode: scrolling columns follow focus, cycle column width, minimap along the bottom.',
  themes: 'Switch between Catppuccin, Everforest, Nord, Apple and Gruvbox themes from Settings.',
  whiteboard: 'Open a whiteboard beside the note and sketch a flow with shapes and arrows.',
  folders: 'Move a note into a folder from the keyboard; the sidebar counts update instantly.',
  markdown: 'Write Markdown, then flip to Read Mode for the rendered preview.',
  'shot-dark': 'Dark appearance with two notes tiled side by side.',
  'shot-light': 'Light appearance with the folder sidebar, note list and a note.',
  'shot-themes': 'Settings theme picker with Gruvbox contrast levels.',
  'shot-shortcuts': 'The keyboard shortcuts sheet.',
  'shot-palette': 'Command palette listing commands with their shortcuts.',
  'shot-sliding': 'Sliding tiling mode with column minimap.',
  'shot-whiteboard': 'Whiteboard tile with a hand-drawn diagram next to its note.',
  'shot-phone': 'Responsive layout on a phone (390x844 at 3x).',
}

test('manifest', async () => {
  const probe = (file: string, entries: string) =>
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'json', path.join(OUT, file)], {
      encoding: 'utf8',
    })
  const files: Array<Record<string, unknown>> = []
  for (const [name, caption] of Object.entries(CAPTIONS)) {
    if (name.startsWith('shot-')) {
      const file = `${name}.webp`
      const st = JSON.parse(probe(file, 'stream=width,height')).streams[0]
      files.push({ file, type: 'still', width: st.width, height: st.height, caption })
      continue
    }
    for (const ext of ['mp4', 'webm']) {
      const file = `${name}.${ext}`
      const st = JSON.parse(probe(file, 'stream=width,height:format=duration'))
      files.push({
        file,
        type: 'clip',
        width: st.streams[0].width,
        height: st.streams[0].height,
        duration: Math.round(Number(st.format.duration) * 10) / 10,
        poster: `${name}-poster.webp`,
        caption,
      })
    }
    const poster = `${name}-poster.webp`
    const ps = JSON.parse(probe(poster, 'stream=width,height')).streams[0]
    files.push({ file: poster, type: 'poster', width: ps.width, height: ps.height, caption: `Poster frame for ${name}.` })
  }
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ files }, null, 2) + '\n')
})
