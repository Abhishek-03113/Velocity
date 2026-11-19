import { TEST_ROOT } from './setup.ts'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startFakeHerdr, type FakeHerdrWithStatus } from './fixtures/fakeHerdr.ts'

const CLAUDE_DIR = path.join(TEST_ROOT, 'claude')
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR
const TOKEN = 'test-token-123'

const { runMigrations } = await import('../db/migrate.ts')
const { createApp } = await import('../app.ts')
const { resetHerdrService } = await import('../plugins/herdr/index.ts')
const { HerdrService } = await import('../plugins/herdr/service.ts')
const { findSummaryBlock, summaryInstruction } = await import('../plugins/herdr/summary.ts')
const { assistantTextSince, findTranscript } = await import('../plugins/herdr/transcript.ts')
const { HerdrConnection, HerdrError } = await import('../plugins/herdr/socket.ts')
runMigrations()
const app = createApp({ log: false })

let fake: FakeHerdrWithStatus
const SESSION = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const agentCwd = path.join(TEST_ROOT, 'repo')

async function call(method: string, url: string, body?: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await app.request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; error?: string } }
}

async function until<T>(fn: () => Promise<T | undefined>, ms = 6000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v !== undefined) return v
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 40))
  }
}

function writeTranscript(entries: object[]) {
  const dir = path.join(CLAUDE_DIR, 'projects', '-repo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${SESSION}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

before(async () => {
  fake = (await startFakeHerdr()) as FakeHerdrWithStatus
  fs.mkdirSync(path.join(agentCwd, '.git'), { recursive: true })
  fake.agents.push(
    { pane_id: 'w1:p2', name: 'reviewer', agent: 'claude', agent_status: 'idle', cwd: agentCwd, agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: SESSION } },
    { pane_id: 'w3:p1', name: 'api-migrator', agent: 'codex', agent_status: 'blocked', cwd: agentCwd },
    { pane_id: 'w3:p2', agent: 'opencode', agent_status: 'idle', cwd: agentCwd },
  )
  resetHerdrService(new HerdrService(fake.socketPath))
})

after(async () => {
  resetHerdrService(null)
  await fake.close()
})

// ---- pure pieces ---------------------------------------------------------

test('summary block: found by id on its own lines, kept whole, instruction never matches', () => {
  const id = 'abc123'
  const long = Array.from({ length: 120 }, (_, i) => `- point ${i + 1}`).join('\n')
  const text = [summaryInstruction(id), 'Working…', `<velocity-summary id="${id}">`, long, '</velocity-summary>', 'done'].join('\n')
  assert.equal(findSummaryBlock(text, id), long)
  assert.equal(findSummaryBlock(summaryInstruction(id), id), null, 'the instruction alone is not a summary')
  assert.equal(findSummaryBlock(text, 'other'), null)
  const screen = `   <velocity-summary id="${id}">\n   - indented\n     - nested\n   </velocity-summary>`
  assert.equal(findSummaryBlock(screen, id), '- indented\n  - nested')
})

test('transcript: assistant text since the send, final message after the last tool result', () => {
  const t0 = new Date('2026-11-05T10:00:00Z')
  writeTranscript([
    { type: 'assistant', timestamp: '2026-11-05T09:00:00Z', message: { content: [{ type: 'text', text: 'old turn' }] } },
    { type: 'user', timestamp: '2026-11-05T10:00:01Z', message: { content: 'the prompt' } },
    { type: 'assistant', timestamp: '2026-11-05T10:00:02Z', message: { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Bash' }] } },
    { type: 'assistant', isSidechain: true, timestamp: '2026-11-05T10:00:03Z', message: { content: [{ type: 'text', text: 'sub-agent' }] } },
    { type: 'user', timestamp: '2026-11-05T10:00:04Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', timestamp: '2026-11-05T10:00:05Z', message: { content: [{ type: 'text', text: 'Fixed it.' }] } },
    'not json',
  ])
  const file = findTranscript(SESSION)!
  assert.ok(file)
  const text = assistantTextSince(file, t0)
  assert.equal(text.all, 'Looking.\n\nFixed it.')
  assert.equal(text.final, 'Fixed it.')
  assert.equal(findTranscript('../../etc/passwd'), null, 'only UUID-shaped session ids')
})

test('socket client refuses methods outside the allow-list', async () => {
  const conn = new HerdrConnection(fake.socketPath)
  await assert.rejects(conn.request('pane.send_keys', {}), (e: unknown) => e instanceof HerdrError && e.code === 'not_allowed')
  conn.close()
})

// ---- routes ----------------------------------------------------------------

test('off without a token, 401 with a wrong one', async () => {
  delete process.env.HERDR_CONNECTOR_TOKEN
  assert.equal((await call('GET', '/api/plugins/herdr/agents')).status, 503)
  process.env.HERDR_CONNECTOR_TOKEN = TOKEN
  assert.equal((await call('GET', '/api/plugins/herdr/agents', undefined, 'nope')).status, 401)
  assert.equal((await call('GET', '/api/plugins/herdr/agents', undefined, null)).status, 401)
})

test('status and agents', async () => {
  process.env.HERDR_CONNECTOR_TOKEN = TOKEN
  const s = await call('GET', '/api/plugins/herdr/status')
  assert.equal(s.json.data.version, '0.9.5')
  const a = await call('GET', '/api/plugins/herdr/agents')
  assert.deepEqual(a.json.data.map((x: { paneId: string }) => x.paneId), ['w1:p2', 'w3:p1', 'w3:p2'])
  assert.equal(a.json.data[0].hasSession, true)
})

test('share: images and the whiteboard reach the agent, the summary comes back from the transcript', async () => {
  process.env.HERDR_CONNECTOR_TOKEN = TOKEN
  const note = (await call('POST', '/api/pastes', { title: 'Fix flaky sync test', content: 'x' })).json.data
  const asset = (await call('POST', '/api/assets', { data_url: PNG })).json.data
  await call('PUT', `/api/pastes/${note.id}/whiteboard`, { scene: { elements: [{ id: 'r1', type: 'rectangle' }], appState: {}, files: {} } })

  fake.onPrompt = (agent, text) => {
    const id = /<velocity-summary id="([0-9a-f]+)">/.exec(text)![1]
    fake.setStatus(agent, 'working')
    setTimeout(() => {
      writeTranscript([
        { type: 'user', timestamp: new Date().toISOString(), message: { content: text } },
        { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: `All fixed.\n\n<velocity-summary id="${id}">\n- Waits for the flush\n- Files: a.ts\n</velocity-summary>` }] } },
      ])
      fake.setStatus(agent, 'idle')
    }, 30)
  }

  const res = await call('POST', '/api/plugins/herdr/share', {
    noteId: note.id,
    noteTitle: 'Fix flaky sync test',
    paneId: 'w1:p2',
    text: `Fix flaky sync test\n\nSee the failure:\n\n![trace](/api/assets/${asset.id})`,
    hashes: ['h1', 'h2'],
    askSummary: true,
    includeWhiteboard: true,
    whiteboardPng: PNG,
  })
  assert.equal(res.status, 202)
  const convId = res.json.data.id

  const done = await until(async () => {
    const list = (await call('GET', '/api/plugins/herdr/conversations')).json.data as any[]
    const c = list.find((x) => x.id === convId)
    return c?.turns.at(-1)?.status === 'done' ? c : undefined
  })
  const turn = done.turns.at(-1)
  assert.equal(turn.summary, '- Waits for the flush\n- Files: a.ts')
  assert.equal(turn.summarySource, 'transcript')
  assert.deepEqual(turn.sentHashes, ['h1', 'h2'])
  assert.equal(done.seen, false, 'a new summary is unread')
  assert.deepEqual(turn.attachments.map((a: { kind: string }) => a.kind).sort(), ['image', 'whiteboard-png', 'whiteboard-scene'])

  const sent = fake.prompts.at(-1)!.text
  const folder = /Image 1: (.+image-1\.png)/.exec(sent)![1]!
  assert.ok(folder.startsWith(path.join(agentCwd, '.velocity', 'attachments')), 'files go to the agent’s folder')
  assert.ok(sent.includes(`![trace](${folder})`), 'the image link points at the file')
  assert.ok(!sent.includes('/api/assets/'), 'no Velocity URLs reach the agent')
  assert.ok(fs.existsSync(folder))
  const dir = path.dirname(folder)
  assert.ok(fs.existsSync(path.join(dir, 'whiteboard.png')))
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'whiteboard.excalidraw'), 'utf8'))
  assert.equal(scene.type, 'excalidraw')
  assert.equal(scene.elements[0].id, 'r1')
  assert.match(fs.readFileSync(path.join(agentCwd, '.git', 'info', 'exclude'), 'utf8'), /^\.velocity\/$/m)

  assert.equal((await call('POST', `/api/plugins/herdr/conversations/${convId}/seen`)).status, 200)
  assert.equal((await call('POST', '/api/plugins/herdr/conversations/archive-seen')).json.data.archived, 1)
  const after = (await call('GET', '/api/plugins/herdr/conversations')).json.data as any[]
  assert.ok(!after.some((c) => c.id === convId))
})

test('share: a blocked agent gets nothing typed (409)', async () => {
  process.env.HERDR_CONNECTOR_TOKEN = TOKEN
  const note = (await call('POST', '/api/pastes', { title: 'Webhooks', content: 'x' })).json.data
  const before = fake.prompts.length
  const r = await call('POST', '/api/plugins/herdr/share', { noteId: note.id, noteTitle: 'Webhooks', paneId: 'w3:p1', text: 'Move the handlers', hashes: [] })
  assert.equal(r.status, 409)
  assert.equal(fake.prompts.length, before)
  const missing = await call('POST', '/api/plugins/herdr/share', { noteId: note.id, noteTitle: 'Webhooks', paneId: 'w9:p9', text: 'hi', hashes: [] })
  assert.equal(missing.status, 404)
})

test('share: agents without a transcript give their summary from the screen', async () => {
  process.env.HERDR_CONNECTOR_TOKEN = TOKEN
  const note = (await call('POST', '/api/pastes', { title: 'Retry on 429', content: 'x' })).json.data
  fake.onPrompt = (agent, text) => {
    const id = /<velocity-summary id="([0-9a-f]+)">/.exec(text)![1]
    fake.screen = `> ${text}\n\n  Done.\n  <velocity-summary id="${id}">\n  - Retries once on 429\n  </velocity-summary>\n`
    fake.setStatus(agent, 'working')
    setTimeout(() => fake.setStatus(agent, 'idle'), 20)
  }
  const r = await call('POST', '/api/plugins/herdr/share', { noteId: note.id, noteTitle: 'Retry on 429', paneId: 'w3:p2', text: 'Retry the fetch once on 429', hashes: ['a'] })
  assert.equal(r.status, 202)
  const turn = await until(async () => {
    const c = ((await call('GET', '/api/plugins/herdr/conversations')).json.data as any[]).find((x) => x.id === r.json.data.id)
    const t = c?.turns.at(-1)
    return t?.status === 'done' ? t : undefined
  })
  assert.equal(turn.summary, '- Retries once on 429')
  assert.equal(turn.summarySource, 'screen')
  assert.deepEqual(turn.attachments, [], 'nothing to attach')
})

test('share: text over 100 KB is refused', async () => {
  process.env.HERDR_CONNECTOR_TOKEN = TOKEN
  const r = await call('POST', '/api/plugins/herdr/share', { noteId: 1, noteTitle: 'Big', paneId: 'w1:p2', text: 'x'.repeat(100_001), hashes: [] })
  assert.equal(r.status, 413)
})
