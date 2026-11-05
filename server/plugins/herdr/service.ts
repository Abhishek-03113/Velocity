import { HerdrConnection, HerdrError, oneShot, resolveSocketPath, type AgentInfo, type AgentStatus } from './socket.ts'
import { findSummaryBlock, newSummaryId, summaryInstruction, type SummaryResult } from './summary.ts'
import { assistantTextSince, findTranscript } from './transcript.ts'
import { attachmentSection, hasWhiteboard, prepareAttachments } from './attachments.ts'
import * as store from './store.ts'

export type HerdrEvent =
  | { type: 'agents'; agents: AgentView[] }
  | { type: 'conversation'; conversation: store.ConversationView }
  | { type: 'connection'; ok: boolean; error?: string }

export interface AgentView {
  paneId: string
  name: string | null
  kind: string | null
  title: string | null
  status: AgentStatus
  cwd: string | null
  hasSession: boolean
}

export class ShareError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message)
  }
}

const POLL_MS = 1500
const SCREEN_LINES = [400, 2000, 8000]

function view(a: AgentInfo): AgentView {
  return {
    paneId: a.pane_id,
    name: a.name ?? null,
    kind: a.agent ?? null,
    title: a.terminal_title_stripped ?? a.title ?? null,
    status: a.agent_status,
    cwd: a.foreground_cwd ?? a.cwd ?? null,
    hasSession: !!a.agent_session?.value,
  }
}

function isClaude(a: Pick<AgentInfo, 'agent' | 'agent_session'>): boolean {
  return a.agent === 'claude' || a.agent_session?.agent === 'claude'
}

export class HerdrService {
  private control: HerdrConnection | null = null
  private listeners = new Set<(e: HerdrEvent) => void>()
  private agents: AgentInfo[] = []
  private agentsKey = ''
  private connected: boolean | null = null
  private lastError = 'herdr isn’t reachable'
  private pollTimer: NodeJS.Timeout | null = null
  private running = new Set<number>()
  private recovered = false

  constructor(readonly socketPath: string = resolveSocketPath()) {}

  // ---- connection -------------------------------------------------------
  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    if (!this.control) this.control = new HerdrConnection(this.socketPath)
    try {
      return await this.control.request<T>(method, params, timeoutMs)
    } catch (err) {
      if (err instanceof HerdrError && ['disconnected', 'not_running', 'unreachable', 'permission_denied'].includes(err.code)) {
        this.control.close()
        this.control = null
      }
      throw err
    }
  }

  async status() {
    const pong = await this.call<{ version: string; protocol: number }>('ping')
    const agents = await this.listAgents()
    return { version: pong.version, protocol: pong.protocol, socketPath: this.socketPath, agents: agents.length }
  }

  async listAgents(): Promise<AgentInfo[]> {
    const res = await this.call<{ agents: AgentInfo[] }>('agent.list')
    this.agents = res.agents ?? []
    return this.agents
  }

  async getAgent(paneId: string): Promise<AgentInfo> {
    const res = await this.call<{ agent: AgentInfo }>('agent.get', { target: paneId })
    return res.agent
  }

  // ---- events -----------------------------------------------------------
  subscribe(fn: (e: HerdrEvent) => void): () => void {
    this.listeners.add(fn)
    // A new subscriber gets the current state; later events are changes.
    if (this.connected !== null) {
      fn(this.connected ? { type: 'connection', ok: true } : { type: 'connection', ok: false, error: this.lastError })
      if (this.connected) fn({ type: 'agents', agents: this.agents.map(view) })
    }
    this.ensurePolling()
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(e: HerdrEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e)
      } catch {
        // a closed stream; it unsubscribes itself
      }
    }
  }

  private emitConversation(id: number) {
    const c = store.getConversation(id)
    if (c) this.emit({ type: 'conversation', conversation: store.viewConversation(c) })
  }

  /** Poll herdr's agent list while anyone watches or a turn is open (cheap: a local socket). */
  ensurePolling() {
    if (this.pollTimer) return
    const tick = async () => {
      this.pollTimer = null
      const busy = this.listeners.size > 0 || this.running.size > 0 || store.activeTurns().length > 0
      if (!busy) return
      try {
        const agents = await this.listAgents()
        if (this.connected !== true) {
          this.connected = true
          this.emit({ type: 'connection', ok: true })
        }
        const key = JSON.stringify(agents.map((a) => [a.pane_id, a.name, a.agent, a.agent_status, a.foreground_cwd ?? a.cwd, a.terminal_title_stripped]))
        if (key !== this.agentsKey) {
          this.agentsKey = key
          this.emit({ type: 'agents', agents: agents.map(view) })
        }
        this.syncTurnStates(agents)
        if (!this.recovered) {
          this.recovered = true
          this.recover()
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
        if (this.connected !== false) {
          this.connected = false
          this.emit({ type: 'connection', ok: false, error: this.lastError })
        }
      }
      this.pollTimer = setTimeout(tick, POLL_MS)
      this.pollTimer.unref?.()
    }
    this.pollTimer = setTimeout(tick, 0)
    this.pollTimer.unref?.()
  }

  /** A sending turn whose agent is now working has started; mirror blocked/working from herdr. */
  private syncTurnStates(agents: AgentInfo[]) {
    for (const t of store.activeTurns()) {
      const c = store.getConversation(t.conversation_id)
      const a = c && agents.find((x) => x.pane_id === c.pane_id)
      if (!a) continue
      if (a.agent_status === 'working' && t.status !== 'working') {
        store.updateTurn(t.id, { status: 'working', started_at: t.started_at ?? new Date().toISOString() })
        this.emitConversation(t.conversation_id)
      } else if (a.agent_status === 'blocked' && t.status === 'working') {
        store.updateTurn(t.id, { status: 'blocked' })
        this.emitConversation(t.conversation_id)
      }
      if (a.agent_session?.value && c.agent_session_id !== a.agent_session.value) {
        store.updateConversation(c.id, { agent_session_id: a.agent_session.value })
      }
    }
  }

  // ---- share ------------------------------------------------------------
  async share(input: {
    noteId: number
    noteTitle: string
    paneId: string
    text: string
    hashes: string[]
    askSummary: boolean
    includeWhiteboard: boolean
    whiteboardPng?: string | null
  }): Promise<store.ConversationView> {
    let agent: AgentInfo
    try {
      agent = await this.getAgent(input.paneId)
    } catch (err) {
      if (err instanceof HerdrError && err.code === 'not_found') throw new ShareError(404, `No agent in ${input.paneId} any more.`)
      if (err instanceof HerdrError) throw new ShareError(503, err.message)
      throw err
    }
    if (agent.agent_status === 'blocked') throw new ShareError(409, `${agent.name ?? agent.pane_id} needs you. Answer it in herdr first.`)

    let conv = store.findOpenConversation(input.noteId, input.paneId)
    const fields = { name: agent.name ?? null, kind: agent.agent ?? null, sessionId: agent.agent_session?.value ?? null, cwd: agent.foreground_cwd ?? agent.cwd ?? null }
    if (!conv) conv = store.createConversation({ pasteId: input.noteId, title: input.noteTitle, paneId: input.paneId, ...fields })
    else store.updateConversation(conv.id, { note_title: input.noteTitle, agent_name: fields.name, agent_kind: fields.kind, agent_session_id: fields.sessionId, agent_cwd: fields.cwd, seen: 1 })

    const summaryId = newSummaryId()
    const turn = store.createTurn({ conversationId: conv.id, summaryId, askSummary: input.askSummary, hashes: input.hashes, startSeq: agent.state_change_seq ?? null })

    const prepared = prepareAttachments({
      turnKey: `${conv.id}-${turn.id}-${summaryId}`,
      noteId: input.noteId,
      content: input.text,
      agentCwd: fields.cwd ?? undefined,
      includeWhiteboard: input.includeWhiteboard && hasWhiteboard(input.noteId),
      whiteboardPng: input.whiteboardPng,
    })
    store.updateTurn(turn.id, {
      attachments: JSON.stringify(prepared.files.map((f) => ({ kind: f.kind, label: f.label }))),
      attachments_note: prepared.skipped ?? null,
    })

    const message = [prepared.text.trim(), attachmentSection(prepared), input.askSummary ? summaryInstruction(summaryId) : '']
      .filter(Boolean)
      .join('\n\n')

    void this.runTurn(turn.id, { prompt: message })
    this.ensurePolling()
    return store.viewConversation(store.getConversation(conv.id)!)
  }

  // ---- turn lifecycle ---------------------------------------------------
  private async runTurn(turnId: number, opts: { prompt?: string }) {
    if (this.running.has(turnId)) return
    this.running.add(turnId)
    try {
      const turn = store.getTurn(turnId)!
      const conv = store.getConversation(turn.conversation_id)!
      let agent: AgentInfo
      if (opts.prompt !== undefined) {
        const res = await oneShot<{ agent: AgentInfo }>(this.socketPath, 'agent.prompt', {
          target: conv.pane_id,
          text: opts.prompt,
          wait: { until: ['idle', 'done', 'blocked'] },
        })
        agent = res.agent
      } else {
        const res = await oneShot<{ agent: AgentInfo }>(this.socketPath, 'agent.wait', { target: conv.pane_id, until: ['idle', 'done', 'blocked'] })
        agent = res.agent
      }

      for (;;) {
        if (agent.agent_status === 'blocked') {
          store.updateTurn(turnId, { status: 'blocked' })
          this.emitConversation(conv.id)
          agent = (await oneShot<{ agent: AgentInfo }>(this.socketPath, 'agent.wait', { target: conv.pane_id, until: ['working', 'idle', 'done'] })).agent
          if (agent.agent_status === 'working') {
            store.updateTurn(turnId, { status: 'working' })
            this.emitConversation(conv.id)
            agent = (await oneShot<{ agent: AgentInfo }>(this.socketPath, 'agent.wait', { target: conv.pane_id, until: ['idle', 'done', 'blocked'] })).agent
          }
          continue
        }
        // idle or done: read the summary. Herdr doesn't track individual prompts, so if the
        // block for this turn isn't there yet and the agent picked up work again, keep waiting.
        const result = await this.collectSummary(turnId, agent)
        if (!result.summary && store.getTurn(turnId)!.ask_summary) {
          await new Promise((r) => setTimeout(r, 2500))
          const again = await this.getAgent(conv.pane_id).catch(() => null)
          if (again && (again.agent_status === 'working' || again.agent_status === 'blocked')) {
            agent = again.agent_status === 'blocked' ? again : (await oneShot<{ agent: AgentInfo }>(this.socketPath, 'agent.wait', { target: conv.pane_id, until: ['idle', 'done', 'blocked'] })).agent
            continue
          }
          const late = again ? await this.collectSummary(turnId, again) : result
          this.finish(turnId, conv.id, late)
        } else {
          this.finish(turnId, conv.id, result)
        }
        return
      }
    } catch (err) {
      const code = err instanceof HerdrError ? err.code : 'error'
      const message = err instanceof Error ? err.message : String(err)
      const turn = store.getTurn(turnId)
      if (turn) {
        const status: store.TurnStatus = code === 'agent_prompt_stalled' || code === 'timeout' ? 'unconfirmed' : 'failed'
        store.updateTurn(turnId, { status, error: friendlyError(code, message), finished_at: new Date().toISOString() })
        store.updateConversation(turn.conversation_id, { seen: 0 })
        this.emitConversation(turn.conversation_id)
      }
    } finally {
      this.running.delete(turnId)
    }
  }

  private finish(turnId: number, conversationId: number, result: SummaryResult) {
    store.updateTurn(turnId, { status: 'done', summary: result.summary, summary_source: result.source, finished_at: new Date().toISOString() })
    store.updateConversation(conversationId, { seen: 0 })
    this.emitConversation(conversationId)
  }

  /** The turn's summary block: Claude Code's transcript first, else the agent's screen. */
  async collectSummary(turnId: number, agent: AgentInfo): Promise<SummaryResult> {
    const turn = store.getTurn(turnId)!
    const conv = store.getConversation(turn.conversation_id)!
    const sessionId = agent.agent_session?.value ?? conv.agent_session_id
    if (isClaude(agent) && sessionId) {
      const file = findTranscript(sessionId)
      if (file) {
        const text = assistantTextSince(file, new Date(turn.sent_at))
        const block = turn.ask_summary ? findSummaryBlock(text.all, turn.summary_id) : null
        if (block !== null) return { summary: block, source: 'transcript' }
        if (text.final) return { summary: text.final, source: 'final-message' }
      }
    }
    if (!turn.ask_summary) return { summary: null, source: 'none' }
    let previous = -1
    for (const lines of SCREEN_LINES) {
      try {
        const res = await this.call<{ read: { text: string } }>('agent.read', { target: conv.pane_id, source: 'recent_unwrapped', lines, format: 'text' }, 20_000)
        const block = findSummaryBlock(res.read.text, turn.summary_id)
        if (block !== null) return { summary: block, source: 'screen' }
        if (res.read.text.length === previous) break
        previous = res.read.text.length
      } catch {
        break
      }
    }
    return { summary: null, source: 'none' }
  }

  /** After a restart: turns still open in SQLite get their waits back. */
  private recover() {
    for (const t of store.activeTurns()) {
      if (this.running.has(t.id)) continue
      if (t.status === 'sending') {
        // The server stopped mid-send: the text may or may not have been typed.
        store.updateTurn(t.id, { status: 'unconfirmed', error: friendlyError('timeout', ''), finished_at: new Date().toISOString() })
        this.emitConversation(t.conversation_id)
        continue
      }
      void this.runTurn(t.id, {})
    }
  }

  async focus(paneId: string) {
    await this.call('agent.focus', { target: paneId })
  }

  async screen(paneId: string): Promise<string> {
    const res = await this.call<{ read: { text: string } }>('agent.read', { target: paneId, source: 'visible', format: 'text' })
    return res.read.text
  }

  dispose() {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
    this.control?.close()
    this.control = null
    this.listeners.clear()
  }
}

function friendlyError(code: string, message: string): string {
  switch (code) {
    case 'agent_prompt_stalled':
      return 'herdr didn’t see the agent start within 5 seconds. The text may still have been typed: check the agent before sending again.'
    case 'timeout':
      return 'herdr didn’t confirm the prompt in time. Check the agent before sending again.'
    case 'agent_blocked':
      return 'The agent was waiting at a question, so nothing was sent.'
    case 'agent_not_running':
    case 'not_found':
      return 'The agent exited before it finished.'
    default:
      return message
  }
}
