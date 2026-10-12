import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/**
 * Browser-only build (VITE_APP_ENV=production): everything lives in localStorage and no request
 * ever goes to /api. Serial: each test builds on a fresh context but shares nothing.
 */
const tiles = (page: Page) => page.locator('[data-tile-id]')
const focusedTile = (page: Page) => page.locator('section[data-tile-id][class*="tileFocused"]')
const editor = (page: Page) => focusedTile(page).locator('.cm-content')
const noteRows = (page: Page) => page.locator('[data-note-row]')

// 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let apiRequests: string[] = []

test.beforeEach(async ({ page }) => {
  apiRequests = []
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) apiRequests.push(`${req.method()} ${req.url()}`)
  })
})

test.afterEach(() => {
  expect(apiRequests, 'no request to /api/* may leave the page').toEqual([])
})

async function open(page: Page) {
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

async function newNoteWithText(page: Page, text: string) {
  await page.keyboard.press('Control+Alt+KeyN')
  await editor(page).click()
  await page.keyboard.type(text)
  // Debounced save (800 ms) then the footer settles.
  await expect(page.locator('footer').getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
}

test('notes persist across reloads', async ({ page }) => {
  await open(page)
  await newNoteWithText(page, 'Persisted offline note')
  await page.reload()
  await expect(tiles(page).first()).toBeVisible()
  await expect(noteRows(page).filter({ hasText: 'Persisted offline note' })).toHaveCount(1)
  await noteRows(page).filter({ hasText: 'Persisted offline note' }).first().click()
  await expect(editor(page)).toContainText('Persisted offline note')
})

test('folders: create one and move a note into it', async ({ page }) => {
  await open(page)
  await newNoteWithText(page, 'Filed note')
  const row = noteRows(page).filter({ hasText: 'Filed note' })
  await row.hover()
  await row.getByRole('button', { name: 'Move to Folder' }).click()
  await page.getByRole('menuitem', { name: 'New Folder…' }).click()
  await page.keyboard.press('Enter')
  await page.reload()
  const nav = page.getByRole('navigation', { name: 'Folders' })
  // The toolbar's "New Folder" button also matches /New Folder/ — target the folder row ("New Folder 1").
  const folder = nav.getByRole('button', { name: /^New Folder \d+$/ })
  await expect(folder).toBeVisible()
  await folder.click()
  await expect(noteRows(page).filter({ hasText: 'Filed note' })).toHaveCount(1)
})

test('whiteboard drawings persist across reloads', async ({ page }) => {
  await open(page)
  await newNoteWithText(page, 'Board note')
  await page.keyboard.press('Control+Shift+KeyD')
  const canvas = page.locator('.excalidraw canvas.interactive')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)
  await page.keyboard.press('r')
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => /^velocity\.db\.v1\.w\.\d+$/.test(k)).length), {
      timeout: 10_000,
    })
    .toBe(1)

  await page.reload()
  await expect(tiles(page).first()).toBeVisible()
  await noteRows(page).filter({ hasText: 'Board note' }).first().click()
  await page.keyboard.press('Control+Shift+KeyD')
  await expect(page.locator('.excalidraw canvas.interactive')).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector('.excalidraw canvas.static') as HTMLCanvasElement | null
          if (!c) return 0
          const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
          let ink = 0
          for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0 && data[i]! < 100) ink += 1
          return ink
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(200)
})

test('pasted images are stored locally and render after a reload', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+Alt+KeyN')
  await editor(page).click()
  await page.keyboard.type('Image note ')
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'dot.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    document.querySelector('.cm-content')!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, PNG_BASE64)
  // The editor swaps a Markdown image line for an inline image widget, so the `/api/assets/…`
  // URL never shows as text — assert the widget and the stored asset instead.
  const widget = focusedTile(page).locator('img.cm-md-image-remote')
  await expect(widget).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => widget.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(page.locator('footer').getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('velocity.db.v1.a.')))).toBe(true)

  await page.reload()
  await expect(tiles(page).first()).toBeVisible()
  await noteRows(page).filter({ hasText: 'Image note' }).first().click()
  await page.keyboard.press('Control+KeyE') // Read mode
  const img = focusedTile(page).locator('img').first()
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(await img.getAttribute('src')).toMatch(/^blob:/)
})

test('Blog Reader is absent; Settings shows storage usage and exports a backup', async ({ page }) => {
  await open(page)
  await newNoteWithText(page, 'Backup me')

  await page.keyboard.press('Control+Shift+KeyP')
  const cmd = page.getByRole('dialog', { name: 'Command palette' })
  await expect(cmd).toBeVisible()
  await page.keyboard.type('blog')
  await expect(cmd.getByRole('option', { name: /Open Blog Post/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+Comma')
  await expect(page.locator('[data-storage-usage]')).toContainText(/MB of ~\d+(\.\d)? MB used in this browser/)
  await expect(page.locator('[data-plugin-row="blog-reader"]')).toContainText('Needs the Velocity server')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^velocity-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const file = JSON.parse(await readFile((await download.path())!, 'utf8')) as {
    format: string
    version: number
    entries: Record<string, string>
  }
  expect(file.format).toBe('velocity-backup')
  expect(Object.keys(file.entries).some((k) => /^p\.\d+\.m$/.test(k))).toBe(true)
})
