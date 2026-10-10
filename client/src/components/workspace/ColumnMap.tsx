import { memo } from 'react'
import { effectiveWidth, type Column } from '../../lib/sliding'
import { focusTile } from '../../lib/workspace'
import { useLayoutStore } from '../../store/layoutStore'
import styles from './Workspace.module.css'

interface ColumnMapProps {
  columns: Column[]
  focusedId: string
  scrollX: number
  total: number
}

/** Slim overview of the sliding strip: one pill per column, the viewport outlined. */
function ColumnMapImpl({ columns, focusedId, scrollX, total }: ColumnMapProps) {
  const span = Math.max(total, 1)
  return (
    <div
      className={styles.columnMap}
      role="group"
      aria-label="Columns"
      onWheel={(e) => {
        const { scrollX: now, scrollTo } = useLayoutStore.getState()
        scrollTo(now + (e.deltaX || e.deltaY) / 400)
      }}
    >
      <div className={styles.columnMapTrack}>
        {columns.map((c, i) => {
          const focused = c.tiles.includes(focusedId)
          return (
            <button
              key={c.id}
              type="button"
              data-column-pill={i}
              aria-label={`Column ${i + 1}`}
              aria-current={focused ? 'true' : undefined}
              title={`Column ${i + 1} of ${columns.length}`}
              className={`${styles.columnPill} ${focused ? styles.columnPillFocused : ''}`}
              style={{ flexGrow: effectiveWidth(columns, c) }}
              onClick={() => focusTile(c.tiles[0]!, { dom: true })}
            />
          )
        })}
        <span
          className={styles.columnViewport}
          aria-hidden="true"
          style={{ left: `${(scrollX / span) * 100}%`, width: `${(Math.min(1, span) / span) * 100}%` }}
        />
      </div>
    </div>
  )
}

export const ColumnMap = memo(ColumnMapImpl)
