import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EASE, animate } from '../../lib/motion'

/**
 * The orange "unsaved changes" dot. It pops in (0 → 1.25 → 1) and, once the note
 * is saved, squashes flat before it disappears instead of blinking out.
 */
export function DirtyDot({ dirty, className, title = 'Unsaved changes' }: { dirty: boolean; className: string; title?: string }) {
  const [shown, setShown] = useState(dirty)
  const ref = useRef<HTMLSpanElement>(null)
  const appeared = useRef(dirty)

  useEffect(() => {
    if (dirty) setShown(true)
  }, [dirty])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (dirty) {
      if (appeared.current) return
      appeared.current = true
      animate(el, [{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: 0.6 }, { transform: 'scale(1)' }], {
        duration: 200,
        easing: EASE.out,
      })
      return
    }
    appeared.current = false
    const squash = animate(
      el,
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(1.5, 0.5)', opacity: 1, offset: 0.4 },
        { transform: 'scale(0)', opacity: 0 },
      ],
      { duration: 220, easing: EASE.inOut, fill: 'forwards' },
    )
    if (!squash) {
      setShown(false)
      return
    }
    squash.onfinish = () => setShown(false)
    return () => {
      if (squash.playState !== 'finished') squash.cancel()
    }
  }, [dirty, shown])

  if (!shown) return null
  return <span ref={ref} className={className} aria-label={dirty ? title : undefined} title={dirty ? title : undefined} />
}
