import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { primaryKey } from '../../lib/commands'
import { displayTitle, parseTimestamp, relativeTime } from '../../lib/noteMeta'
import { comboLabel } from '../../lib/platform'
import { leaves } from '../../lib/tiling'
import { useEditorStore } from '../../store/editorStore'
import { useLayoutStore } from '../../store/layoutStore'
import { cachedContent, searchNotes } from '../../store/searchStore'
import { Icon } from '../Icon'
import styles from './Workspace.module.css'

/**
 * An empty tile is a launcher: type to filter, ↑↓ to choose, ↩ to open here.
 * Mirrors what a fresh Hyprland workspace + app launcher feels like.
 */
export function EmptyTile({ tileId, focused }: { tileId: string; focused: boolean }) {
  const pastes = useDeferredValue(useEditorStore((s) => s.pastes))
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focused) inputRef.current?.focus({ preventScroll: true })
  }, [focused])

  const items = useMemo(() => {
    const visible = new Set(
      leaves(useLayoutStore.getState().root)
        .map((l) => (l.content.kind === 'note' ? l.content.noteId : null))
        .filter((id): id is number => id != null),
    )
    if (query.trim()) {
      const byId = new Map(pastes.map((p) => [p.id, p]))
      return searchNotes(query, 12)
        .map((r) => byId.get(r.id))
        .filter((p): p is NonNullable<typeof p> => p != null)
    }
    return [...pastes]
      .filter((p) => !visible.has(p.id))
      .sort((a, b) => parseTimestamp(b.updated_at) - parseTimestamp(a.updated_at))
      .slice(0, 8)
  }, [pastes, query])

  const open = (id: number) => {
    useLayoutStore.getState().focus(tileId)
    void useEditorStore.getState().setActiveId(id)
  }

  const createHere = () => {
    useLayoutStore.getState().focus(tileId)
    useEditorStore.getState().addPaste()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[index]
      if (item) open(item.id)
      else createHere()
    }
  }

  const now = Date.now()

  return (
    <div className={styles.empty}>
      <div className={styles.emptyCard}>
        <div className={styles.emptyIcon}>
          <Icon name="rectangle.3.group" size={26} strokeWidth={1.4} />
        </div>
        <h2 className={styles.emptyTitle}>Open a note in this tile</h2>
        <div className={styles.emptySearch}>
          <Icon name="magnifyingglass" size={14} />
          <input
            ref={inputRef}
            data-bare
            value={query}
            placeholder="Search notes"
            aria-label="Search notes to open in this tile"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul className={styles.emptyList} role="listbox" aria-label="Notes">
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === index}
              className={`${styles.emptyItem} ${i === index ? styles.emptyItemActive : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => open(p.id)}
            >
              <Icon name="doc.text" size={15} />
              <span className={styles.emptyItemTitle}>{displayTitle(p, cachedContent(p.id))}</span>
              <span className={styles.emptyItemMeta}>{relativeTime(parseTimestamp(p.updated_at), now)}</span>
            </li>
          ))}
          {items.length === 0 && <li className={styles.emptyNone}>No matching notes</li>}
        </ul>
        <button type="button" className={styles.emptyNew} onClick={createHere}>
          <Icon name="square.and.pencil" size={15} />
          New Note
          <span className={styles.emptyNewKey}>{comboLabel(primaryKey('note.new') ?? '')}</span>
        </button>
      </div>
    </div>
  )
}
