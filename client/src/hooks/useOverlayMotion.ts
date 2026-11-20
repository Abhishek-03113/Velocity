import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { EASE, animate, flipFrom, recentPointer, reducedMotion, reversible, type Reversible } from '../lib/motion'

/**
 * Entrance and exit for a modal panel (sheet, alert):
 * - Origin awareness: opened by a pointer press, it grows out of that point
 *   (the button that was clicked) and returns there on close. Opened from the
 *   keyboard, it keeps the centred pop.
 * - Interruptible: closing mid-open plays the same animation backwards from its
 *   current frame. `requestClose(done)` calls `done` once the exit has finished
 *   (immediately under reduced motion).
 */
export function useOverlayMotion(
  panel: RefObject<HTMLElement | null>,
  backdrop: RefObject<HTMLElement | null>,
  key: unknown = true,
): { requestClose: (done: () => void) => void; closing: () => boolean } {
  const motion = useRef<Reversible | null>(null)
  const isClosing = useRef(false)

  useLayoutEffect(() => {
    const el = panel.current
    if (!el || !key) return
    isClosing.current = false
    motion.current?.animation?.cancel()
    const origin = recentPointer()
    if (origin) {
      const rect = el.getBoundingClientRect()
      const f = flipFrom({ left: origin.x - 14, top: origin.y - 14, width: 28, height: 28 }, rect)
      const s = Math.max(0.06, Math.min(f.sx, f.sy))
      motion.current = reversible(
        el,
        [
          { transform: `translate(${f.dx}px, ${f.dy}px) scale(${s})`, opacity: 0 },
          { opacity: 1, offset: 0.35 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 260, easing: EASE.spring },
      )
    } else {
      motion.current = reversible(
        el,
        [
          { transform: 'translateY(-6px) scale(0.98)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 200, easing: EASE.spring },
      )
    }
  }, [panel, key])

  const requestClose = useCallback(
    (done: () => void) => {
      if (isClosing.current) return
      isClosing.current = true
      const m = motion.current
      if (!m?.animation || reducedMotion()) {
        done()
        return
      }
      const bd = backdrop.current
      if (bd) {
        const from = getComputedStyle(bd).opacity
        animate(bd, [{ opacity: from }, { opacity: 0 }], { duration: 180, easing: EASE.inOut, fill: 'forwards' })
        bd.style.pointerEvents = 'none'
      }
      m.reverse(done, 1.4)
    },
    [backdrop],
  )

  return { requestClose, closing: () => isClosing.current }
}
