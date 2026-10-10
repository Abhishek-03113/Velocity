import { expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const API = 'http://localhost:3199'
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots/after')

let counter = 0
/** Save a review screenshot to docs/screenshots/after (numbered in run order). */
export async function shot(page: Page, name: string) {
  counter += 1
  // Let springs / fades settle so screenshots are deterministic.
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(SHOTS, `${String(counter).padStart(2, '0')}-${name}.png`) })
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json()) as { data: T }
  return json.data
}

export async function allNotes(): Promise<Array<{ id: number; title: string; group_id: number | null }>> {
  return api('GET', '/api/pastes')
}

export async function noteContent(id: number): Promise<string> {
  return (await api<{ content: string }>('GET', `/api/pastes/${id}`)).content
}

export async function waitForSaved(page: Page) {
  await expect(page.locator('footer').getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
}

export const tiles = (page: Page) => page.locator('[data-tile-id]')
export const focusedTile = (page: Page) => page.locator('section[data-tile-id][class*="tileFocused"]')
export const editorIn = (page: Page, tile = focusedTile(page)) => tile.locator('.cm-content')
export const noteRows = (page: Page) => page.locator('[data-note-row]')
