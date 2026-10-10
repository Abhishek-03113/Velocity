import { expect, test, type Page } from '@playwright/test'
import { api, focusedTile, noteRows, shot, tiles } from './helpers'

/**
 * Sliding (scrollable) tiling mode. Runs after the main walkthrough (file name
 * sorts last) and seeds its own notes so it does not depend on its state.
 */
test.describe.configure({ mode: 'serial' })

const TITLES = ['Slide Alpha', 'Slide Bravo', 'Slide Charlie', 'Slide Delta']

const workspace = (page: Page) => page.locator('[data-tiling-mode]')

async function open(page: Page) {
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

async function addColumn(page: Page, title: string) {
  await page.keyboard.press('Control+Alt+Backslash')
  const launcher = page.getByRole('textbox', { name: 'Search notes to open in this tile' })
  await expect(launcher).toBeFocused().catch(async (e) => {
    console.log('DEBUG', title, await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className} tiles=${document.querySelectorAll('section[data-tile-id]').length} sc=${document.querySelector('[data-tiling-mode]')?.getAttribute('data-scroll')}`))
    throw e
  })
  await launcher.fill(title)
  await page.keyboard.press('Enter')
  await expect(focusedTile(page)).toContainText(title)
}

/** Tile boxes relative to the workspace, keyed by the note title they show. */
async function boxes(page: Page) {
  return page.evaluate((titles) => {
    const ws = document.querySelector('[data-tiling-mode]')!.getBoundingClientRect()
    const out: Record<string, { left: number; right: number; width: number }> = {}
    document.querySelectorAll('section[data-tile-id]').forEach((el) => {
      const text = el.textContent ?? ''
      const title = titles.find((t) => text.includes(t))
      if (!title) return
      const r = el.getBoundingClientRect()
      out[title] = { left: r.left - ws.left, right: r.right - ws.left, width: r.width }
    })
    return { ws: { width: ws.width }, tiles: out }
  }, TITLES)
}

async function expectFocusedInView(page: Page) {
  await expect
    .poll(async () => {
      const r = await focusedTile(page).evaluate((el) => {
        const ws = document.querySelector('[data-tiling-mode]')!.getBoundingClientRect()
        const t = el.getBoundingClientRect()
        return { l: t.left - ws.left, r: ws.right - t.right }
      })
      return r.l >= -1 && r.r >= -1
    })
    .toBe(true)
}

/** Fresh page → sliding mode with one column per seeded note (each test has its own storage). */
async function setupFour(page: Page) {
  await open(page)
  await noteRows(page).filter({ hasText: TITLES[0]! }).first().click()
  await page.keyboard.press('Control+Alt+KeyT')
  await expect(workspace(page)).toHaveAttribute('data-tiling-mode', 'sliding')
  for (const title of TITLES.slice(1)) await addColumn(page, title)
  await expect(tiles(page)).toHaveCount(4)
}

test('seed notes for sliding tests', async () => {
  for (const title of TITLES) {
    await api('POST', '/api/pastes', { title, content: `# ${title}\n\nColumn content for ${title}.\n`, group_id: null })
  }
})

test('switch to sliding via the palette; notes open as columns that scroll into view', async ({ page }) => {
  await open(page)
  await noteRows(page).filter({ hasText: TITLES[0]! }).first().click()
  await expect(workspace(page)).toHaveAttribute('data-tiling-mode', 'dwindle')

  await page.keyboard.press('Control+Shift+KeyP')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('>tiling mode')
  await expect(palette.getByRole('option').first()).toContainText('Toggle Tiling Mode')
  await shot(page, 'sliding-palette')
  await page.keyboard.press('Enter')
  await expect(workspace(page)).toHaveAttribute('data-tiling-mode', 'sliding')

  for (const title of TITLES.slice(1)) await addColumn(page, title)
  await expect(tiles(page)).toHaveCount(4)
  await expectFocusedInView(page)

  // Columns are half the viewport each, laid out left to right on the strip.
  await shot(page, 'sliding-four-columns')
  await expect
    .poll(async () => {
      const t = await boxes(page)
      return TITLES.every((x) => t.tiles[x]!.width < t.ws.width * 0.52)
    })
    .toBe(true)
  const b = await boxes(page)
  const order = TITLES.map((t) => b.tiles[t]!.left)
  expect(order).toEqual([...order].sort((x, y) => x - y))
  for (const t of TITLES) expect(b.tiles[t]!.width).toBeGreaterThan(b.ws.width * 0.45)
  for (const t of TITLES) expect(b.tiles[t]!.width).toBeLessThan(b.ws.width * 0.52)
  // Four half-width columns can't all fit: the strip has scrolled.
  await expect(workspace(page)).not.toHaveAttribute('data-scroll', '0.000')
})

test('keyboard focus scrolls the strip; width cycles; swap moves the column', async ({ page }) => {
  await setupFour(page)

  await page.keyboard.press('Control+Alt+ArrowLeft')
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(focusedTile(page)).toContainText(TITLES[0]!)
  await expectFocusedInView(page)
  await expect(workspace(page)).toHaveAttribute('data-scroll', '0.000')
  await shot(page, 'sliding-scrolled-start')

  await page.keyboard.press('Control+Alt+ArrowRight')
  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(focusedTile(page)).toContainText(TITLES[2]!)
  await expectFocusedInView(page)

  // Cycle width 1/2 → 2/3 → full → 1/3
  const widthRatio = async () => {
    const b = await boxes(page)
    return b.tiles[TITLES[2]!]!.width / b.ws.width
  }
  await page.keyboard.press('Control+Alt+KeyC')
  await expect.poll(widthRatio).toBeGreaterThan(0.62)
  await expectFocusedInView(page)
  await shot(page, 'sliding-width-two-thirds')
  await page.keyboard.press('Control+Alt+KeyC')
  await expect.poll(widthRatio).toBeGreaterThan(0.97)
  await expectFocusedInView(page)
  await shot(page, 'sliding-width-full')
  await page.keyboard.press('Control+Alt+KeyC')
  await expect.poll(widthRatio).toBeLessThan(0.38)
  await shot(page, 'sliding-width-third')

  // Move the column left: Charlie now sits before Bravo.
  await page.keyboard.press('Control+Alt+Shift+ArrowLeft')
  await expect(focusedTile(page)).toContainText(TITLES[2]!)
  await expect
    .poll(async () => {
      const b = await boxes(page)
      return b.tiles[TITLES[2]!]!.left < b.tiles[TITLES[1]!]!.left
    })
    .toBe(true)
  await expectFocusedInView(page)

  // Zoom toggles a full-width column and back.
  await page.keyboard.press('Control+Alt+Enter')
  await expect.poll(widthRatio).toBeGreaterThan(0.97)
  await page.keyboard.press('Control+Alt+Enter')
  await expect.poll(widthRatio).toBeLessThan(0.5)
})

test('split down stacks inside a column; up/down move within it', async ({ page }) => {
  await setupFour(page)
  await page.keyboard.press('Control+Alt+Minus')
  const launcher = page.getByRole('textbox', { name: 'Search notes to open in this tile' })
  await expect(launcher).toBeFocused()
  await page.keyboard.press('Escape')
  const stacked = await page.evaluate(() => {
    const xs = [...document.querySelectorAll('section[data-tile-id]')].map((el) =>
      Math.round(el.getBoundingClientRect().left),
    )
    return new Set(xs).size < xs.length
  })
  expect(stacked).toBe(true)
  await shot(page, 'sliding-stacked')
  // Focus is on the new (lower) tile; up moves to the tile above it in the same column.
  await page.keyboard.press('Control+Alt+ArrowUp')
  await expect(focusedTile(page)).toContainText(TITLES[3]!)
  await page.keyboard.press('Control+Alt+ArrowDown')
  await page.keyboard.press('Control+Alt+KeyQ')
  await expect(tiles(page)).toHaveCount(4)
})

test('the strip scrolls with the wheel and survives a reload', async ({ page }) => {
  await setupFour(page)
  const count = await tiles(page).count()
  await page.mouse.move(700, 450)
  await page.mouse.wheel(-3000, 0)
  await expect(workspace(page)).toHaveAttribute('data-scroll', '0.000')
  await page.mouse.wheel(3000, 0)
  await expect(workspace(page)).not.toHaveAttribute('data-scroll', '0.000')
  await page.waitForTimeout(500)
  await page.reload()
  await expect(workspace(page)).toHaveAttribute('data-tiling-mode', 'sliding')
  await expect(tiles(page)).toHaveCount(count)
})

test('switching back to dwindle keeps the same notes in tiles', async ({ page }) => {
  await setupFour(page)
  const before = await tiles(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-tile-id')).sort())
  await page.keyboard.press('Control+Alt+KeyT')
  await expect(workspace(page)).toHaveAttribute('data-tiling-mode', 'dwindle')
  const after = await tiles(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-tile-id')).sort())
  expect(after).toEqual(before)
  const boxesNow = await boxes(page)
  for (const t of TITLES) expect(boxesNow.tiles[t], `${t} still visible`).toBeTruthy()
  for (const t of TITLES) {
    const b = boxesNow.tiles[t]!
    expect(b.left).toBeGreaterThanOrEqual(-1)
    expect(b.right).toBeLessThanOrEqual(boxesNow.ws.width + 1)
  }
  await shot(page, 'sliding-back-to-dwindle')

  // And the Settings control reflects and drives the mode.
  await page.keyboard.press('Control+Comma')
  const group = page.getByRole('radiogroup', { name: 'Tiling mode' })
  await expect(group.getByRole('radio', { name: 'Dwindle' })).toHaveAttribute('aria-checked', 'true')
  await group.getByRole('radio', { name: 'Sliding' }).click()
  await expect(workspace(page)).toHaveAttribute('data-tiling-mode', 'sliding')
  await shot(page, 'sliding-settings')
  await page.keyboard.press('Escape')
})

test('dark mode sliding strip with off-screen columns', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await setupFour(page)
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await shot(page, 'sliding-dark')
  await context.close()
})
