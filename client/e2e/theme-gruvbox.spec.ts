import { expect, test, type Page } from '@playwright/test'
import { api, editorIn, noteRows, shot, tiles } from './helpers'

/**
 * Gruvbox family: Hard / Medium / Soft contrast in light and dark. Seeds its own note
 * (so the first-run welcome note is never created) and removes every note afterwards,
 * because velocity.spec.ts sorts after this file and expects an empty database.
 */
test.describe.configure({ mode: 'serial' })

const TITLE = 'Gruvbox Sample'
const CONTENT = [
  '# Gruvbox Sample',
  '',
  'Retro groove colours: **bold**, _italic_, `inline code` and a [link](https://github.com/morhetz/gruvbox).',
  '',
  '- [x] Hard, medium and soft backgrounds',
  '- [ ] Pick the one that is easiest on the eyes',
  '',
  '```ts',
  '// comment: sum a list',
  'export function sum(xs: number[]): number {',
  "  const label: string = 'total'",
  '  let total = 0',
  '  for (const x of xs) total += x * 2',
  '  console.log(label, total, true)',
  '  return total',
  '}',
  '```',
  '',
  '> Blockquote for contrast.',
  '',
].join('\n')

async function open(page: Page) {
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

test.beforeAll(async () => {
  await api('POST', '/api/pastes', { title: TITLE, content: CONTENT, group_id: null })
})

test.afterAll(async () => {
  const notes = await api<Array<{ id: number }>>('GET', '/api/pastes')
  for (const n of notes) await api('DELETE', `/api/pastes/${n.id}`)
})

test('themes: Gruvbox contrast row, variants in dark and light, persistence, palette', async ({ page }) => {
  await open(page)
  await noteRows(page).filter({ hasText: TITLE }).first().click()
  await expect(editorIn(page)).toContainText('Retro groove')
  await editorIn(page).click()
  const html = page.locator('html')

  await page.keyboard.press('Control+Comma')
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  const themes = sheet.getByRole('radiogroup', { name: 'Theme' })
  const appearance = sheet.getByRole('radiogroup', { name: 'Appearance' })

  // Families without variants show no Contrast row.
  await themes.getByRole('radio', { name: 'Nord', exact: true }).click()
  await expect(sheet.locator('[data-variant-rows]')).toHaveCount(0)

  await themes.getByRole('radio', { name: 'Gruvbox', exact: true }).click()
  await expect(html).toHaveAttribute('data-theme-family', 'gruvbox')

  // Auto: separate Light and Dark Contrast rows with three choices each.
  await appearance.getByRole('radio', { name: 'Auto' }).click()
  await expect(sheet.getByRole('radiogroup', { name: 'Light contrast' }).getByRole('radio')).toHaveCount(3)
  await expect(sheet.getByRole('radiogroup', { name: 'Dark contrast' }).getByRole('radio')).toHaveCount(3)
  await shot(page, 'picker-auto-rows')

  // Explicit Dark: one "Contrast" row, default Medium.
  await appearance.getByRole('radio', { name: 'Dark' }).click()
  const contrast = sheet.getByRole('radiogroup', { name: 'Contrast', exact: true })
  await expect(contrast).toBeVisible()
  await expect(html).toHaveAttribute('data-theme-variant', 'medium')
  await expect(contrast.getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true')
  await shot(page, 'picker-contrast-dark')

  for (const id of ['hard', 'medium', 'soft']) {
    await contrast.getByRole('radio', { name: cap(id) }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-theme-variant', id)
    await page.keyboard.press('Escape')
    await shot(page, `app-dark-${id}`)
    await page.keyboard.press('Control+Comma')
  }

  await appearance.getByRole('radio', { name: 'Light' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(html).toHaveAttribute('data-theme-variant', 'medium')
  for (const id of ['hard', 'medium', 'soft']) {
    await contrast.getByRole('radio', { name: cap(id) }).click()
    await expect(html).toHaveAttribute('data-theme-variant', id)
    await page.keyboard.press('Escape')
    await shot(page, `app-light-${id}`)
    await page.keyboard.press('Control+Comma')
  }

  // Choices are remembered per appearance and survive a reload (the pre-paint script applies them).
  await contrast.getByRole('radio', { name: 'Soft' }).click()
  await appearance.getByRole('radio', { name: 'Dark' }).click()
  await contrast.getByRole('radio', { name: 'Hard' }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme-family', 'gruvbox')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).toHaveAttribute('data-theme-variant', 'hard')
  await page.keyboard.press('Control+Comma')
  await appearance.getByRole('radio', { name: 'Light' }).click()
  await expect(html).toHaveAttribute('data-theme-variant', 'soft')
  await page.keyboard.press('Escape')

  // Palette commands carry the appearance so Hard/Medium/Soft are unambiguous.
  await page.keyboard.press('Control+Shift+KeyP')
  await page.keyboard.type('Theme: Gruvbox Dark Soft')
  await page.keyboard.press('Enter')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).toHaveAttribute('data-theme-variant', 'soft')

  // Phone width: the Contrast control fits.
  await page.setViewportSize({ width: 390, height: 780 })
  await page.keyboard.press('Control+Comma')
  await appearance.getByRole('radio', { name: 'Auto' }).click()
  const darkRow = sheet.getByRole('radiogroup', { name: 'Dark contrast' })
  await darkRow.scrollIntoViewIfNeeded()
  const box = await darkRow.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  await shot(page, 'picker-phone')
})
