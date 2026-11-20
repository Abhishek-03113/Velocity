import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { comboLabel } from '../../lib/platform'
import { EASE, originCss, originWithin, reversible, staggerDelay, animate, type Reversible } from '../../lib/motion'
import { Icon, type IconName } from '../Icon'
import styles from './menu.module.css'

export type MenuItem =
  | {
      label: string
      icon?: IconName
      /** Tint for the icon (e.g. a folder colour). */
      iconColor?: string
      shortcut?: string
      destructive?: boolean
      disabled?: boolean
      checked?: boolean
      onSelect: () => void
    }
  | { separator: true }
  | { heading: string }

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/** HIG context menu: vibrant material, keyboard navigable, closes on outside click / Esc. */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })
  const [active, setActive] = useState(-1)
  const actionable = menu.items
    .map((item, i) => ('onSelect' in item && !item.disabled ? i : -1))
    .filter((i) => i >= 0)

  // The open animation; closing plays it backwards from wherever it is (interruptible).
  const motion = useRef<Reversible | null>(null)
  const closing = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))
    const flippedUp = menu.y + rect.height > window.innerHeight - 8
    const top = flippedUp ? Math.max(8, menu.y - rect.height) : menu.y
    setPos({ left, top })
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.focus()

    // Origin awareness: grow out of the exact point that was pressed.
    closing.current = false
    motion.current?.animation?.cancel()
    el.style.transformOrigin = originCss(originWithin({ x: menu.x, y: menu.y }, { left, top, width: rect.width, height: rect.height }))
    motion.current = reversible(
      el,
      [
        { opacity: 0, transform: 'scale(0.6)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 170, easing: EASE.spring },
    )
    // Staggering: the first items land one after another.
    const dy = flippedUp ? 4 : -4
    el.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach((item, i) => {
      if (i > 5) return
      animate(
        item,
        [
          { opacity: 0, transform: `translateY(${dy}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 140, delay: staggerDelay(i), easing: EASE.out, fill: 'backwards' },
      )
    })
  }, [menu])

  /** Dismiss without choosing: reverse the entrance, then unmount. */
  const dismiss = useCallback(() => {
    if (closing.current) return
    closing.current = true
    const m = motion.current
    if (!m?.animation) {
      onClose()
      return
    }
    m.reverse(onClose, 1.6)
  }, [onClose])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss()
    }
    const onBlur = () => onClose()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [onClose, dismiss])

  const select = (i: number) => {
    const item = menu.items[i]
    if (item && 'onSelect' in item && !item.disabled) {
      onClose()
      item.onSelect()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (actionable.length === 0) return
      const pos = actionable.indexOf(active)
      const next =
        e.key === 'ArrowDown'
          ? actionable[(pos + 1) % actionable.length]
          : actionable[(pos - 1 + actionable.length) % actionable.length]
      setActive(next ?? -1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (active >= 0) select(active)
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className={styles.menu}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => {
        if ('separator' in item) return <div key={i} className={styles.separator} role="separator" />
        if ('heading' in item) {
          return (
            <div key={i} className={styles.heading}>
              {item.heading}
            </div>
          )
        }
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`${styles.item} ${item.destructive ? styles.destructive : ''} ${
              active === i ? styles.itemActive : ''
            }`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => select(i)}
          >
            <span className={styles.check}>{item.checked && <Icon name="checkmark" size={13} />}</span>
            {item.icon && (
              <span className={styles.icon} style={item.iconColor ? { color: item.iconColor } : undefined}>
                <Icon name={item.icon} size={15} />
              </span>
            )}
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && <span className={styles.shortcut}>{comboLabel(item.shortcut)}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
