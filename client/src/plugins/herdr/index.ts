import { createElement, lazy, Suspense } from 'react'
import { usePluginStore } from '../../store/pluginStore'
import { PluginApiError } from '../transport'
import type { NoteBadge, PickItem, PluginContext, VelocityPlugin } from '../types'
import { AGENT_CHIP, agentLabel, badgeFor, kindName, lastTurn, type Agent, type Conversation, type HerdrEvent } from './model'
import { nextSend, outcomeSection } from './sent'
import { agentFor, conversationForNote, upsertConversation, useHerdrStore } from './store'

const AgentsBoard = lazy(() => import('./AgentsBoard'))

/** Turn ids whose summary was already added to the note in this browser. */
const ADDED_KEY = 'addedTurns'

export interface BoardActions {
  currentNote(): { id: number; title: string } | null
  shareCurrent(): void
  followUp(conversationId: number): void
  focusAgent(paneId: string): void
  markSeen(conversationId: number): void
  archiveSeen(): void
  addSummary(conversationId: number, turnId: number): void
  isAdded(turnId: number): boolean
  addMode(): 'off' | 'ask' | 'always'
  openNote(noteId: number): void
  copy(text: string): void
  screen(paneId: string): Promise<string>
  close(): void
}

const plugin: VelocityPlugin = {
  manifest: {
    id: 'herdr',
    name: 'Herdr',
    description: 'Share notes with coding agents running in herdr and follow them on the Agents board.',
    icon: 'terminal',
    version: '1.0.0',
  },
  settings: [
    {
      key: 'token',
      type: 'text',
      label: 'Access token',
      hint: 'Must match HERDR_CONNECTOR_TOKEN on the Velocity server',
      default: '',
      placeholder: 'Paste the token',
      secret: true,
    },
    {
      key: 'askSummary',
      type: 'toggle',
      label: 'Ask for a summary',
      hint: 'Each prompt ends by asking the agent for a summary of what it implemented, in a marked block. No length limit.',
      default: true,
    },
    {
      key: 'addToNote',
      type: 'choice',
      label: 'Add summary to note',
      hint: 'As an Outcome section under your prompt. Nothing else is ever written to the note.',
      default: 'ask',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'ask', label: 'Ask' },
        { value: 'always', label: 'Always' },
      ],
    },
    {
      key: 'whiteboard',
      type: 'toggle',
      label: 'Send the whiteboard',
      hint: 'A rendered PNG and the Excalidraw scene, as files in the agent’s folder',
      default: true,
    },
  ],

  activate(ctx: PluginContext) {
    const headers = () => ({ Authorization: `Bearer ${ctx.setting<string>('token').trim()}` })
    const hasToken = () => ctx.setting<string>('token').trim().length > 0
    let stopStream: (() => void) | null = null
    let disposed = false

    const reasonOf = (err: unknown): string => {
      if (err instanceof PluginApiError && err.status === 401) return 'Wrong herdr access token. Check Settings → Plugins → Herdr.'
      return err instanceof Error && err.message ? err.message : 'Something went wrong'
    }

    const added = (): Record<string, number> => ctx.storage.get<Record<string, number>>(ADDED_KEY) ?? {}
    const isAdded = (turnId: number) => turnId in added()

    // ---- live state ------------------------------------------------------
    const refresh = async () => {
      try {
        const [agents, conversations] = await Promise.all([
          ctx.api.get<Agent[]>('/agents', { headers: headers() }).catch(() => [] as Agent[]),
          ctx.api.get<Conversation[]>('/conversations', { headers: headers() }),
        ])
        useHerdrStore.setState({ agents, conversations })
        ctx.refreshBadges()
      } catch (err) {
        useHerdrStore.setState({ connected: false, error: reasonOf(err) })
      }
    }

    const onEvent = (event: string, data: string) => {
      if (event !== 'herdr') return
      let e: HerdrEvent
      try {
        e = JSON.parse(data)
      } catch {
        return
      }
      if (e.type === 'agents') useHerdrStore.setState({ agents: e.agents })
      else if (e.type === 'connection') useHerdrStore.setState({ connected: e.ok, error: e.ok ? null : e.error ?? 'herdr isn’t reachable' })
      else if (e.type === 'conversation') {
        const before = useHerdrStore.getState().conversations.find((c) => c.id === e.conversation.id)
        upsertConversation(e.conversation)
        announce(before, e.conversation)
      }
      ctx.refreshBadges()
    }

    /** Status-bar flashes on state changes, and Always-mode summaries. */
    const announce = (before: Conversation | undefined, after: Conversation) => {
      const was = before ? lastTurn(before) : undefined
      const now = lastTurn(after)
      if (!now || (was && was.id === now.id && was.status === now.status)) return
      const who = agentLabel(agentFor(after.paneId), after.agentName ?? after.paneId)
      if (now.status === 'done') {
        ctx.flash(now.summary ? `Summary from ${who}: ${after.noteTitle}` : `${who} finished “${after.noteTitle}” (no summary)`)
        if (now.summary && ctx.setting<string>('addToNote') === 'always' && !isAdded(now.id)) void addSummary(after.id, now.id)
      } else if (now.status === 'blocked') ctx.flash(`${who} needs you: ${after.noteTitle}`)
      else if (now.status === 'failed') ctx.flash(`${who} didn’t finish “${after.noteTitle}”`)
      else if (now.status === 'unconfirmed') ctx.flash(`Check ${who}: herdr couldn’t confirm the prompt`)
    }

    const startStream = () => {
      stopStream?.()
      stopStream = null
      if (!hasToken()) {
        useHerdrStore.setState({ connected: false, error: 'Add the herdr access token in Settings → Plugins → Herdr.' })
        return
      }
      void refresh()
      stopStream = ctx.api.stream('/events', {
        onEvent,
        onOpen: () => {
          useHerdrStore.setState({ error: null })
          void refresh()
        },
        onError: (err) => useHerdrStore.setState({ connected: false, error: reasonOf(err) }),
      }, { headers: headers() })
    }
    startStream()

    // Reconnect when the token changes.
    let lastToken = ctx.setting<string>('token')
    const stopWatch = usePluginStore.subscribe(() => {
      const token = ctx.setting<string>('token')
      if (token !== lastToken && !disposed) {
        lastToken = token
        startStream()
      }
    })

    // ---- sharing ---------------------------------------------------------
    const share = async (noteId: number, paneId: string) => {
      if (!hasToken()) {
        ctx.flash('Add the herdr access token in Settings → Plugins → Herdr first')
        return
      }
      const agent = agentFor(paneId)
      const who = agentLabel(agent, paneId)
      if (agent?.status === 'blocked') {
        ctx.flash(`${who} needs you. Answer it in herdr first.`)
        return
      }
      const title = ctx.notes.title(noteId) || 'Untitled'
      const markdown = await ctx.notes.content(noteId)
      const { conversations } = useHerdrStore.getState()
      const sameAgent = conversations.filter((c) => c.noteId === noteId && c.paneId === paneId)
      const sent = new Set(sameAgent.flatMap((c) => c.turns.flatMap((t) => t.sentHashes)))
      const out = nextSend({ title, markdown, sent, first: sameAgent.length === 0, selection: ctx.notes.selection(noteId) })
      if (!out) {
        ctx.flash('Nothing new to send. Write below the last sent paragraph, or select text to send.')
        return
      }
      const includeWhiteboard = ctx.setting<boolean>('whiteboard') && ctx.boards.has(noteId)
      ctx.activity(`Sharing “${title}” with ${who}…`)
      try {
        const whiteboardPng = includeWhiteboard ? await ctx.boards.exportPng(noteId) : null
        const conversation = await ctx.api.post<Conversation>(
          '/share',
          {
            noteId,
            noteTitle: title,
            paneId,
            text: out.text,
            hashes: out.hashes,
            askSummary: ctx.setting<boolean>('askSummary'),
            includeWhiteboard,
            whiteboardPng,
          },
          { headers: headers() },
        )
        upsertConversation(conversation)
        ctx.refreshBadges()
        const t = lastTurn(conversation)
        const files = t?.attachments.length ? ` with ${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}` : ''
        ctx.flash(t?.attachmentsNote ? `Shared with ${who}, but attachments were skipped: ${t.attachmentsNote}` : `Shared “${title}” with ${who}${files}`)
      } catch (err) {
        ctx.flash(reasonOf(err))
      } finally {
        ctx.activity(null)
      }
    }

    const pickAgent = (noteId: number) => {
      const { agents, connected, error } = useHerdrStore.getState()
      const current = conversationForNote(noteId)?.paneId
      const order = { idle: 0, done: 0, working: 1, unknown: 1, blocked: 2 } as const
      const section = { idle: 'Ready', done: 'Ready', working: 'Busy', unknown: 'Busy', blocked: 'Needs you' } as const
      const items: PickItem[] = [...agents]
        .sort((a, b) => order[a.status] - order[b.status])
        .map((a) => ({
          id: a.paneId,
          title: `${agentLabel(a)}${a.paneId === current ? ' · this note’s agent' : ''}`,
          detail: [kindName(a.kind), a.cwd, a.paneId, a.hasSession || a.kind !== 'claude' ? '' : 'no session id: summaries from the screen']
            .filter(Boolean)
            .join(' · '),
          icon: 'terminal',
          section: section[a.status],
          badge: AGENT_CHIP[a.status],
          disabled: a.status === 'blocked',
          hint: a.status === 'blocked' ? 'Needs you: answer it in herdr first' : a.status === 'working' ? 'Your note queues behind its current task' : undefined,
        }))
      const title = ctx.notes.title(noteId) || 'Untitled'
      ctx.pick({
        title: 'Share with',
        placeholder: `Share “${title}” with…`,
        icon: 'terminal',
        items,
        emptyText: connected === false && error ? error : 'No agents in herdr. Start one in a herdr pane.',
        footerHint: 'Agents that need you can’t take prompts',
        onPick: (paneId) => void share(noteId, paneId),
      })
    }

    const shareCurrent = (opts: { choose?: boolean } = {}) => {
      const noteId = ctx.notes.current()
      if (noteId == null) {
        ctx.flash('Open a note to share it')
        return
      }
      const existing = conversationForNote(noteId)
      if (existing && !opts.choose) void share(noteId, existing.paneId)
      else pickAgent(noteId)
    }

    // ---- board actions ---------------------------------------------------
    const markSeen = (id: number) => {
      const c = useHerdrStore.getState().conversations.find((x) => x.id === id)
      if (!c || c.seen) return
      upsertConversation({ ...c, seen: true })
      ctx.refreshBadges()
      void ctx.api.post(`/conversations/${id}/seen`, {}, { headers: headers() }).catch(() => {})
    }

    const addSummary = async (conversationId: number, turnId: number) => {
      const c = useHerdrStore.getState().conversations.find((x) => x.id === conversationId)
      const t = c?.turns.find((x) => x.id === turnId)
      if (!c || !t?.summary || c.noteId == null) return
      if (!ctx.notes.exists(c.noteId)) {
        ctx.flash('That note no longer exists')
        return
      }
      if (isAdded(turnId)) return
      const who = agentLabel(agentFor(c.paneId), c.agentName ?? c.paneId)
      await ctx.notes.append(c.noteId, outcomeSection(who, new Date(t.finishedAt ?? Date.now()), t.summary, t.summarySource === 'final-message'))
      const map = added()
      map[turnId] = Date.now()
      const keys = Object.keys(map)
      for (const k of keys.slice(0, Math.max(0, keys.length - 1000))) delete map[k]
      ctx.storage.set(ADDED_KEY, map)
      ctx.flash(`Summary added to “${c.noteTitle}”. It won’t be sent back.`)
      useHerdrStore.setState((s) => ({ conversations: [...s.conversations] }))
    }

    const actions: BoardActions = {
      currentNote: () => {
        const id = ctx.notes.current()
        return id == null ? null : { id, title: ctx.notes.title(id) || 'Untitled' }
      },
      shareCurrent: () => shareCurrent(),
      followUp: (id) => {
        const c = useHerdrStore.getState().conversations.find((x) => x.id === id)
        if (c?.noteId != null) void share(c.noteId, c.paneId)
      },
      focusAgent: (paneId) => {
        void ctx.api
          .post(`/agents/focus?pane=${encodeURIComponent(paneId)}`, {}, { headers: headers() })
          .then(() => ctx.flash(`Brought ${agentLabel(agentFor(paneId), paneId)} forward in herdr`))
          .catch((err) => ctx.flash(reasonOf(err)))
      },
      markSeen,
      archiveSeen: () => {
        void ctx.api
          .post<{ archived: number }>('/conversations/archive-seen', {}, { headers: headers() })
          .then((r) => {
            ctx.flash(r.archived ? `Archived ${r.archived} read conversation${r.archived > 1 ? 's' : ''}` : 'Nothing to archive')
            return refresh()
          })
          .catch((err) => ctx.flash(reasonOf(err)))
      },
      addSummary: (cid, tid) => void addSummary(cid, tid),
      isAdded,
      addMode: () => ctx.setting<string>('addToNote') as 'off' | 'ask' | 'always',
      openNote: (noteId) => {
        if (!ctx.notes.exists(noteId)) {
          ctx.flash('That note no longer exists')
          return
        }
        ctx.panel.close()
        ctx.notes.open(noteId)
      },
      copy: (text) => {
        void navigator.clipboard.writeText(text).then(
          () => ctx.flash('Summary copied'),
          () => ctx.flash('Couldn’t copy to the clipboard'),
        )
      },
      screen: (paneId) => ctx.api.get<{ text: string }>(`/agents/screen?pane=${encodeURIComponent(paneId)}`, { headers: headers() }).then((r) => r.text),
      close: () => ctx.panel.close(),
    }

    const openBoard = () => {
      if (ctx.panel.isOpen()) {
        ctx.panel.close()
        return
      }
      ctx.panel.open({
        title: 'Agents',
        render: () => createElement(Suspense, { fallback: null }, createElement(AgentsBoard, { actions })),
      })
      if (hasToken()) void refresh()
    }

    const noteBadge = (noteId: number): NoteBadge | null => {
      const c = conversationForNote(noteId)
      if (!c) return null
      const b = badgeFor(c, agentFor(c.paneId))
      return { ...b, title: `${b.label} · ${agentLabel(agentFor(c.paneId), c.agentName ?? c.paneId)} · open the Agents board`, onClick: openBoard }
    }

    return {
      commands: [
        { id: 'share', title: 'Share Note with Agent', keys: ['Ctrl+Alt+KeyG'], keywords: 'herdr claude codex agent send prompt', run: () => shareCurrent() },
        { id: 'share-other', title: 'Share Note with Another Agent…', keys: ['Ctrl+Alt+Shift+KeyG'], keywords: 'herdr agent send pick', run: () => shareCurrent({ choose: true }) },
        { id: 'board', title: 'Show Agents Board', keys: ['Ctrl+Alt+KeyA'], keywords: 'herdr kanban agents status', run: openBoard },
      ],
      noteBadge,
      dispose: () => {
        disposed = true
        stopStream?.()
        stopWatch()
        ctx.panel.close()
        useHerdrStore.setState({ connected: null, error: null, agents: [], conversations: [], openId: null, filter: null })
      },
    }
  },
}

export default plugin
