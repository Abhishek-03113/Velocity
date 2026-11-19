import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/**
 * Minimal client for herdr's local socket API: newline-delimited JSON, one request per line,
 * responses echo the request id. Only the methods below may be sent: nothing that types into
 * plain shells, sends raw keys, or changes herdr's layout.
 */
export const ALLOWED_METHODS = new Set([
  'ping',
  'agent.list',
  'agent.get',
  'agent.read',
  'agent.prompt',
  'agent.wait',
  'agent.focus',
])

const MAX_LINE_BYTES = 4 * 1024 * 1024

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'

export interface AgentInfo {
  terminal_id: string
  name?: string
  agent?: string
  title?: string
  terminal_title_stripped?: string
  display_agent?: string
  agent_status: AgentStatus
  agent_session?: { source: string; agent: string; kind: string; value: string }
  workspace_id: string
  tab_id: string
  pane_id: string
  focused: boolean
  state_change_seq?: number
  completion_seq?: number
  cwd?: string
  foreground_cwd?: string
  revision?: number
}

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HerdrError'
  }
}

/** Where herdr's API socket is: HERDR_SOCKET_PATH, else the named or default session. */
export function resolveSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HERDR_SOCKET_PATH?.trim()) return env.HERDR_SOCKET_PATH.trim()
  const base = path.join(os.homedir(), '.config', 'herdr')
  const session = env.HERDR_SESSION?.trim()
  if (session && /^[A-Za-z0-9._-]+$/.test(session)) return path.join(base, 'sessions', session, 'herdr.sock')
  return path.join(base, 'herdr.sock')
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }

/** One connection. Requests may overlap; each resolves with its `result` or rejects with HerdrError. */
export class HerdrConnection {
  private socket: net.Socket | null = null
  private buffer = ''
  private seq = 0
  private pending = new Map<string, Pending>()
  private closed = false

  constructor(private readonly socketPath: string) {}

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket)
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socketPath)
      const onError = (err: Error) => {
        socket.destroy()
        reject(new HerdrError(connectCode(err), connectMessage(err, this.socketPath)))
      }
      socket.once('error', onError)
      socket.once('connect', () => {
        socket.off('error', onError)
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => this.onData(chunk))
        socket.on('error', (err) => this.failAll(new HerdrError('disconnected', err.message)))
        socket.on('close', () => this.failAll(new HerdrError('disconnected', 'herdr closed the connection')))
        this.socket = socket
        resolve(socket)
      })
    })
  }

  private onData(chunk: string) {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES && !this.buffer.includes('\n')) {
      this.failAll(new HerdrError('line_too_long', 'herdr sent a line over 4 MB'))
      this.close()
      return
    }
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (!line) continue
      let msg: { id?: string; result?: unknown; error?: { code?: string; message?: string } }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      const p = msg.id ? this.pending.get(msg.id) : undefined
      if (!p) continue
      this.pending.delete(msg.id!)
      if (p.timer) clearTimeout(p.timer)
      if (msg.error) p.reject(new HerdrError(msg.error.code ?? 'error', msg.error.message ?? 'herdr error'))
      else p.resolve(msg.result)
    }
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
    this.socket = null
    this.buffer = ''
  }

  async request<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (!ALLOWED_METHODS.has(method)) throw new HerdrError('not_allowed', `Velocity doesn't call ${method}`)
    if (this.closed) throw new HerdrError('disconnected', 'connection closed')
    const socket = await this.connect()
    const id = `v${++this.seq}`
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { resolve: resolve as (v: unknown) => void, reject }
      if (timeoutMs) {
        p.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new HerdrError('timeout', `${method} timed out`))
        }, timeoutMs)
      }
      this.pending.set(id, p)
      socket.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  close() {
    this.closed = true
    this.socket?.destroy()
    this.failAll(new HerdrError('disconnected', 'connection closed'))
  }
}

function connectCode(err: Error & { code?: string }): string {
  if (err.code === 'ENOENT') return 'not_running'
  if (err.code === 'ECONNREFUSED') return 'not_running'
  if (err.code === 'EACCES' || err.code === 'EPERM') return 'permission_denied'
  return 'unreachable'
}

function connectMessage(err: Error & { code?: string }, socketPath: string): string {
  if (err.code === 'ENOENT') return `herdr isn't running: no socket at ${socketPath}`
  if (err.code === 'ECONNREFUSED') return `herdr isn't running: ${socketPath} refused the connection`
  if (err.code === 'EACCES' || err.code === 'EPERM')
    return `Permission denied opening ${socketPath}. Run Velocity as the user who runs herdr.`
  return `Can't reach herdr at ${socketPath}: ${err.message}`
}

/** Run one request on a fresh connection (for long waits that hold their response open). */
export async function oneShot<T>(socketPath: string, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  const conn = new HerdrConnection(socketPath)
  try {
    return await conn.request<T>(method, params, timeoutMs)
  } finally {
    conn.close()
  }
}
