import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_INDEX_KEY, LEGACY_PREFIX, migrateLegacyBoards } from './boardMigration'

const scene = { elements: [{ id: 'a' }], appState: {} }

function seed(entries: Record<string, string>) {
  localStorage.clear()
  for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v)
}

describe('legacy whiteboard migration', () => {
  beforeEach(() => localStorage.clear())

  it('uploads boards for notes without a server board, then clears the keys', async () => {
    seed({
      [`${LEGACY_PREFIX}1`]: JSON.stringify(scene),
      [`${LEGACY_PREFIX}2`]: JSON.stringify(scene),
      [LEGACY_INDEX_KEY]: '[1,2]',
      unrelated: 'keep',
    })
    const put = vi.fn().mockResolvedValue(undefined)
    const n = await migrateLegacyBoards({
      storage: localStorage,
      notes: [{ id: 1 }, { id: 2, has_whiteboard: false }],
      put,
    })
    expect(n).toBe(2)
    expect(put).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(`${LEGACY_PREFIX}1`)).toBeNull()
    expect(localStorage.getItem(LEGACY_INDEX_KEY)).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
  })

  it('keeps the server copy when one exists and drops orphans', async () => {
    seed({
      [`${LEGACY_PREFIX}1`]: JSON.stringify(scene),
      [`${LEGACY_PREFIX}99`]: JSON.stringify(scene),
      [`${LEGACY_PREFIX}-3`]: JSON.stringify(scene),
    })
    const put = vi.fn().mockResolvedValue(undefined)
    await migrateLegacyBoards({ storage: localStorage, notes: [{ id: 1, has_whiteboard: true }], put })
    expect(put).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('keeps keys whose upload fails and is idempotent on the next run', async () => {
    seed({
      [`${LEGACY_PREFIX}1`]: JSON.stringify(scene),
      [`${LEGACY_PREFIX}2`]: JSON.stringify(scene),
      [LEGACY_INDEX_KEY]: '[1,2]',
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const put = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const notes = [{ id: 1 }, { id: 2 }]
    expect(await migrateLegacyBoards({ storage: localStorage, notes, put })).toBe(1)
    expect(localStorage.getItem(`${LEGACY_PREFIX}1`)).not.toBeNull()
    expect(localStorage.getItem(`${LEGACY_PREFIX}2`)).toBeNull()
    expect(localStorage.getItem(LEGACY_INDEX_KEY)).not.toBeNull()

    expect(await migrateLegacyBoards({ storage: localStorage, notes, put })).toBe(1)
    expect(localStorage.length).toBe(0)
    expect(await migrateLegacyBoards({ storage: localStorage, notes, put })).toBe(0)
    err.mockRestore()
  })

  it('discards corrupt scenes', async () => {
    seed({ [`${LEGACY_PREFIX}1`]: '{not json', [`${LEGACY_PREFIX}2`]: '{"foo":1}' })
    const put = vi.fn()
    await migrateLegacyBoards({ storage: localStorage, notes: [{ id: 1 }, { id: 2 }], put })
    expect(put).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
})
