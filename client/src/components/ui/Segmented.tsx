import { Icon, type IconName } from '../Icon'
import styles from './ui.module.css'

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
  title?: string
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  iconOnly?: boolean
  size?: 'regular' | 'small'
}

/** HIG segmented control — a single raised thumb slides between segments. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  iconOnly = false,
  size = 'regular',
}: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${styles.segmented} ${size === 'small' ? styles.segmentedSmall : ''}`}
      style={{ ['--segments' as string]: options.length, ['--index' as string]: index }}
    >
      <span className={styles.segmentThumb} aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={iconOnly ? o.label : undefined}
          title={o.title ?? o.label}
          className={`${styles.segment} ${o.value === value ? styles.segmentSelected : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={size === 'small' ? 14 : 15} />}
          {!iconOnly && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}
