import { memo, useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Icon } from '../../components/Icon'
import { Kbd } from '../../components/ui/Kbd'
import type { BoardActions } from './index'
import {
  AGENT_CHIP,
  COLUMNS,
  agentLabel,
  clock,
  columnOf,
  duration,
  kindName,
  lastTurn,
  type Agent,
  type ColumnId,
  type Conversation,
  type Turn,
} from './model'
import { useHerdrStore } from './store'
import styles from './AgentsBoard.module.css'

/** The Agents board: every note-to-agent conversation in four columns that follow herdr's state. */
export default function AgentsBoard({ actions }: { actions: BoardActions }) {
  const { agents, conversations, connected, error, openId, filter } = useHerdrStore()
  const agentByPane = useMemo(() => new Map(agents.map((a) => [a.paneId, a])), [agents])
  const visible = filter ? conversations.filter((c) => c.paneId === filter) : conversations
  const open = openId != null ? conversations.find((c) => c.id === openId) : undefined
  const current = actions.currentNote()

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, Conversation[]> = { shared: [], working: [], blockers: [], completed: [] }
    for (const c of visible) map[columnOf(c, agentByPane.get(c.paneId))].push(c)
    return map
  }, [visible, agentByPane])

  const unread = byColumn.completed.filter((c) => !c.seen).length
  const summary = `${byColumn.working.length} working · ${byColumn.blockers.length} need you · ${unread} new ${unread === 1 ? 'summary' : 'summaries'}`
  const canArchive = byColumn.completed.some((c) => c.seen)

  const openCard = (c: Conversation) => {
    useHerdrStore.setState({ openId: c.id })
    actions.markSeen(c.id)
  }

  return (
    <div className={styles.board}>
      <header className={styles.head}>
        <Icon name="terminal" size={18} />
        <h2 className={styles.title}>Agents</h2>
        <span className={styles.summary}>{summary}</span>
        <span className={styles.spacer} />
        <span className={styles.conn} title={error ?? undefined}>
          <span className={styles.dot} style={tone(connected === false ? 'red' : connected ? 'green' : 'gray')} />
          {connected === false ? 'herdr unreachable' : `herdr · ${agents.length} agent${agents.length === 1 ? '' : 's'}`}
        </span>
        <button type="button" className={styles.iconButton} onClick={actions.close} aria-label="Close the Agents board">
          <Icon name="xmark" size={14} strokeWidth={2} />
        </button>
      </header>

      {connected === false && error && (
        <div className={styles.banner} role="status">
          <Icon name="exclamationmark.triangle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {agents.length > 0 && (
        <div className={styles.strip} role="group" aria-label="Filter by agent">
          <button type="button" className={`${styles.chip} ${filter ? '' : styles.chipOn}`} onClick={() => useHerdrStore.setState({ filter: null })}>
            All agents
          </button>
          {agents.map((a) => (
            <button
              key={a.paneId}
              type="button"
              className={`${styles.chip} ${filter === a.paneId ? styles.chipOn : ''}`}
              title={`${kindName(a.kind)} · ${a.cwd ?? ''} · ${a.paneId} · ${AGENT_CHIP[a.status].label}`}
              onClick={() => useHerdrStore.setState({ filter: filter === a.paneId ? null : a.paneId })}
            >
              <span className={styles.dot} style={tone(AGENT_CHIP[a.status].tone)} />
              {agentLabel(a)}
              <span className={styles.chipSub}>{kindName(a.kind)}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.main}>
        <div className={styles.columns}>
          {COLUMNS.map((col) => {
            const cards = byColumn[col.id]
            return (
              <section key={col.id} className={styles.column} aria-label={col.name}>
                <div className={styles.colHead}>
                  <span className={styles.dot} style={tone(col.tone)} />
                  <b>{col.name}</b>
                  <span className={styles.count}>{cards.length}</span>
                </div>
                <div className={styles.colHint}>{col.hint}</div>
                {col.id === 'shared' && current && (
                  <button type="button" className={styles.tool} onClick={actions.shareCurrent}>
                    <b>
                      <Icon name="plus" size={13} strokeWidth={2} />
                      <span className={styles.toolTitle}>Share “{current.title}”</span>
                      <Kbd combo="Ctrl+Alt+KeyG" subtle />
                    </b>
                    <span>{conversations.some((c) => c.noteId === current.id) ? 'Sends the paragraphs added since the last send.' : 'Pick a herdr agent for this note.'}</span>
                  </button>
                )}
                {col.id === 'completed' && canArchive && (
                  <button type="button" className={`${styles.tool} ${styles.toolSolid}`} onClick={actions.archiveSeen}>
                    <b>Archive read</b>
                    <span>Takes read conversations off the board.</span>
                  </button>
                )}
                <div className={styles.cards}>
                  {cards.map((c) => (
                    <Card key={c.id} c={c} agent={agentByPane.get(c.paneId)} selected={c.id === openId} onOpen={() => openCard(c)} />
                  ))}
                  {cards.length === 0 && <div className={styles.empty}>{col.id === 'blockers' ? 'Nothing needs you.' : 'None'}</div>}
                </div>
              </section>
            )
          })}
        </div>
        {open && <Drawer c={open} agent={agentByPane.get(open.paneId)} actions={actions} />}
      </div>

      {conversations.length === 0 && connected !== false && (
        <div className={styles.footHint}>
          Share a note with <Kbd combo="Ctrl+Alt+KeyG" subtle /> to start. Each send asks the agent for a summary of what it implemented; it appears here when the agent finishes.
        </div>
      )}
    </div>
  )
}

function tone(t: string) {
  return { ['--tone' as string]: `var(--system-${t})` }
}

const Card = memo(function Card({ c, agent, selected, onOpen }: { c: Conversation; agent?: Agent; selected: boolean; onOpen: () => void }) {
  const t = lastTurn(c)
  const column = columnOf(c, agent)
  const who = agentLabel(agent, c.agentName ?? c.paneId)
  let body = ''
  let foot = ''
  let chip: { label: string; tone: string } | null = null
  let spin = false
  const turns = c.turns.length > 1 ? ` · ${c.turns.length} turns` : ''
  if (t) {
    if (t.status === 'sending') {
      body = sentLine(t)
      if (agent?.status === 'working') {
        foot = `Queued behind its current task · ${clock(t.sentAt)}`
        chip = { label: 'Queued', tone: 'gray' }
      } else {
        foot = 'Sending through herdr…'
        spin = true
      }
    } else if (t.status === 'unconfirmed') {
      body = t.error ?? ''
      foot = `Shared ${clock(t.sentAt)}`
      chip = { label: 'Check agent', tone: 'gray' }
    } else if (column === 'working') {
      body = sentLine(t)
      if (agent?.status === 'unknown') {
        foot = 'herdr can’t tell if it’s still working'
        chip = { label: 'Unknown', tone: 'gray' }
      } else {
        foot = `Since ${clock(t.startedAt ?? t.sentAt)}${turns}`
        spin = true
      }
    } else if (column === 'blockers') {
      body = 'Waiting at an approval or a question. Answer it in herdr.'
      foot = `Waiting since ${clock(t.startedAt ?? t.sentAt)}`
      chip = { label: 'Needs you', tone: 'red' }
    } else if (t.status === 'failed') {
      body = t.error ?? 'The agent stopped before it finished.'
      foot = clock(t.finishedAt)
      chip = { label: 'Didn’t finish', tone: 'red' }
    } else {
      const sm = t.summary ?? ''
      body = sm ? `${t.summarySource === 'final-message' ? 'Final message: ' : ''}${plain(sm)}` : 'Done, no summary. Open the agent in herdr to see what it did.'
      foot = `${clock(t.finishedAt)} · ${duration(t.startedAt ?? t.sentAt, t.finishedAt)}${t.summarySource === 'final-message' ? ' · no summary block' : ''}${turns}`
    }
  }
  const cls = [styles.card, selected ? styles.cardSelected : '', column === 'blockers' ? styles.cardBlocked : '', column === 'completed' && c.seen ? styles.cardRead : '']
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={cls} onClick={onOpen}>
      <span className={styles.cardTop}>
        <span className={styles.cardTitle}>{c.noteTitle}</span>
        {column === 'completed' && !c.seen && <span className={styles.unread} title="New summary" />}
      </span>
      <span className={styles.cardAgent}>
        <span className={styles.dot} style={tone(agent ? AGENT_CHIP[agent.status].tone : 'gray')} />
        {who} · {kindName(agent?.kind ?? c.agentKind)} · {c.paneId}
      </span>
      {body && <span className={styles.cardBody}>{body}</span>}
      <span className={styles.cardFoot}>
        {spin && <span className={styles.spin} aria-hidden="true" />}
        <span className={styles.grow}>{foot}</span>
        {chip && (
          <span className={styles.badge} style={tone(chip.tone)}>
            {chip.label}
          </span>
        )}
      </span>
    </button>
  )
})

function sentLine(t: Turn): string {
  const parts = [`${t.sentHashes.length || 1} paragraph${t.sentHashes.length > 1 ? 's' : ''} sent`]
  if (t.attachments.length) parts.push(`${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

/** First lines of Markdown as plain text, for a card. */
function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function Drawer({ c, agent, actions }: { c: Conversation; agent?: Agent; actions: BoardActions }) {
  const who = agentLabel(agent, c.agentName ?? c.paneId)
  const t = lastTurn(c)
  const blocked = columnOf(c, agent) === 'blockers'
  const [screen, setScreen] = useState<string | null>(null)

  useEffect(() => {
    setScreen(null)
    if (!blocked) return
    let live = true
    actions.screen(c.paneId).then(
      (text) => live && setScreen(text),
      () => live && setScreen(''),
    )
    return () => {
      live = false
    }
  }, [blocked, c.paneId, actions])

  return (
    <aside className={styles.drawer} aria-label={`Conversation: ${c.noteTitle}`}>
      <div className={styles.drawerHead}>
        <div className={styles.drawerTitle}>
          <b>{c.noteTitle}</b>
          <span>
            {who} · {kindName(agent?.kind ?? c.agentKind)} · {agent?.cwd ?? c.agentCwd ?? ''} · {c.paneId}
          </span>
        </div>
        <button type="button" className={styles.iconButton} onClick={() => useHerdrStore.setState({ openId: null })} aria-label="Close conversation">
          <Icon name="xmark" size={13} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.turns}>
        {c.turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} c={c} who={who} blockedNow={blocked && turn === t} screen={screen} actions={actions} />
        ))}
      </div>
      <div className={styles.drawerFoot}>
        <span className={styles.footText}>{blocked ? `${who} needs you. Answer it in herdr before sending more.` : 'Sends the paragraphs added to the note since the last send.'}</span>
        {c.noteId != null && (
          <button type="button" className={styles.button} onClick={() => actions.openNote(c.noteId!)}>
            Open note
          </button>
        )}
        <button type="button" className={styles.button} onClick={() => actions.focusAgent(c.paneId)}>
          Open in herdr
        </button>
        {!blocked && c.noteId != null && (
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => actions.followUp(c.id)}>
            Send follow-up
          </button>
        )}
      </div>
    </aside>
  )
}

function TurnView({ turn, c, who, blockedNow, screen, actions }: { turn: Turn; c: Conversation; who: string; blockedNow: boolean; screen: string | null; actions: BoardActions }) {
  const mode = actions.addMode()
  const added = actions.isAdded(turn.id)
  return (
    <div className={styles.turn}>
      <div className={styles.sent}>
        <span className={styles.who}>You · {clock(turn.sentAt)}</span>
        {sentLine(turn)}
        {turn.askSummary ? ', asked for a summary' : ''}
        {turn.attachments.length > 0 && <span className={styles.files}>{turn.attachments.map((a) => a.label).join(' · ')}</span>}
        {turn.attachmentsNote && <span className={styles.files}>Attachments skipped: {turn.attachmentsNote}</span>}
      </div>

      {(turn.status === 'sending' || turn.status === 'working') && !blockedNow && (
        <div className={styles.working}>
          <span className={styles.spin} aria-hidden="true" />
          {turn.status === 'sending' ? 'Sending through herdr…' : `${who} is working · since ${clock(turn.startedAt ?? turn.sentAt)}`}
        </div>
      )}

      {(turn.status === 'blocked' || blockedNow) && (
        <div className={`${styles.callout} ${styles.calloutRed}`}>
          <span>
            <b>{who} needs you.</b> Answer it in herdr; this card moves on by itself once the agent works again.
          </span>
          {blockedNow && <pre className={styles.term}>{screen === null ? 'Reading the agent’s screen…' : screen || 'Couldn’t read the screen.'}</pre>}
          <div className={styles.row}>
            <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => actions.focusAgent(c.paneId)}>
              Open in herdr
            </button>
          </div>
        </div>
      )}

      {(turn.status === 'unconfirmed' || turn.status === 'failed') && (
        <div className={`${styles.callout} ${turn.status === 'failed' ? styles.calloutRed : ''}`}>
          <span>
            <b>{turn.status === 'failed' ? 'Didn’t finish.' : 'Not confirmed.'}</b> {turn.error}
          </span>
        </div>
      )}

      {turn.status === 'done' && (
        <div className={styles.reply}>
          <div className={styles.replyHead}>
            <b>{turn.summarySource === 'final-message' ? 'Final message' : 'Summary'}</b>
            <span>
              {who} · {clock(turn.finishedAt)} · {duration(turn.startedAt ?? turn.sentAt, turn.finishedAt)}
              {turn.summarySource === 'transcript' ? ' · from Claude’s transcript' : turn.summarySource === 'screen' ? ' · from the screen' : turn.summarySource === 'final-message' ? ' · no summary block' : ''}
            </span>
          </div>
          {turn.summary ? (
            <>
              {turn.summarySource === 'final-message' && <p className={styles.note}>The agent didn’t write a summary block, so this is its final message, whole.</p>}
              <SummaryMarkdown text={turn.summary} />
              <div className={styles.row}>
                <button type="button" className={styles.button} onClick={() => actions.copy(turn.summary!)}>
                  Copy
                </button>
                {added ? (
                  <span className={styles.added}>Added to the note</span>
                ) : (
                  mode !== 'off' &&
                  c.noteId != null && (
                    <button type="button" className={styles.button} onClick={() => actions.addSummary(c.id, turn.id)}>
                      Add summary to note
                    </button>
                  )
                )}
              </div>
            </>
          ) : (
            <p className={styles.note}>No summary found. Open the agent in herdr to see what it did.</p>
          )}
        </div>
      )}
    </div>
  )
}

const SummaryMarkdown = memo(function SummaryMarkdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked(text, { async: false, gfm: true }) as string), [text])
  return <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: html }} />
})
