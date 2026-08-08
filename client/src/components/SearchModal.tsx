import { useEffect, useRef, useState } from 'react'
import { useSearchStore } from '../store/searchStore'

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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-v-bg/70 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={closeSearch}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-v-border bg-v-surface shadow-2xl shadow-black/50"
        onClick={(e) => { e.stopPropagation() }}
      >
        <div className="flex items-center gap-3 border-b border-v-border px-4">
          <svg className="h-4 w-4 shrink-0 text-v-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            className="h-12 min-w-0 flex-1 bg-transparent font-body text-sm text-v-text-strong outline-none placeholder:text-v-faint"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => { setQuery(e.target.value) }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="shrink-0 rounded bg-v-border px-1.5 py-0.5 text-[10px] text-v-muted">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-v-faint">
              {query.trim() ? `No results for "${query}"` : 'Type to search across all pastes'}
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.id}
                className={`cursor-pointer rounded-lg px-3 py-2 transition-colors duration-100 ${
                  i === focusedIdx ? 'bg-v-accent/15 text-v-text-strong' : 'text-v-text'
                }`}
                onClick={() => {
                  onSelect(r.id)
                  closeSearch()
                }}
                onMouseEnter={() => { setFocusedIdx(i) }}
              >
                <div className="truncate text-sm font-medium">{r.title || 'Untitled'}</div>
                {r.excerpt && (
                  <div className="mt-0.5 truncate text-xs text-v-muted">{r.excerpt}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
