import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { comboLabel } from '../../lib/platform'
import { Icon, type IconName } from '../Icon'
import styles from './ui.module.css'

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  shortcut?: string
  active?: boolean
  size?: 'regular' | 'small'
}

/** Borderless HIG toolbar button: icon only, tooltip carries name + shortcut. */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { icon, label, shortcut, active = false, size = 'regular', className, ...rest },
  ref,
) {
  const title = shortcut ? `${label} (${comboLabel(shortcut)})` : label
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      title={title}
      className={`${styles.toolbarButton} ${size === 'small' ? styles.toolbarButtonSmall : ''} ${
        active ? styles.toolbarButtonActive : ''
      } ${className ?? ''}`}
      {...rest}
    >
      <Icon name={icon} size={size === 'small' ? 15 : 18} />
    </button>
  )
})
