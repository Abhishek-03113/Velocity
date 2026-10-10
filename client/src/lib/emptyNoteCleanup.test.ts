import { describe, expect, it } from 'vitest'
import { GRACE_MS, planEmptyNoteCleanup, type CleanupInput } from './emptyNoteCleanup'
import type { Paste } from '../types'

const NOW = Date.parse('2030-01-01T12:00:00Z')
const MIN = 60_000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

function note(id: number, over: Partial<Paste> = {}): Paste {
  return {
    id,
    title: 'Untitled',
    content: '',
    dirty: false,
    updated_at: iso(60 * MIN),
    ...over,
  }
}

function plan(pastes: Paste[], over: Partial<CleanupInput> = {}) {
  return planEmptyNoteCleanup({
    pastes,
    activeIds: new Set(),
    lastUsed: {},
    now: NOW,
    hasBoard: () => false,
    ...over,
  })
}

describe('planEmptyNoteCleanup', () => {
  it('keeps the 5 most recently used empty notes and deletes the rest', () => {
    // id n was last updated n * 10 minutes ago, so id 1 is the freshest.
    const pastes = Array.from({ length: 8 }, (_, i) => note(i + 1, { updated_at: iso((i + 1) * 10 * MIN) }))
    expect(new Set(plan(pastes))).toEqual(new Set([6, 7, 8]))
  })

  it('lets the client lastUsed stamp override updated_at in the ordering', () => {
    const pastes = Array.from({ length: 6 }, (_, i) => note(i + 1, { updated_at: iso((i + 1) * 10 * MIN) }))
    // Note 6 is the stalest by updated_at but was used a minute ago.
    expect(plan(pastes, { lastUsed: { 6: NOW - 2 * MIN } })).toEqual([5])
  })

  it('never deletes anything while 5 or fewer empty notes exist', () => {
    expect(plan([1, 2, 3, 4, 5].map((id) => note(id)))).toEqual([])
  })

  it('treats whitespace-only content as empty, and unloaded notes via the server flag', () => {
    const pastes = [
      note(1, { content: '  \n\t ' }),
      note(2, { content: undefined, is_empty: true }),
      note(3, { content: undefined, is_empty: false }),
      note(4, { content: undefined }), // unknown: protected
      note(5),
      note(6),
      note(7),
    ]
    const doomed = plan(pastes, { keep: 0 })
    expect(new Set(doomed)).toEqual(new Set([1, 2, 5, 6, 7]))
  })

  it('protects notes with content, an explicit title, or a whiteboard', () => {
    const pastes = [
      note(1, { content: 'hello' }),
      note(2, { title: 'Shopping' }),
      note(3, { has_whiteboard: true }),
      note(4),
      note(5),
    ]
    expect(plan(pastes, { keep: 0, hasBoard: (id) => id === 5 })).toEqual([4])
  })

  it('treats a blank title like Untitled', () => {
    expect(plan([note(1, { title: '  ' })], { keep: 0 })).toEqual([1])
  })

  it('protects active notes (tabs / tiles) and they do not count toward the 5', () => {
    const pastes = Array.from({ length: 7 }, (_, i) => note(i + 1, { updated_at: iso((i + 1) * 10 * MIN) }))
    // 1 and 2 are open; the 5 freshest of the rest (3..7) are kept.
    expect(plan(pastes, { activeIds: new Set([1, 2]) })).toEqual([])
    expect(plan(pastes, { activeIds: new Set([1, 2]), keep: 3 }).sort()).toEqual([6, 7])
  })

  it('protects dirty notes and notes with a pending sync', () => {
    const pastes = [note(1, { dirty: true }), note(2), note(3)]
    expect(plan(pastes, { keep: 0, pendingIds: new Set([2]) })).toEqual([3])
  })

  it('applies a grace period to fresh notes (created or used < 30s ago)', () => {
    const fresh = note(1, { created_at: iso(GRACE_MS - 1_000), updated_at: iso(GRACE_MS - 1_000) })
    const touched = note(2, { updated_at: iso(10 * MIN) })
    const settled = note(3, { created_at: iso(GRACE_MS + 1_000), updated_at: iso(GRACE_MS + 1_000) })
    expect(plan([fresh, touched, settled], { keep: 0, lastUsed: { 2: NOW - 5_000 } })).toEqual([3])
  })

  it('does not count grace-protected notes against the keep-5 budget', () => {
    const fresh = note(100, { created_at: iso(1_000), updated_at: iso(1_000) })
    const old = [1, 2, 3, 4, 5, 6].map((id) => note(id, { updated_at: iso(id * 10 * MIN) }))
    expect(plan([fresh, ...old])).toEqual([6])
  })

  it('handles local temp notes (negative ids) like any other', () => {
    const temps = [-1, -2, -3, -4, -5, -6, -7].map((id) =>
      note(id, { created_at: iso(10 * MIN), updated_at: iso(10 * MIN - id * 1000) }),
    )
    // -1 is the freshest, -7 the stalest.
    expect(new Set(plan(temps))).toEqual(new Set([-6, -7]))
  })
})
