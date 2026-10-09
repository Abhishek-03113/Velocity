/** Platform detection + key-label helpers shared by shortcuts, tooltips and docs. */

const nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined

export const isMac: boolean = nav
  ? /Mac|iPhone|iPad|iPod/.test(
      (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
        nav.platform ??
        nav.userAgent,
    )
  : false

export const isTouch: boolean =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true

/** Display glyphs for modifier tokens used in shortcut definitions. */
const MAC_GLYPHS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
}

const PC_GLYPHS: Record<string, string> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
}

const KEY_GLYPHS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '↩',
  Escape: 'Esc',
  Backspace: '⌫',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Comma: ',',
  Period: '.',
  Space: 'Space',
  Tab: 'Tab',
}

/**
 * Split a combo such as `Mod+Shift+KeyF` into display tokens.
 * Mac renders glyphs (⌘⇧F); other platforms render words (Ctrl+Shift+F).
 */
export function comboTokens(combo: string): string[] {
  const parts = combo.split('+')
  const glyphs = isMac ? MAC_GLYPHS : PC_GLYPHS
  return parts.map((part) => {
    if (glyphs[part]) return glyphs[part]
    if (KEY_GLYPHS[part]) return KEY_GLYPHS[part]
    if (part.startsWith('Key')) return part.slice(3)
    if (part.startsWith('Digit')) return part.slice(5)
    return part
  })
}

export function comboLabel(combo: string): string {
  const tokens = comboTokens(combo)
  return isMac ? tokens.join('') : tokens.join('+')
}
