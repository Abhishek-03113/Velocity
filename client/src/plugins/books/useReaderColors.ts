import { useEffect, useState } from 'react'
import { useUiStore } from '../../store/uiStore'
import { domTokens, resolveColors } from './appearance'
import type { ReaderColors, ReaderTheme } from './reader/types'

const same = (a: ReaderColors, b: ReaderColors) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Concrete reader colours for a theme. Paper and Auto follow the live Velocity theme: they recompute after the
 * DOM attributes (`data-theme`, family, variant, accent) have been applied by the ui store.
 */
export function useReaderColors(theme: ReaderTheme): ReaderColors {
  const resolvedTheme = useUiStore((s) => s.resolvedTheme)
  const family = useUiStore((s) => s.prefs.themeFamily)
  const accent = useUiStore((s) => s.prefs.accent)
  const variants = useUiStore((s) => s.prefs.themeVariants)
  const [state, setState] = useState(() => ({ theme, colors: resolveColors(theme, domTokens()) }))

  // A reader-theme change resolves at once (the DOM is already current); app theme changes wait a frame.
  let current = state
  if (state.theme !== theme) {
    current = { theme, colors: resolveColors(theme, domTokens()) }
    setState(current)
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next = resolveColors(theme, domTokens())
      setState((prev) => (prev.theme === theme && same(prev.colors, next) ? prev : { theme, colors: next }))
    })
    return () => cancelAnimationFrame(frame)
  }, [theme, resolvedTheme, family, accent, variants])

  return current.colors
}
