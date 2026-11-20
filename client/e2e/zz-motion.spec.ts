import { expect, test, type Page } from '@playwright/test'
import { api, noteRows, shot, tiles } from './helpers'

/**
 * Motion and interaction (lib/motion.ts): origin-aware menus, reversible sheets,
 * rubber banding, the palette's Recent / Suggested list, delete motion and the
 * "Reduce interface motion" setting. Runs last (file name) and seeds its own notes.
 */
test.describe.configure({ mode: 'serial' })

const TITLES = ['Motion Alpha', 'Motion Bravo', 'Motion Charlie', 'Motion Delta']

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' })

async function open(page: Page) {
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

test('seed notes for the motion checks', async () => {
  for (const title of TITLES) await api('POST', '/api/pastes', { title, content: `${title} body` })
})

test('a context menu grows out of the point that was clicked', async ({ page }) => {
  await open(page)
  const row = noteRows(page).filter({ hasText: 'Motion Bravo' }).first()
  const box = (await row.boundingBox())!
  const click = { x: box.x + 40, y: box.y + 12 }
  await page.mouse.click(click.x, click.y, { button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const { origin, left, top } = await menu.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { origin: (el as HTMLElement).style.transformOrigin, left: r.left, top: r.top }
  })
  const [ox, oy] = origin.split(' ').map((v) => parseFloat(v))
  expect(Math.abs(left + ox! - click.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(top + oy! - click.y)).toBeLessThanOrEqual(2)
  await shot(page, 'motion-menu-from-pointer')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('a sheet closed mid-open reverses and unmounts', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /^Settings/ }).first().click()
  await expect(settings(page)).toBeVisible()
  expect(await settings(page).evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)
  // Click the backdrop straight away: the entrance plays backwards, then the sheet is gone.
  await page.mouse.click(8, 890)
  await expect(settings(page)).toHaveCount(0)
})

test('the notes column edge stretches past its maximum and springs back', async ({ page }) => {
  await open(page)
  const handle = page.locator('[data-sidebar-resizer="notes"]')
  const b = (await handle.boundingBox())!
  const width = () =>
    handle.evaluate((el) => parseFloat(getComputedStyle(el.closest('aside')!).getPropertyValue('--notes-width')))
  await page.mouse.move(b.x + b.width / 2, b.y + 200)
  await page.mouse.down()
  await page.mouse.move(b.x + 700, b.y + 200, { steps: 12 })
  expect(await width()).toBeGreaterThan(560)
  await page.mouse.up()
  await expect.poll(width).toBe(560)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('velocity.prefs.v1') ?? '{}').notesWidth)
  expect(stored).toBe(560)
})

test('the palette offers recent and suggested commands before the full list', async ({ page }) => {
  await open(page)
  await noteRows(page).filter({ hasText: 'Motion Alpha' }).first().click()
  await page.keyboard.press('Control+Shift+KeyP')
  await expect(palette(page)).toBeVisible()
  await expect(palette(page).getByText('Suggested', { exact: true })).toBeVisible()
  const showAll = palette(page).getByRole('option', { name: /Show all \d+ commands/ })
  await expect(showAll).toBeVisible()
  expect(await palette(page).getByRole('option').count()).toBeLessThanOrEqual(9)
  // Only the Enter target carries the ↵ hint.
  await expect(palette(page).getByText('↵')).toHaveCount(1)

  await palette(page).getByRole('option', { name: /Toggle Read Mode/ }).click()
  await expect(palette(page)).toHaveCount(0)
  await page.keyboard.press('Control+Shift+KeyP')
  await expect(palette(page).getByText('Recent', { exact: true })).toBeVisible()
  await expect(palette(page).getByRole('option').first()).toContainText('Toggle Read Mode')
  await shot(page, 'motion-palette-recent')

  await palette(page).getByRole('option', { name: /Show all \d+ commands/ }).click()
  expect(await palette(page).getByRole('option').count()).toBeGreaterThan(20)
  await page.keyboard.press('Escape')
  await expect(palette(page)).toHaveCount(0)
})

test('a deleted note leaves and the list closes the gap', async ({ page }) => {
  await open(page)
  const before = await noteRows(page).count()
  await noteRows(page).filter({ hasText: 'Motion Charlie' }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete Note…' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: /Delete/ }).click()
  await expect(noteRows(page)).toHaveCount(before - 1)
  await expect(noteRows(page).filter({ hasText: 'Motion Charlie' })).toHaveCount(0)
  // The exiting row is a temporary, hidden copy that removes itself.
  await expect(page.locator('li[aria-hidden="true"]')).toHaveCount(0)
})

test('Reduce interface motion turns animations off', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+Comma')
  await expect(settings(page)).toBeVisible()
  const toggle = settings(page).getByRole('switch', { name: 'Reduce interface motion' })
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '')
  await page.keyboard.press('Escape')
  await expect(settings(page)).toHaveCount(0)
  const row = noteRows(page).first()
  await row.click({ button: 'right' })
  expect(await page.getByRole('menu').evaluate((el) => el.getAnimations().length)).toBe(0)
})
