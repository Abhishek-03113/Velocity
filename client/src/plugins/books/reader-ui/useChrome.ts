import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/** Idle time before the chrome fades out in paged layout. */
export const CHROME_HIDE_MS = 3000
/** Pointer distance from the top / bottom edge that brings the chrome back. */
export const CHROME_EDGE_PX = 48

interface Options {
  /** Auto-hide applies (paged layout). In scroll layout the chrome is always visible. */
  autoHide: boolean
  /** The book is open: the idle timer only starts then. */
  ready: boolean
  /** Something (drawer, sheet, menu, toolbar) is open: the chrome stays. */
  hold: boolean
}

/** Moon+ style immersive chrome: hides after 3 s idle, returns on a centre tap, key press or edge hover. */
export function useChrome({ autoHide, ready, hold }: Options) {
  const [shown, setShown] = useState(true)
  const shownRef = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hovering = useRef(false)
  const live = useRef({ autoHide, ready, hold })
  live.current = { autoHide, ready, hold }

  const set = useCallback((next: boolean) => {
    shownRef.current = next
    setShown(next)
  }, [])

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const arm = useCallback(() => {
    clear()
    const { autoHide: a, ready: r, hold: h } = live.current
    if (!a || !r || h || hovering.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      set(false)
    }, CHROME_HIDE_MS)
  }, [set])

  useEffect(() => {
    if (!autoHide || hold) set(true)
    arm()
    return clear
  }, [autoHide, ready, hold, arm, set])

  const show = useCallback(() => {
    set(true)
    arm()
  }, [arm, set])

  const toggle = useCallback(() => {
    if (!live.current.autoHide) return
    if (shownRef.current) {
      clear()
      set(false)
    } else show()
  }, [set, show])

  /** Pointer moved over the tile: keep a visible chrome alive; near the top / bottom edge, bring it back. */
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!live.current.autoHide) return
      const rect = e.currentTarget.getBoundingClientRect()
      const nearEdge = e.clientY - rect.top < CHROME_EDGE_PX || rect.bottom - e.clientY < CHROME_EDGE_PX
      if (nearEdge || shownRef.current) show()
    },
    [show],
  )

  const hoverProps = {
    onPointerEnter: () => {
      hovering.current = true
      clear()
    },
    onPointerLeave: () => {
      hovering.current = false
      arm()
    },
  }

  return { visible: !autoHide || shown, show, toggle, onPointerMove, hoverProps }
}
