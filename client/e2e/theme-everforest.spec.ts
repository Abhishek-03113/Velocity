import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api, editorIn, focusedTile, noteRows, tiles } from './helpers'

/**
 * Everforest family: Hard / Medium / Soft contrast in light and dark.
 * Seeds one Markdown note with code (deleted afterwards so other specs see the same data) and saves
 * review screenshots named `70-NN-*` (E2E_SHOTS_DIR selects the folder, like shot() in helpers.ts).
 */
const TITLE = 'Everforest sample'
const CONTENT = [
  '# Everforest sample',
  '',
  'A **calm** green palette with *three* contrast levels and a [link](https://github.com/sainnhe/everforest).',
  '',
  '- Hard, medium and soft',
  '- `inline code` and a quote:',
  '',
  '> Backend stores. Frontend thinks.',
  '',
  '```ts',
  '// debounce persistence',
  'export function save(id: number, delay = 800): string {',
  '  if (id < 0) throw new Error("bad id")',
  '  return `note-${id}`',
  '}',
  '```',
  '',
].join('\n')

const SHOTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots',
  process.env.E2E_SHOTS_DIR ?? 'after',
)
let counter = 0
async function snap(page: Page, name: string) {
  counter += 1
  await page.waitForTimeout(350)
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `70-${String(counter).padStart(2, '0')}-${name}.png`) })
}

let noteId = 0

test.beforeAll(async () => {
  const note = await api<{ id: number }>('POST', '/api/pastes', { title: TITLE, content: CONTENT, group_id: null })
  noteId = note.id
})

test.afterAll(async () => {
  if (noteId) await api('DELETE', `/api/pastes/${noteId}`)
})

async function open(page: Page) {
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await noteRows(page).filter({ hasText: TITLE }).first().click()
  await expect(page.locator('header').getByRole('button', { name: TITLE }).first()).toBeVisible()
  // Keep focus in the editor so list rows show no keyboard focus ring in screenshots.
  await editorIn(page, focusedTile(page)).click()
}

test('themes: Everforest contrast variants in dark and light, persistence, palette commands', async ({ page }) => {
  await open(page)
  const html = page.locator('html')
  await page.keyboard.press('Control+Comma')
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  const themes = sheet.getByRole('radiogroup', { name: 'Theme' })
  const appearance = sheet.getByRole('radiogroup', { name: 'Appearance' })

  await themes.getByRole('radio', { name: 'Everforest', exact: true }).click()
  await expect(html).toHaveAttribute('data-theme-family', 'everforest')

  // Explicit Dark: a single "Contrast" row, default Medium.
  await appearance.getByRole('radio', { name: 'Dark' }).click()
  const contrast = sheet.getByRole('radiogroup', { name: 'Contrast', exact: true })
  await expect(contrast.getByRole('radio')).toHaveCount(3)
  await expect(html).toHaveAttribute('data-theme-variant', 'medium')
  await expect(contrast.getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true')
  await snap(page, 'picker-contrast-dark')

  // Auto: both Light and Dark contrast rows.
  await appearance.getByRole('radio', { name: 'Auto' }).click()
  await expect(sheet.getByRole('radiogroup', { name: 'Light contrast' }).getByRole('radio')).toHaveCount(3)
  await expect(sheet.getByRole('radiogroup', { name: 'Dark contrast' }).getByRole('radio')).toHaveCount(3)
  await snap(page, 'picker-auto-rows')

  for (const mode of ['Dark', 'Light'] as const) {
    await appearance.getByRole('radio', { name: mode }).click()
    await expect(html).toHaveAttribute('data-theme', mode.toLowerCase())
    for (const [name, id] of [['Hard', 'hard'], ['Medium', 'medium'], ['Soft', 'soft']] as const) {
      await contrast.getByRole('radio', { name }).click()
      await expect(html).toHaveAttribute('data-theme-variant', id)
      await expect(html).toHaveAttribute('data-theme', mode.toLowerCase())
      await page.keyboard.press('Escape')
      await expect(html).toHaveCSS('color-scheme', mode.toLowerCase())
      await snap(page, `app-${mode.toLowerCase()}-${id}`)
      await page.keyboard.press('Control+Comma')
    }
  }

  // Hard light really is the lightest background; soft dark the lightest dark one.
  await contrast.getByRole('radio', { name: 'Hard' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('body')).toHaveCSS('background-color', /rgb\(2[45]\d, 2[45]\d, 2[34]\d\)/)

  // Choice persists across a reload (the pre-paint script applies it).
  await page.keyboard.press('Control+Comma')
  await appearance.getByRole('radio', { name: 'Dark' }).click()
  await contrast.getByRole('radio', { name: 'Soft' }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme-family', 'everforest')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).toHaveAttribute('data-theme-variant', 'soft')

  // Palette commands name the appearance: "Theme: Everforest Light Hard".
  await page.keyboard.press('Control+Shift+KeyP')
  await page.keyboard.type('Theme: Everforest Light Hard')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette.getByRole('option').first()).toContainText('Theme: Everforest Light Hard')
  await page.keyboard.press('Enter')
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(html).toHaveAttribute('data-theme-variant', 'hard')

  // Phone width: the contrast rows fit.
  await page.setViewportSize({ width: 390, height: 780 })
  await page.keyboard.press('Control+Comma')
  await appearance.getByRole('radio', { name: 'Auto' }).click()
  const darkRow = sheet.getByRole('radiogroup', { name: 'Dark contrast' })
  await darkRow.scrollIntoViewIfNeeded()
  const box = await darkRow.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  await snap(page, 'picker-phone')
})
