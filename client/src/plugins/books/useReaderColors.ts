import { useEffect, useState } from 'react'
import { useUiStore } from '../../store/uiStore'
import { domTokens, resolveColors } from './appearance'
import type { ReaderColors, ReaderTheme } from './reader/types'

const same = (a: ReaderColors, b: ReaderColors) =>
  a.background === b.background && a.text === b.text && a.link === b.link && a.selection === b.selection && a.dark === b.dark

/**
 * Concrete reader colours for a theme. Auto follows the live Velocity theme: it recomputes after the DOM
 * attributes (`data-theme`, family, variant, accent) have been applied by the ui store.
 */
export function useReaderColors(theme: ReaderTheme): ReaderColors {
  const resolvedTheme = useUiStore((s) => s.resolvedTheme)
  const family = useUiStore((s) => s.prefs.themeFamily)
  const accent = useUiStore((s) => s.prefs.accent)
  const variants = useUiStore((s) => s.prefs.themeVariants)
  const [colors, setColors] = useState(() => resolveColors(theme, domTokens()))

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next = resolveColors(theme, domTokens())
      setColors((prev) => (same(prev, next) ? prev : next))
    })
    return () => cancelAnimationFrame(frame)
  }, [theme, resolvedTheme, family, accent, variants])

  return colors
}
