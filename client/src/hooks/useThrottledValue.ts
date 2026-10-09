import { useEffect, useRef, useState } from 'react'

/**
 * Follow `value`, but update at most once per `ms` (leading + trailing).
 * Used for views that shouldn't re-render on every keystroke (notes list,
 * counters) while still converging on the latest value.
 */
export function useThrottledValue<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const now = Date.now()
    const wait = ms - (now - last.current)
    if (wait <= 0) {
      last.current = now
      setThrottled(value)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      last.current = Date.now()
      timer.current = null
      setThrottled(value)
    }, wait)
  }, [value, ms])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return throttled
}
