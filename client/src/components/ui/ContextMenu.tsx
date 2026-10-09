import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { comboLabel } from '../../lib/platform'
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

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.min(menu.x, window.innerWidth - rect.width - 8)
    const top = menu.y + rect.height > window.innerHeight - 8 ? Math.max(8, menu.y - rect.height) : menu.y
    setPos({ left: Math.max(8, left), top })
    el.focus()
  }, [menu])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
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
  }, [onClose])

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
      onClose()
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
