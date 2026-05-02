import { useEffect, useRef, useState } from 'react'
import { useSearchStore } from '../store/searchStore'
import styles from './SearchModal.module.css'

interface SearchModalProps {
  onSelect: (id: number) => void
}

export default function SearchModal({ onSelect }: SearchModalProps) {
  const { query, results, closeSearch, setQuery } = useSearchStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focusedIdx, setFocusedIdx] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()
    setFocusedIdx(0)
  }, [])

  // Reset focused index when results change
  useEffect(() => {
    setFocusedIdx(0)
  }, [results])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      closeSearch()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results.length > 0) {
      const hit = results[focusedIdx]
      if (hit) {
        onSelect(hit.id)
        closeSearch()
      }
    }
  }

  return (
    <div className={styles.overlay} onClick={closeSearch}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <span className={styles.icon}>⌕</span>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search pastes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className={styles.results}>
          {results.length === 0 && query.trim() ? (
            <div className={styles.empty}>No results for "{query}"</div>
          ) : results.length === 0 ? (
            <div className={styles.empty}>Type to search across all pastes</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.id}
                className={`${styles.item} ${i === focusedIdx ? styles.focused : ''}`}
                onClick={() => {
                  onSelect(r.id)
                  closeSearch()
                }}
                onMouseEnter={() => setFocusedIdx(i)}
              >
                <div className={styles.itemTitle}>{r.title}</div>
                {r.excerpt && <div className={styles.itemExcerpt}>{r.excerpt}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
