import { expect, test, type Page } from '@playwright/test'
import { tiles } from './helpers'

/**
 * Plugins can be switched off and on in Settings → Plugins: their commands, keys, badges,
 * panels, tiles and editor mode go away while off, the choice survives a reload, and
 * everything comes back when switched on again.
 */
test.describe.configure({ mode: 'serial' })

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' })
const previewTile = (page: Page) => page.locator('section[data-tile-kind="plugin"]')

async function setPlugin(page: Page, id: string, on: boolean) {
  await page.keyboard.press('Control+Comma')
  await expect(settings(page)).toBeVisible()
  const toggle = page.locator(`[data-plugin-row="${id}"]`).getByRole('switch').first()
  await toggle.scrollIntoViewIfNeeded()
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
  await page.keyboard.press('Escape')
  await expect(settings(page)).toHaveCount(0)
}

async function paletteHas(page: Page, query: string, option: RegExp): Promise<boolean> {
  await page.keyboard.press('Control+Shift+KeyP')
  await expect(palette(page)).toBeVisible()
  await page.keyboard.type(query)
  const count = await palette(page).getByRole('option', { name: option }).count()
  await page.keyboard.press('Escape')
  await expect(palette(page)).toHaveCount(0)
  return count > 0
}

test('switch plugins off and on', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

  // Every registered plugin has a switch, on by default.
  await page.keyboard.press('Control+Comma')
  for (const id of ['blog-reader', 'herdr', 'latex']) {
    await expect(page.locator(`[data-plugin-row="${id}"]`).getByRole('switch').first()).toHaveAttribute('aria-checked', 'true')
  }
  await page.keyboard.press('Escape')

  // ---- LaTeX: tile, badge, editor mode, commands, keys ----
  await page.keyboard.press('Control+Shift+KeyP')
  await page.keyboard.type('new latex')
  await palette(page).getByRole('option', { name: /New LaTeX Document/ }).first().click()
  await expect(previewTile(page).locator('.ltx-page h2').first()).toBeVisible({ timeout: 15_000 })
  const firstLine = page.locator('section[data-tile-kind="note"] .cm-line').first()
  const latexMode = () => firstLine.evaluate((l) => [...l.querySelectorAll('span')].some((s) => s.textContent === '\\documentclass'))
  await expect.poll(latexMode).toBe(true)
  await expect(page.locator('[data-badge="TeX"]').first()).toBeVisible()

  await setPlugin(page, 'latex', false)
  await expect(previewTile(page)).toContainText('LaTeX is switched off.')
  await expect(page.locator('[data-badge="TeX"]')).toHaveCount(0)
  await expect.poll(latexMode).toBe(false)
  expect(await paletteHas(page, 'latex', /LaTeX: /)).toBe(false)
  await page.locator('section[data-tile-kind="note"] .cm-content').click()
  await page.keyboard.press('Control+Alt+KeyX')
  await expect(tiles(page)).toHaveCount(2) // no-op while off: the tile neither closes nor toggles

  // Off survives a reload.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(previewTile(page)).toContainText('LaTeX is switched off.', { timeout: 15_000 })

  // Turn it back on from the tile.
  await previewTile(page).getByRole('button', { name: 'Turn On LaTeX' }).click()
  await expect(previewTile(page).locator('.ltx-page h2').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-badge="TeX"]').first()).toBeVisible()
  await expect.poll(latexMode).toBe(true)
  expect(await paletteHas(page, 'latex', /LaTeX: Toggle Live Preview/)).toBe(true)

  // "Close Tile" on a switched-off plugin's tile.
  await setPlugin(page, 'latex', false)
  await previewTile(page).locator('[data-tile-body]').getByRole('button', { name: 'Close Tile' }).click()
  await expect(previewTile(page)).toHaveCount(0)
  await setPlugin(page, 'latex', true)

  // ---- Herdr: switching it off closes its open panel; Settings keeps focus ----
  await page.keyboard.press('Control+Alt+KeyA')
  const board = page.getByRole('dialog', { name: 'Agents' })
  await expect(board).toBeVisible()
  await setPlugin(page, 'herdr', false) // Settings opens over the board, Escape closes it
  await expect(board).toHaveCount(0)
  expect(await paletteHas(page, 'herdr', /Herdr: /)).toBe(false)
  await page.keyboard.press('Control+Alt+KeyA')
  await expect(board).toHaveCount(0)
  await setPlugin(page, 'herdr', true)
  expect(await paletteHas(page, 'herdr', /Herdr: Show Agents Board/)).toBe(true)

  // ---- Blog Reader: keys follow the switch ----
  const prompt = page.getByRole('dialog', { name: 'Blog Reader' })
  await setPlugin(page, 'blog-reader', false)
  await page.keyboard.press('Control+Alt+KeyB')
  await expect(prompt).toHaveCount(0)
  await setPlugin(page, 'blog-reader', true)
  await page.keyboard.press('Control+Alt+KeyB')
  await expect(prompt).toBeVisible()
  await page.keyboard.press('Escape')
})
