import { expect, test } from '@playwright/test'
import { api, tiles } from './helpers'

/**
 * Regression: a palette query typed before the background search warm-up finishes must
 * update once the note text is indexed (cold start, slow server). The note is delayed on
 * purpose. Seeds and removes its own notes: velocity.spec.ts expects an empty database.
 */
test('palette: a query typed during search warm-up resolves when the index is ready', async ({ page }) => {
  const kyoto = await api<{ id: number }>('POST', '/api/pastes', {
    title: 'Travel — Kyoto',
    content: 'Arashiyama bamboo grove',
    group_id: null,
  })
  const other = await api<{ id: number }>('POST', '/api/pastes', { title: 'Other', content: 'nothing here', group_id: null })
  try {
    await page.route(new RegExp(`/api/pastes/${kyoto.id}$`), async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      await route.continue()
    })
    await page.goto('/')
    await expect(tiles(page).first()).toBeVisible()
    await page.keyboard.press('Control+KeyP')
    await page.keyboard.type('bamboo')
    const palette = page.getByRole('dialog', { name: 'Search notes' })
    await expect(palette.getByRole('option').first()).toContainText('Kyoto')
  } finally {
    for (const id of [kyoto.id, other.id]) await api('DELETE', `/api/pastes/${id}`)
  }
})
