import { create } from 'zustand'
import type { Agent, Conversation } from './model'

export interface HerdrState {
  /** null: not tried yet; false: can't reach the server plugin or herdr. */
  connected: boolean | null
  error: string | null
  agents: Agent[]
  conversations: Conversation[]
  openId: number | null
  filter: string | null
}

export const useHerdrStore = create<HerdrState>(() => ({
  connected: null,
  error: null,
  agents: [],
  conversations: [],
  openId: null,
  filter: null,
}))

export function upsertConversation(c: Conversation) {
  useHerdrStore.setState((s) => {
    const rest = s.conversations.filter((x) => x.id !== c.id)
    return { conversations: [c, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }
  })
}

/** The note's most recent open conversation (any agent). */
export function conversationForNote(noteId: number): Conversation | undefined {
  return useHerdrStore.getState().conversations.find((c) => c.noteId === noteId)
}

export function agentFor(paneId: string): Agent | undefined {
  return useHerdrStore.getState().agents.find((a) => a.paneId === paneId)
}
