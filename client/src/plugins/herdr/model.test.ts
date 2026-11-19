import { describe, expect, it } from 'vitest'
import { badgeFor, columnOf, type Agent, type Conversation, type Turn } from './model'

const turn = (status: Turn['status'], extra: Partial<Turn> = {}): Turn => ({
  id: 1, status, sentAt: '2026-11-05T10:00:00Z', startedAt: null, finishedAt: null, sentHashes: ['a'],
  attachments: [], attachmentsNote: null, askSummary: true, summary: null, summarySource: null, error: null, ...extra,
})
const conv = (turns: Turn[], seen = true): Conversation => ({
  id: 1, noteId: 7, noteTitle: 'Fix test', paneId: 'w1:p2', agentName: 'reviewer', agentKind: 'claude', agentCwd: '/repo', seen, updatedAt: '', turns,
})
const agent = (status: Agent['status']): Agent => ({ paneId: 'w1:p2', name: 'reviewer', kind: 'claude', title: null, status, cwd: '/repo', hasSession: true })

describe('columnOf', () => {
  it('follows the latest turn, and herdr’s live state while working', () => {
    expect(columnOf(conv([turn('sending')]))).toBe('shared')
    expect(columnOf(conv([turn('unconfirmed')]))).toBe('shared')
    expect(columnOf(conv([turn('working')]), agent('working'))).toBe('working')
    expect(columnOf(conv([turn('working')]), agent('blocked'))).toBe('blockers')
    expect(columnOf(conv([turn('blocked')]))).toBe('blockers')
    expect(columnOf(conv([turn('done'), turn('working', { id: 2 })]), agent('working'))).toBe('working')
    expect(columnOf(conv([turn('done')]))).toBe('completed')
    expect(columnOf(conv([turn('failed')]))).toBe('completed')
  })
})

describe('badgeFor', () => {
  it('says what needs attention, with a word for every colour', () => {
    expect(badgeFor(conv([turn('done', { summary: 'x' })], false))).toEqual({ label: 'New summary', tone: 'green' })
    expect(badgeFor(conv([turn('done', { summary: 'x' })], true))).toEqual({ label: 'Summary', tone: 'green' })
    expect(badgeFor(conv([turn('blocked')]))).toEqual({ label: 'Needs you', tone: 'red' })
    expect(badgeFor(conv([turn('failed')]))).toEqual({ label: 'Didn’t finish', tone: 'red' })
    expect(badgeFor(conv([turn('unconfirmed')]))).toEqual({ label: 'Check agent', tone: 'gray' })
  })
})
