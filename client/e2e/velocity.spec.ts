import { expect, test, type Page } from '@playwright/test'
import {
  allNotes,
  api,
  editorIn,
  focusedTile,
  noteContent,
  noteRows,
  shot,
  tiles,
  waitForSaved,
} from './helpers'

/**
 * Full product walkthrough. Tests run serially against one throwaway database,
 * each in a fresh browser context, and save review screenshots as they go.
 */
test.describe.configure({ mode: 'serial' })

const ids: Record<string, number> = {}

async function open(page: Page) {
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

async function openNoteByTitle(page: Page, title: string) {
  await noteRows(page).filter({ hasText: title }).first().click()
  await expect(page.locator('header').getByRole('button', { name: title }).first()).toBeVisible()
}

test('first run creates a welcome note that teaches the basics', async ({ page }) => {
  await open(page)
  await expect(noteRows(page)).toHaveCount(1)
  await expect(noteRows(page).first()).toContainText('Welcome to Velocity')
  await expect(editorIn(page)).toContainText('Work side by side')
  await waitForSaved(page)
  const notes = await allNotes()
  expect(notes).toHaveLength(1)
  expect(await noteContent(notes[0]!.id)).toContain('# Welcome to Velocity')
  await shot(page, 'welcome-light')
})

test('seed a realistic library', async () => {
  const work = await api<{ id: number }>('POST', '/api/groups', { name: 'Work' })
  const personal = await api<{ id: number }>('POST', '/api/groups', { name: 'Personal' })
  await api('POST', '/api/groups', { name: 'Ideas' })
  const seed: Array<[string, string, number | null]> = [
    ['Q4 Product Roadmap', '# Q4 Product Roadmap\n\nOur focus this quarter is **reliability** and *delight*.\n\n## Goals\n- [x] Ship tiling workspace\n- [ ] Launch iOS companion\n- [ ] Improve sync latency to < 50ms\n\n> Great products are built by saying no to a thousand things.\n\n```ts\nexport const target = { latencyMs: 50 }\n```\n', work.id],
    ['Design review', '# Design review\n\nAttendees: Ana, Raj, Mei\n\n1. Sidebar translucency approved\n2. Accent colour picker in Settings\n3. Keyboard-first navigation\n\n- [ ] Raj: finalise icon set\n- [x] Mei: dark mode audit\n', work.id],
    ['Grocery list', '# Groceries\n\n- [ ] Oat milk\n- [ ] Avocados\n- [x] Coffee beans\n- [ ] Sourdough\n', personal.id],
    ['Travel — Kyoto', '# Kyoto, April\n\n## Day 1\nFushimi Inari at sunrise, then Nishiki market.\n\n## Day 2\nArashiyama bamboo grove and a tea ceremony.\n', personal.id],
    ['Untitled', 'Reading list\n\n- *The Design of Everyday Things*\n- *Thinking, Fast and Slow*\n', null],
  ]
  for (const [title, content, group_id] of seed) {
    const note = await api<{ id: number }>('POST', '/api/pastes', { title, content, group_id })
    ids[title] = note.id
  }
  expect(await allNotes()).toHaveLength(6)
})

test('library shows folders, previews and derived titles', async ({ page }) => {
  await open(page)
  await expect(noteRows(page)).toHaveCount(6)
  // Untitled notes take their title from the first line, like Apple Notes.
  await expect(noteRows(page).filter({ hasText: 'Reading list' })).toHaveCount(1)
  await expect(noteRows(page).filter({ hasText: 'Kyoto' })).toContainText('Fushimi Inari')
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: /Work/ }).click()
  await expect(noteRows(page)).toHaveCount(2)
  await openNoteByTitle(page, 'Q4 Product Roadmap')
  await shot(page, 'library-folder-filter')
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: /All Notes/ }).click()
  await expect(noteRows(page)).toHaveCount(6)
  await shot(page, 'library-light')
})

test('new note via Ctrl+Alt+N autosaves and gets a title from its first line', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+Alt+KeyN')
  await expect(editorIn(page)).toBeFocused()
  await page.keyboard.type('# Launch checklist\nShip it on Friday.')
  await expect(page.locator('header').getByRole('button', { name: 'Launch checklist' })).toBeVisible()
  await waitForSaved(page)
  const created = (await allNotes()).find((n) => n.title === 'Untitled' && n.id > ids['Untitled']!)
  expect(created).toBeTruthy()
  expect(await noteContent(created!.id)).toBe('# Launch checklist\nShip it on Friday.')
  ids.launch = created!.id
  await shot(page, 'new-note-autosaved')
})

test('closing a tab right after typing still saves (flush, not cancel)', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Grocery list')
  await editorIn(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n- [ ] Lemons')
  // Close immediately — well inside the 800ms debounce.
  await page.keyboard.press('Control+Alt+KeyW')
  await expect.poll(() => noteContent(ids['Grocery list']!), { timeout: 5000 }).toContain('Lemons')
})

test('F2 renames the focused note', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Launch checklist')
  await page.keyboard.press('F2')
  const field = page.getByRole('textbox', { name: 'Note title' })
  await expect(field).toBeFocused()
  await field.fill('Launch plan')
  await shot(page, 'rename-inline')
  await field.press('Enter')
  await expect(page.locator('header').getByRole('button', { name: 'Launch plan' })).toBeVisible()
  await expect.poll(async () => (await allNotes()).find((n) => n.id === ids.launch)?.title).toBe('Launch plan')
})

test('drag a note onto a folder files it', async ({ page }) => {
  await open(page)
  const row = noteRows(page).filter({ hasText: 'Launch plan' })
  const folder = page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: /Ideas/ })
  await row.dragTo(folder)
  await expect
    .poll(async () => (await allNotes()).find((n) => n.id === ids.launch)?.group_id)
    .not.toBeNull()
  await folder.click()
  await expect(noteRows(page)).toHaveCount(1)
  await expect(noteRows(page).first()).toContainText('Launch plan')
})

test('command palette: full-text search, highlighting, commands', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+KeyP')
  const palette = page.getByRole('dialog', { name: 'Search notes' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('bamboo')
  await expect(palette.getByRole('option').first()).toContainText('Kyoto')
  await expect(palette.locator('mark').first()).toHaveText('bamboo')
  await shot(page, 'palette-search')
  await page.keyboard.press('Enter')
  await expect(page.locator('header').getByRole('button', { name: 'Travel — Kyoto' })).toBeVisible()

  await page.keyboard.press('Control+Shift+KeyP')
  await page.keyboard.type('dark')
  await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('option').first()).toContainText('Toggle Dark Mode')
  await shot(page, 'palette-commands')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await shot(page, 'dark-mode')
})

test('tiling: split, launcher, directional focus, swap, zoom, rotate, close', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Q4 Product Roadmap')
  await expect(tiles(page)).toHaveCount(1)

  // Split → empty tile launcher, focused, with search
  await page.keyboard.press('Control+Backslash')
  await expect(tiles(page)).toHaveCount(2)
  const launcher = page.getByRole('textbox', { name: 'Search notes to open in this tile' })
  await expect(launcher).toBeFocused()
  await shot(page, 'tiling-launcher')
  await launcher.fill('Kyoto')
  await page.keyboard.press('Enter')
  await expect(focusedTile(page)).toContainText('Kyoto, April')

  // Auto-tiling: the next split of the right tile goes down (dwindle)
  await page.keyboard.press('Control+Alt+Shift+KeyN')
  await expect(tiles(page)).toHaveCount(3)
  await page.keyboard.type('Scratchpad for the offsite')
  const boxes = await tiles(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }
    }),
  )
  // Left tile spans full height; the two on the right share an x and stack.
  const xs = new Set(boxes.map((b) => b.x))
  expect(xs.size).toBe(2)
  await shot(page, 'tiling-three-dwindle')

  // Directional focus: left goes to the roadmap tile
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(focusedTile(page)).toContainText('Q4 Product Roadmap')
  await expect(editorIn(page)).toBeFocused()
  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(focusedTile(page)).toContainText('Kyoto')

  // Swap Kyoto with the roadmap
  await page.keyboard.press('Control+Alt+Shift+ArrowLeft')
  const firstTileText = await tiles(page).evaluateAll((els) => {
    const sorted = [...els].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
    return sorted[0]!.textContent ?? ''
  })
  expect(firstTileText).toContain('Kyoto')

  // Zoom (monocle) and back
  await page.keyboard.press('Control+Alt+Enter')
  await expect(page.getByRole('button', { name: 'Exit Zoom' })).toBeVisible()
  await shot(page, 'tiling-zoom')
  await page.keyboard.press('Control+Alt+Enter')

  // Rotate the right-hand split, then close the focused tile
  await page.keyboard.press('Control+Alt+ArrowRight')
  await page.keyboard.press('Control+Alt+KeyR')
  await shot(page, 'tiling-rotated')
  await page.keyboard.press('Control+Alt+KeyQ')
  await expect(tiles(page)).toHaveCount(2)
})

test('tiling layout and tabs survive a reload', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+Backslash')
  await page.getByRole('textbox', { name: 'Search notes to open in this tile' }).fill('Grocery')
  await page.keyboard.press('Enter')
  await expect(tiles(page)).toHaveCount(2)
  await page.waitForTimeout(500) // layout persistence is debounced
  await page.reload()
  await expect(tiles(page)).toHaveCount(2)
  await expect(page.getByRole('tablist', { name: 'Open notes' })).toBeVisible()
  await shot(page, 'restored-layout')
})

test('drag a note from the sidebar to a tile edge to split there', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Design review')
  const before = await tiles(page).count()
  const target = focusedTile(page)
  const box = (await target.boundingBox())!
  await noteRows(page).filter({ hasText: 'Reading list' }).dragTo(target, {
    targetPosition: { x: box.width - 20, y: box.height / 2 },
  })
  await expect(tiles(page)).toHaveCount(before + 1)
  await shot(page, 'drag-to-tile')
})

test('whiteboard opens as a tile beside the note and closes again', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Design review')
  const count = await tiles(page).count()
  await page.keyboard.press('Control+Shift+KeyD')
  await expect(page.locator('[data-tile-kind="board"]')).toHaveCount(1)
  await expect(page.locator('[data-tile-kind="board"] .excalidraw')).toBeVisible({ timeout: 20_000 })
  await shot(page, 'whiteboard-tile')
  await page.keyboard.press('Control+Shift+KeyD')
  await expect(tiles(page)).toHaveCount(count)
})

test('read mode renders Markdown with checklists', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Q4 Product Roadmap')
  await page.keyboard.press('Control+KeyE')
  const article = focusedTile(page).locator('article')
  await expect(article.getByRole('heading', { name: 'Q4 Product Roadmap' })).toBeVisible()
  await expect(article.locator('input[type=checkbox]')).toHaveCount(3)
  // Checklists stay interactive in read mode.
  await article.locator('input[type=checkbox]').nth(1).click()
  await expect
    .poll(() => noteContent(ids['Q4 Product Roadmap']!), { timeout: 5000 })
    .toContain('- [x] Launch iOS companion')
  await shot(page, 'read-mode')
  // Clicking the already-selected segment must not flip the mode.
  await page.getByRole('radio', { name: 'Read' }).click()
  await expect(article).toBeVisible()
  await page.getByRole('radio', { name: 'Edit' }).click()
  await expect(editorIn(page)).toBeVisible()
})

test('formatting shortcuts: bold, checklist, heading', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+Alt+KeyN')
  await expect(editorIn(page)).toBeFocused()
  await page.keyboard.type('Packing')
  await page.keyboard.press('Control+Shift+KeyH')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Passport')
  await page.keyboard.press('Control+Shift+KeyL')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('important')
  await page.keyboard.press('Control+Shift+ArrowLeft')
  await page.keyboard.press('Control+KeyB')
  await waitForSaved(page)
  const note = (await allNotes()).sort((a, b) => b.id - a.id)[0]!
  expect(await noteContent(note.id)).toBe('# Packing\n- [ ] Passport\n- [ ] **important**')
  ids.packing = note.id
})

test('deleting asks first (HIG alert) and Cancel is the safe default', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Packing')
  await page.keyboard.press('Control+Shift+Backspace')
  const alert = page.getByRole('alertdialog')
  await expect(alert).toContainText('Delete “Packing”?')
  await expect(alert.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await shot(page, 'delete-alert')
  await page.keyboard.press('Enter') // Return = Cancel for destructive alerts
  await expect(alert).toBeHidden()
  expect((await allNotes()).some((n) => n.id === ids.packing)).toBe(true)

  await page.keyboard.press('Control+Shift+Backspace')
  await alert.getByRole('button', { name: 'Delete' }).click()
  await expect.poll(async () => (await allNotes()).some((n) => n.id === ids.packing)).toBe(false)
  await expect(noteRows(page).filter({ hasText: 'Packing' })).toHaveCount(0)
})

test('offline: edits are kept, flagged, and synced on reconnect', async ({ page, context }) => {
  await open(page)
  await openNoteByTitle(page, 'Reading list')
  await page.route('**/api/pastes/*', (route) =>
    route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
  )
  await editorIn(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n- *Shape Up*')
  await expect(page.locator('footer')).toContainText('Offline', { timeout: 15_000 })
  await shot(page, 'offline-indicator')
  await page.unroute('**/api/pastes/*')
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await waitForSaved(page)
  expect(await noteContent(ids['Untitled']!)).toContain('Shape Up')
})

test('settings: accent, font and appearance persist across reloads', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+Comma')
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  await sheet.getByRole('radio', { name: 'Orange' }).click()
  await sheet.getByRole('radio', { name: 'Serif' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'orange')
  await shot(page, 'settings')
  await page.keyboard.press('Escape')
  await shot(page, 'accent-orange-serif')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'orange')
})

test('themes: picker switches families, falls back for dark-only, persists', async ({ page }) => {
  await open(page)
  await openNoteByTitle(page, 'Q4 Product Roadmap')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme-family', 'apple')
  await page.keyboard.press('Control+Comma')
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  const themes = sheet.getByRole('radiogroup', { name: 'Theme' })
  const appearance = sheet.getByRole('radiogroup', { name: 'Appearance' })
  await shot(page, 'theme-picker-apple')

  const families: Array<[string, string, boolean]> = [
    ['Catppuccin', 'catppuccin', true],
    ['Macchiato', 'catppuccin-macchiato', true],
    ['Gruvbox', 'gruvbox', true],
    ['Everforest', 'everforest', true],
    ['Solarized', 'solarized', true],
    ['Nord', 'nord', false],
  ]
  for (const [name, id, hasLight] of families) {
    await themes.getByRole('radio', { name }).click()
    await expect(html).toHaveAttribute('data-theme-family', id)
    await expect(html).toHaveAttribute('data-accent', 'theme')
    if (hasLight) {
      await appearance.getByRole('radio', { name: 'Light' }).click()
      await expect(html).toHaveAttribute('data-theme', 'light')
      await shot(page, `theme-picker-${id}-light`)
      await page.keyboard.press('Escape')
      await shot(page, `app-${id}-light`)
      await page.keyboard.press('Control+Comma')
    }
    await appearance.getByRole('radio', { name: 'Dark' }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await shot(page, `theme-picker-${id}-dark`)
    await page.keyboard.press('Escape')
    await shot(page, `app-${id}-dark`)
    await page.keyboard.press('Control+Comma')
  }

  // Nord ships only dark: asking for light still renders dark.
  await appearance.getByRole('radio', { name: 'Light' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(sheet).toContainText('Nord only has a dark appearance')

  // Gruvbox light survives a reload with no flash of the wrong family.
  await themes.getByRole('radio', { name: 'Gruvbox' }).click()
  await appearance.getByRole('radio', { name: 'Light' }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme-family', 'gruvbox')
  await expect(html).toHaveAttribute('data-theme', 'light')

  // The command palette switches families too.
  await page.keyboard.press('Control+Shift+KeyP')
  await page.keyboard.type('Theme: Everforest')
  await page.keyboard.press('Enter')
  await expect(html).toHaveAttribute('data-theme-family', 'everforest')

  // Corrupt stored values are sanitised back to the default family.
  await page.evaluate(() => localStorage.setItem('velocity.prefs.v1', JSON.stringify({ themeFamily: '<x>', theme: 'neon' })))
  await page.reload()
  await expect(html).toHaveAttribute('data-theme-family', 'apple')
})

test('keyboard shortcuts sheet lists every command', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+Slash')
  const sheet = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
  await expect(sheet).toContainText('Split Tile')
  await expect(sheet).toContainText('Focus tile')
  await shot(page, 'shortcuts-sheet')
})

test('sidebar toggles and the editor gets the space', async ({ page }) => {
  await open(page)
  const sidebar = page.locator('aside[aria-label="Sidebar"]')
  await page.keyboard.press('Control+Alt+KeyS')
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true')
  await shot(page, 'sidebar-hidden')
  await page.keyboard.press('Control+Alt+KeyS')
  await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true')
})

test('dark mode tiled workspace', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await open(page)
  await openNoteByTitle(page, 'Q4 Product Roadmap')
  await page.keyboard.press('Control+Alt+Backslash')
  await page.getByRole('textbox', { name: 'Search notes to open in this tile' }).fill('Design')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Shift+KeyD')
  await expect(page.locator('[data-tile-kind="board"] .excalidraw')).toBeVisible({ timeout: 20_000 })
  await shot(page, 'dark-tiled-board')
  await context.close()
})

test('phone layout: monocle tiles and an overlay sidebar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await open(page)
  await expect(page.locator('aside[aria-label="Sidebar"]')).toHaveAttribute('aria-hidden', 'true')
  await shot(page, 'mobile-editor')
  await page.getByRole('button', { name: 'Show Sidebar' }).click()
  await expect(noteRows(page).first()).toBeVisible()
  await shot(page, 'mobile-sidebar')
  await noteRows(page).filter({ hasText: 'Kyoto' }).click()
  await expect(page.locator('aside[aria-label="Sidebar"]')).toHaveAttribute('aria-hidden', 'true')
  await expect(focusedTile(page)).toContainText('Kyoto, April')
  await context.close()
})

test('typing stays fast in a large note', async ({ page }) => {
  const body = Array.from({ length: 4000 }, (_, i) => `Line ${i}: the quick brown fox jumps over the lazy dog.`).join('\n')
  const big = await api<{ id: number }>('POST', '/api/pastes', { title: 'Large note', content: body })
  await open(page)
  await page.keyboard.press('Control+KeyP')
  await page.keyboard.type('Large note')
  await page.keyboard.press('Enter')
  await expect(focusedTile(page)).toContainText('Line 0')
  await editorIn(page).click()
  const t0 = Date.now()
  await page.keyboard.type('fast typing check ', { delay: 0 })
  const elapsed = Date.now() - t0
  // 18 keystrokes into a ~220 KB note; generous bound for CI noise.
  expect(elapsed).toBeLessThan(1500)
  test.info().annotations.push({ type: 'perf', description: `18 keystrokes in ${elapsed}ms` })
  await waitForSaved(page)
  expect(await noteContent(big.id)).toContain('fast typing check')
})
