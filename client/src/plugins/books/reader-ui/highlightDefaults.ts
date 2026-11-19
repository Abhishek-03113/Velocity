import { HIGHLIGHT_COLORS, type HighlightColor, type HighlightStyle } from '../reader/types'

export interface HighlightDefaults {
  style: HighlightStyle
  color: HighlightColor
}

export const HIGHLIGHT_DEFAULTS_KEY = 'highlightDefaults'
export const HIGHLIGHT_STYLES: readonly HighlightStyle[] = ['highlight', 'underline', 'strike', 'squiggle', 'sketch', 'curly', 'double', 'dotted', 'dashed']
export const FALLBACK_DEFAULTS: HighlightDefaults = { style: 'highlight', color: 'yellow' }

interface Storage {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

/** The last-used highlight style and colour (`ctx.storage('highlightDefaults')`), validated. */
export function loadHighlightDefaults(storage: Storage): HighlightDefaults {
  try {
    const raw = storage.get<Partial<HighlightDefaults>>(HIGHLIGHT_DEFAULTS_KEY)
    return {
      style: HIGHLIGHT_STYLES.includes(raw?.style as HighlightStyle) ? (raw!.style as HighlightStyle) : FALLBACK_DEFAULTS.style,
      color: HIGHLIGHT_COLORS.includes(raw?.color as HighlightColor) ? (raw!.color as HighlightColor) : FALLBACK_DEFAULTS.color,
    }
  } catch {
    return { ...FALLBACK_DEFAULTS }
  }
}

export function saveHighlightDefaults(storage: Storage, value: HighlightDefaults): void {
  try {
    storage.set(HIGHLIGHT_DEFAULTS_KEY, value)
  } catch (err) {
    console.error('[books] could not save highlight defaults', err)
  }
}
