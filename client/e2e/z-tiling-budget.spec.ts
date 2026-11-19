import { expect, test, type Page } from '@playwright/test'
import { api, noteRows, tiles } from './helpers'

/**
 * Frame budget for the tiling workspace. A layout change (split, zoom, move) must lay the page out a handful of times,
 * not once per animation frame: tile geometry animates with transforms (FLIP), never by transitioning left / top /
 * width / height, which re-lays out every editor on every frame (~18 layout passes per change at 60 Hz). Measured with
 * Chrome's own counters. File name sorts last so the notes it seeds do not disturb the other specs.
 */
test.describe.configure({ mode: 'serial' })

const TITLES = ['Budget North', 'Budget South', 'Budget East']
/** Layout passes allowed per action. FLIP needs ~1–3; per-frame layout animation needs ~18. */
const LAYOUT_BUDGET = 8

async function layoutCount(cdp: Awaited<ReturnType<typeof cdpFor>>): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return metrics.find((m) => m.name === 'LayoutCount')?.value ?? 0
}

async function cdpFor(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  return cdp
}

/** Layout passes caused by `action`, counted until the 280 ms tile animation has finished. */
async function layoutsDuring(page: Page, action: () => Promise<void>): Promise<number> {
  const cdp = await cdpFor(page)
  // Let anything pending (editor mount, focus) settle first.
  await page.waitForTimeout(500)
  const before = await layoutCount(cdp)
  await action()
  await page.waitForTimeout(450)
  const after = await layoutCount(cdp)
  await cdp.detach()
  return after - before
}

test('split, zoom and move stay within the layout budget', async ({ page }) => {
  for (const title of TITLES) await api('POST', '/api/pastes', { title, content: `${title} body` })
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await noteRows(page).filter({ hasText: TITLES[0]! }).click()
  await noteRows(page).filter({ hasText: TITLES[1]! }).click({ modifiers: ['Control'] })
  await noteRows(page).filter({ hasText: TITLES[2]! }).click({ modifiers: ['Control'] })
  await expect(tiles(page)).toHaveCount(3)

  // Slots must not transition layout properties at all.
  const transition = await page.locator('[data-slot-id]').first().evaluate((el) => getComputedStyle(el).transitionProperty)
  expect(transition).not.toMatch(/\b(left|top|width|height|all)\b/)

  const zoom = await layoutsDuring(page, () => page.keyboard.press('Control+Alt+Enter'))
  const unzoom = await layoutsDuring(page, () => page.keyboard.press('Control+Alt+Enter'))
  const move = await layoutsDuring(page, () => page.keyboard.press('Control+Alt+Shift+ArrowLeft'))
  const split = await layoutsDuring(page, async () => {
    await page.keyboard.press('Control+Alt+Backslash')
    await expect(tiles(page)).toHaveCount(4)
  })
  console.log(`layout passes: zoom ${zoom}, unzoom ${unzoom}, move ${move}, split ${split} (budget ${LAYOUT_BUDGET})`)
  expect(zoom).toBeLessThanOrEqual(LAYOUT_BUDGET)
  expect(unzoom).toBeLessThanOrEqual(LAYOUT_BUDGET)
  expect(move).toBeLessThanOrEqual(LAYOUT_BUDGET)
  expect(split).toBeLessThanOrEqual(LAYOUT_BUDGET)

  // Clean up the empty tile so a later run starts from the same layout.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Alt+KeyQ')
  await expect(tiles(page)).toHaveCount(3)
})

test('dragging a note shows the drop preview where the tile will land, and the drop matches it', async ({ page }) => {
  // A fresh context: one tile showing South; North is not open anywhere.
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await noteRows(page).filter({ hasText: TITLES[1]! }).click()
  await expect(tiles(page)).toHaveCount(1)
  const target = tiles(page).filter({ hasText: TITLES[1]! }).first()
  const box = (await target.boundingBox())!
  const row = (await noteRows(page).filter({ hasText: TITLES[0]! }).boundingBox())!
  // Hold the drag over the target's right edge.
  await page.mouse.move(row.x + 30, row.y + 20)
  await page.mouse.down()
  await page.mouse.move(row.x + 80, row.y + 30, { steps: 4 })
  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 10 })
  const preview = page.locator('[data-drop-preview="split"]')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Split right')
  const shown = (await preview.boundingBox())!
  await page.mouse.up()
  await expect(page.locator('[data-drop-preview]')).toHaveCount(0)
  await expect(tiles(page)).toHaveCount(2)
  // The note now sits where the preview was (preview is inset by half a tile gap).
  const landed = tiles(page).filter({ hasText: TITLES[0]! }).first()
  await expect
    .poll(async () => {
      const r = (await landed.boundingBox())!
      return Math.abs(r.x - shown.x) < 12 && Math.abs(r.width - shown.width) < 16 && Math.abs(r.y - shown.y) < 12
    })
    .toBe(true)
  // Its text was not dropped into the target editor as well.
  await expect(target.locator('.cm-content')).toHaveText(`${TITLES[1]} body`)
})
