import { describe, expect, it } from 'vitest'
import { COMMANDS, matchCommand } from './commands'

function key(init: KeyboardEventInit & { code: string }, altGraph = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', init)
  Object.defineProperty(e, 'getModifierState', { value: (k: string) => k === 'AltGraph' && altGraph })
  return e
}

describe('command registry', () => {
  it('has unique ids and no duplicate key bindings', () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const combos = COMMANDS.flatMap((c) => c.keys ?? [])
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('every browser-reserved shortcut has a Ctrl+Alt alternative', () => {
    const reserved = ['Mod+KeyN', 'Mod+KeyW', 'Mod+Digit1']
    for (const combo of reserved) {
      const cmd = COMMANDS.find((c) => c.keys?.includes(combo))!
      expect(cmd.keys!.some((k) => k.startsWith('Ctrl+Alt+'))).toBe(true)
      // The working combo is the one we display.
      expect(cmd.keys![0]!.startsWith('Ctrl+Alt+')).toBe(true)
    }
  })

  it('matches by physical key code with exact modifiers', () => {
    expect(matchCommand(key({ code: 'KeyN', ctrlKey: true, altKey: true }))?.id).toBe('note.new')
    expect(matchCommand(key({ code: 'KeyN', ctrlKey: true, altKey: true, shiftKey: true }))?.id).toBe('note.newSplit')
    expect(matchCommand(key({ code: 'ArrowRight', ctrlKey: true, altKey: true }))?.id).toBe('tile.focusRight')
    expect(matchCommand(key({ code: 'KeyP', ctrlKey: true }))?.id).toBe('nav.quickOpen')
    expect(matchCommand(key({ code: 'KeyN' }))).toBeNull()
  })

  it('ignores AltGr so international characters can be typed', () => {
    expect(matchCommand(key({ code: 'KeyQ', ctrlKey: true, altKey: true }, true))).toBeNull()
  })
})
