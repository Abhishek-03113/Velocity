import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startFakeHerdr, type FakeHerdrWithStatus } from '../../server/tests/fixtures/fakeHerdr.ts'
import { api, noteContent, shot } from './helpers'

// Must match e2e/start-server.mjs.
const TOKEN = 'e2e-herdr-token'
const SOCKET = path.join(os.tmpdir(), `velocity-e2e-herdr-${process.env.E2E_API_PORT ?? '3199'}.sock`)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const rect = {
  id: 'herdr-rect',
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
}

let fake: FakeHerdrWithStatus

test.afterEach(async () => {
  await fake?.close()
})

test('share a note with a herdr agent: attachments reach it, the summary lands on the Agents board', async ({ page }) => {
  fake = (await startFakeHerdr({ socketPath: SOCKET })) as FakeHerdrWithStatus
  const agentCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-e2e-agent-'))
  fake.agents.push({ pane_id: 'w1:p2', name: 'reviewer', agent: 'opencode', agent_status: 'idle', cwd: agentCwd })
  fake.onPrompt = (agent, text) => {
    const id = /<velocity-summary id="([0-9a-f]+)">/.exec(text)?.[1] ?? 'none'
    fake.setStatus(agent, 'working')
    setTimeout(() => {
      fake.screen = `> ${text}\n\n  Done.\n  <velocity-summary id="${id}">\n  - Retries once on HTTP 429, honouring Retry-After\n  - Files: server/plugins/shared/fetchPage.ts\n  </velocity-summary>\n`
      fake.setStatus(agent, 'idle')
    }, 400)
  }

  const asset = await api<{ id: number }>('POST', '/api/assets', { data_url: PNG })
  const note = await api<{ id: number }>('POST', '/api/pastes', {
    title: 'Retry on 429',
    content: `Retry the page fetch once on HTTP 429.\n\n![trace](/api/assets/${asset.id})`,
  })
  await api('PUT', `/api/pastes/${note.id}/whiteboard`, { scene: { elements: [rect], appState: {} } })

  await page.addInitScript((token) => {
    localStorage.setItem('velocity.plugins.v1', JSON.stringify({ enabled: {}, settings: { herdr: { token } } }))
  }, TOKEN)
  await page.goto('/')
  await page.locator(`[data-note-row="${note.id}"]`).click()

  // Share: the picker lists herdr's agents.
  await page.keyboard.press('Control+Alt+KeyG')
  const pick = page.getByRole('dialog', { name: 'Share with' })
  await expect(pick.getByRole('option', { name: /reviewer/ })).toBeVisible()
  await shot(page, 'herdr-picker')
  await page.keyboard.press('Enter')

  await expect.poll(() => fake.prompts.length, { timeout: 15_000 }).toBe(1)
  const sent = fake.prompts[0]!.text
  expect(sent).toContain('Retry on 429')
  expect(sent).toContain('Retry the page fetch once on HTTP 429.')
  expect(sent).not.toContain('/api/assets/')
  const folder = path.join(agentCwd, '.velocity', 'attachments')
  expect(sent).toContain(folder)
  expect(sent).toContain('whiteboard.png')
  expect(sent).toContain('whiteboard.excalidraw')
  expect(sent).toMatch(/<velocity-summary id="[0-9a-f]+">/)
  const turnDir = path.join(folder, fs.readdirSync(folder)[0]!)
  expect(fs.readdirSync(turnDir).sort()).toEqual(['image-1.png', 'whiteboard.excalidraw', 'whiteboard.png'])

  // The note's badge follows the agent; the summary arrives.
  const row = page.locator(`[data-note-row="${note.id}"]`)
  await expect(row).toHaveAttribute('data-badge', 'New summary', { timeout: 15_000 })

  await page.keyboard.press('Control+Alt+KeyA')
  const board = page.getByRole('dialog', { name: 'Agents' })
  const completed = board.getByRole('region', { name: 'Completed' })
  await expect(completed).toContainText('Retry on 429')
  await shot(page, 'herdr-board')

  await completed.getByRole('button', { name: /Retry on 429/ }).click()
  const drawer = board.getByRole('complementary')
  await expect(drawer).toContainText('Retries once on HTTP 429')
  await shot(page, 'herdr-conversation')

  await drawer.getByRole('button', { name: 'Add summary to note' }).click()
  await expect(drawer).toContainText('Added to the note')
  await expect.poll(() => noteContent(note.id), { timeout: 10_000 }).toContain('### Outcome · reviewer')
  const content = await noteContent(note.id)
  expect(content).toContain('- Retries once on HTTP 429, honouring Retry-After')
})
