import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * A tiny stand-in for herdr's socket API (newline-delimited JSON, `{ id, method, params }` in,
 * `{ id, result: { type, … } }` or `{ id, error: { code, message } }` out). Tests script how an agent
 * behaves after a prompt; nothing here needs a real herdr.
 */

export interface FakeAgent {
  pane_id: string
  name?: string
  agent?: string
  agent_status: 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
  cwd?: string
  agent_session?: { source: string; agent: string; kind: string; value: string }
  state_change_seq?: number
}

export interface FakeHerdr {
  socketPath: string
  agents: FakeAgent[]
  prompts: Array<{ target: string; text: string }>
  calls: string[]
  /** What happens when a prompt arrives: by default the agent works briefly, then is idle. */
  onPrompt: (agent: FakeAgent, text: string) => Promise<void> | void
  /** Screen text returned by agent.read. */
  screen: string
  close(): Promise<void>
}

export async function startFakeHerdr(): Promise<FakeHerdr> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-herdr-'))
  const socketPath = path.join(dir, 'herdr.sock')
  const waiters: Array<{ agent: FakeAgent; until: string[]; resolve: () => void }> = []

  const fake: FakeHerdr = {
    socketPath,
    agents: [],
    prompts: [],
    calls: [],
    screen: '',
    onPrompt: (agent) => {
      setStatus(agent, 'working')
      setTimeout(() => setStatus(agent, 'idle'), 30)
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        for (const s of sockets) s.destroy()
      }),
  }

  function setStatus(agent: FakeAgent, status: FakeAgent['agent_status']) {
    agent.agent_status = status
    agent.state_change_seq = (agent.state_change_seq ?? 0) + 1
    for (const w of [...waiters]) {
      if (w.agent === agent && w.until.includes(status)) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve()
      }
    }
  }
  ;(fake as FakeHerdr & { setStatus: typeof setStatus }).setStatus = setStatus

  const info = (a: FakeAgent) => ({ terminal_id: `t-${a.pane_id}`, workspace_id: 'w1', tab_id: 'w1:t1', focused: false, ...a })
  const find = (target: string) => fake.agents.find((a) => a.pane_id === target || a.name === target)
  const waitFor = (agent: FakeAgent, until: string[]) =>
    until.includes(agent.agent_status) ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ agent, until, resolve }))

  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        void handle(JSON.parse(line))
      }
    })
    const send = (msg: unknown) => {
      if (!socket.destroyed) socket.write(JSON.stringify(msg) + '\n')
    }
    async function handle(req: { id: string; method: string; params: Record<string, any> }) {
      fake.calls.push(req.method)
      const err = (code: string, message: string) => send({ id: req.id, error: { code, message } })
      switch (req.method) {
        case 'ping':
          return send({ id: req.id, result: { type: 'pong', version: '0.9.5', protocol: 1 } })
        case 'agent.list':
          return send({ id: req.id, result: { type: 'agent_list', agents: fake.agents.map(info) } })
        case 'agent.get': {
          const a = find(req.params.target)
          return a ? send({ id: req.id, result: { type: 'agent_info', agent: info(a) } }) : err('not_found', 'agent not found')
        }
        case 'agent.focus': {
          const a = find(req.params.target)
          return a ? send({ id: req.id, result: { type: 'agent_info', agent: info(a) } }) : err('not_found', 'agent not found')
        }
        case 'agent.read':
          return send({ id: req.id, result: { type: 'pane_read', read: { pane_id: req.params.target, text: fake.screen, truncated: false } } })
        case 'agent.wait': {
          const a = find(req.params.target)
          if (!a) return err('not_found', 'agent not found')
          await waitFor(a, req.params.until?.length ? req.params.until : ['idle', 'done', 'blocked'])
          return send({ id: req.id, result: { type: 'agent_info', agent: info(a) } })
        }
        case 'agent.prompt': {
          const a = find(req.params.target)
          if (!a) return err('not_found', 'agent not found')
          if (a.agent_status === 'blocked') return err('agent_blocked', 'agent is blocked')
          fake.prompts.push({ target: req.params.target, text: req.params.text })
          await fake.onPrompt(a, req.params.text)
          if (req.params.wait) {
            await waitFor(a, req.params.wait.until ?? ['idle', 'done', 'blocked'])
          }
          return send({ id: req.id, result: { type: 'agent_prompted', agent: info(a) } })
        }
        default:
          return err('unknown_method', req.method)
      }
    }
  })
  await new Promise<void>((r) => server.listen(socketPath, r))
  return fake
}

export type FakeHerdrWithStatus = FakeHerdr & { setStatus: (a: FakeAgent, s: FakeAgent['agent_status']) => void }
