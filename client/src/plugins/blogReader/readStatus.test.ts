import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(async () => ({ success: true, data: [] })),
    post: vi.fn(async () => ({ success: true })),
    put: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({ success: true })),
  },
}))

import { useEditorStore } from '../../store/editorStore'
import { usePluginStore } from '../../store/pluginStore'
import { noteBadgeFor, pluginCommands, startPlugins, useBadgeVersion } from '../host'
import type { Paste } from '../../types'

const BLOG = `# A Post\n\n> [Example](https://example.com/post) · Ada\n> Saved 2026-10-12 · 3 min read\n\n---\n\nBody\n`

function note(id: number, content: string, extra: Partial<Paste> = {}): Paste {
  return { id, title: `Note ${id}`, content, dirty: false, ...extra }
}

/** Badges appear once the lazily-imported note helpers have loaded. */
async function settle() {
  await vi.waitFor(() => expect(noteBadgeFor(1)).not.toBeNull())
}

let stop: () => void

beforeEach(async () => {
  localStorage.clear()
  usePluginStore.setState({ enabled: {}, settings: {} })
  useEditorStore.setState({ pastes: [note(1, BLOG), note(2, 'Just a note')], activeId: 1 })
  stop = startPlugins()
  await settle()
})

afterEach(() => stop())

describe('Blog Reader read status', () => {
  it('marks blog notes unread (blue) and leaves other notes alone', () => {
    expect(noteBadgeFor(1)).toMatchObject({ label: 'Unread', tone: 'blue', title: 'Mark as Read' })
    expect(noteBadgeFor(2)).toBeNull()
  })

  it('toggles read state from the badge, persists it and notifies the UI', () => {
    const before = useBadgeVersion.getState().version
    noteBadgeFor(1)!.onClick!()
    expect(noteBadgeFor(1)).toMatchObject({ label: 'Read', tone: 'green', title: 'Mark as Unread' })
    expect(useBadgeVersion.getState().version).toBeGreaterThan(before)
    expect(JSON.parse(localStorage.getItem('velocity.plugin.blog-reader.v1')!).read).toHaveProperty('1')

    noteBadgeFor(1)!.onClick!()
    expect(noteBadgeFor(1)).toMatchObject({ label: 'Unread', tone: 'blue' })
  })

  it('offers a toggle command only for blog notes', () => {
    const toggle = pluginCommands().find((c) => c.id === 'plugin.blog-reader.toggleRead')!
    expect(toggle.enabled!()).toBe(true)
    toggle.run()
    expect(noteBadgeFor(1)?.label).toBe('Read')

    useEditorStore.setState({ activeId: 2 })
    expect(toggle.enabled!()).toBe(false)
  })

  it('keeps read state when a new note swaps its temp id for the server id', () => {
    useEditorStore.setState({ pastes: [note(-5, BLOG, { cid: 't-5' })], activeId: -5 })
    noteBadgeFor(-5)!.onClick!()
    useEditorStore.setState({ pastes: [note(42, BLOG, { cid: 't-5' })], activeId: 42 })
    expect(noteBadgeFor(42)?.label).toBe('Read')
  })

  it('hides the colour coding when the setting is off', () => {
    usePluginStore.getState().setSetting('blog-reader', 'readStatus', false)
    expect(noteBadgeFor(1)).toBeNull()
  })
})
