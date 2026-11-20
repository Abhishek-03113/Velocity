import { beforeEach, describe, expect, it } from 'vitest'
import { recentCommandIds, recordCommand, suggestedCommandIds } from './recentCommands'

beforeEach(() => localStorage.clear())

describe('recent commands', () => {
  it('keeps the most recent first without duplicates', () => {
    recordCommand('a')
    recordCommand('b')
    recordCommand('a')
    expect(recentCommandIds()).toEqual(['a', 'b'])
  })

  it('limits what it returns and what it keeps', () => {
    for (let i = 0; i < 20; i++) recordCommand(`c${i}`)
    expect(recentCommandIds()).toEqual(['c19', 'c18', 'c17', 'c16', 'c15'])
    expect(recentCommandIds(100)).toHaveLength(12)
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('velocity.commands.recent.v1', '{nope')
    expect(recentCommandIds()).toEqual([])
    localStorage.setItem('velocity.commands.recent.v1', JSON.stringify([1, 'x', null]))
    expect(recentCommandIds()).toEqual(['x'])
  })
})

describe('suggested commands', () => {
  it('suggests note actions only when a note is open', () => {
    expect(suggestedCommandIds({ noteOpen: true, tileCount: 1 })).toContain('note.export')
    expect(suggestedCommandIds({ noteOpen: false, tileCount: 1 })).not.toContain('note.export')
  })

  it('suggests zoom with several tiles and a split with one', () => {
    expect(suggestedCommandIds({ noteOpen: true, tileCount: 3 })).toContain('tile.zoom')
    expect(suggestedCommandIds({ noteOpen: true, tileCount: 1 })).toContain('tile.splitRight')
  })
})
