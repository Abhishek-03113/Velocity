import { expect, test, type Page } from '@playwright/test'
import { api, API, noteRows, shot, tiles } from './helpers'

type Scene = { elements: Array<{ type: string; isDeleted?: boolean }> }

async function boardScene(id: number): Promise<Scene | null> {
  const res = await fetch(`${API}/api/pastes/${id}/whiteboard`)
  if (res.status === 404) return null
  return ((await res.json()) as { data: { scene: Scene } }).data.scene
}

async function openNoteWithBoard(page: Page, title: string) {
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await noteRows(page).filter({ hasText: title }).first().click()
  await expect(page.locator('header').getByRole('button', { name: title }).first()).toBeVisible()
  await page.keyboard.press('Control+Shift+KeyD')
  await expect(page.locator('.excalidraw canvas.interactive')).toBeVisible({ timeout: 20_000 })
}

test('whiteboards are stored on the server and follow the note to another device', async ({ browser }) => {
  const note = await api<{ id: number }>('POST', '/api/pastes', { title: 'Sketch across devices', content: 'Board test' })
  expect(await boardScene(note.id)).toBeNull()

  // Device A: draw a rectangle.
  const a = await browser.newContext()
  const pageA = await a.newPage()
  await openNoteWithBoard(pageA, 'Sketch across devices')
  const canvas = pageA.locator('.excalidraw canvas.interactive')
  const box = (await canvas.boundingBox())!
  // Focus the canvas (harmless click with the select tool), then pick the rectangle tool.
  await pageA.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)
  await pageA.keyboard.press('r')
  await pageA.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35)
  await pageA.mouse.down()
  await pageA.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 8 })
  await pageA.mouse.up()
  await shot(pageA, 'board-drawn-device-a')

  await expect
    .poll(async () => (await boardScene(note.id))?.elements.filter((e) => e.type === 'rectangle' && !e.isDeleted).length, {
      timeout: 10_000,
    })
    .toBe(1)
  expect(await pageA.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('velocity.whiteboard')))).toEqual([])
  const flagged = (await api<Array<{ id: number; has_whiteboard: number }>>('GET', '/api/pastes')).find((n) => n.id === note.id)
  expect(flagged?.has_whiteboard).toBe(1)
  await a.close()

  // Device B: fresh browser context, so empty localStorage.
  const b = await browser.newContext()
  const pageB = await b.newPage()
  const loaded = pageB.waitForResponse((r) => r.url().endsWith(`/api/pastes/${note.id}/whiteboard`) && r.status() === 200)
  await openNoteWithBoard(pageB, 'Sketch across devices')
  await loaded
  expect(await pageB.evaluate(() => localStorage.getItem(`velocity.whiteboard.v1.${1}`))).toBeNull()
  // The rectangle is rendered, not just stored: the static canvas holds drawn pixels.
  await expect
    .poll(
      () =>
        pageB.evaluate(() => {
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
  await shot(pageB, 'board-loaded-device-b')
  await b.close()
})

test('legacy localStorage boards are migrated to the server on startup', async ({ browser }) => {
  const note = await api<{ id: number }>('POST', '/api/pastes', { title: 'Legacy board note' })
  const legacy = {
    elements: [
      {
        id: 'legacy-rect',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 120,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        index: 'a0',
      },
    ],
    appState: {},
  }
  const ctx = await browser.newContext()
  await ctx.addInitScript(
    ([id, scene]) => {
      if (!localStorage.getItem('migrated-once')) {
        localStorage.setItem(`velocity.whiteboard.v1.${id}`, scene as string)
        localStorage.setItem('velocity.whiteboard.index.v1', JSON.stringify([id]))
        localStorage.setItem('migrated-once', '1')
      }
    },
    [note.id, JSON.stringify(legacy)] as const,
  )
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(tiles(page).first()).toBeVisible()
  await expect.poll(async () => (await boardScene(note.id))?.elements.length, { timeout: 10_000 }).toBe(1)
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('velocity.whiteboard'))))
    .toEqual([])
  await ctx.close()
})
