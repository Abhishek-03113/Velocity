import { create } from 'zustand'
import { Document } from 'flexsearch'
import type { Paste } from '../types'

const STORAGE_KEY = 'velocity:search-index'

interface SearchResult {
  id: number
  title: string
  excerpt: string
}

interface SearchState {
  query: string
  results: SearchResult[]
  isOpen: boolean

  openSearch: () => void
  closeSearch: () => void
  setQuery: (q: string) => void
  search: (q: string) => void
  indexPaste: (paste: Pick<Paste, 'id' | 'title' | 'content'>) => void
  removePaste: (id: number) => void
  hydrateIndex: (pastes: Array<Pick<Paste, 'id' | 'title' | 'content'>>) => void
}

// Document index: search on both title and content fields
const index = new Document({
  document: {
    id: 'id',
    index: ['title', 'content'],
    store: ['title', 'content'],
  },
  tokenize: 'forward',
})

// Serialized index cache in localStorage
function persistIndex(): void {
  try {
    const exported: Record<string, unknown> = {}
    index.export((key, data) => {
      exported[key as string] = data
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exported))
  } catch {
    // localStorage quota exceeded — silently skip
  }
}

async function loadIndex(): Promise<void> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const exported = JSON.parse(raw) as Record<string, unknown>
    const imports = Object.entries(exported).map(([key, data]) =>
      index.import(key, data as string)
    )
    await Promise.all(imports)
  } catch {
    // corrupted cache — ignore, will rebuild from server pastes
  }
}

// Extract a short excerpt around the query match
function makeExcerpt(content: string | undefined, query: string): string {
  const text = content ?? ''
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 80)
  const start = Math.max(0, idx - 30)
  const end = Math.min(text.length, idx + query.length + 50)
  const excerpt = text.slice(start, end)
  return (start > 0 ? '…' : '') + excerpt + (end < text.length ? '…' : '')
}

// Load persisted index on module init
loadIndex()

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  results: [],
  isOpen: false,

  openSearch: () => set({ isOpen: true, query: '', results: [] }),
  closeSearch: () => set({ isOpen: false, query: '', results: [] }),

  setQuery: (q: string) => {
    set({ query: q })
    get().search(q)
  },

  search: (q: string) => {
    if (!q.trim()) {
      set({ results: [] })
      return
    }

    const raw = index.search(q, { enrich: true, limit: 20 }) as Array<{
      field: string
      result: Array<{ id: number; doc: { title: string; content: string } }>
    }>

    // Merge results across fields, deduplicate by id
    const seen = new Set<number>()
    const results: SearchResult[] = []
    for (const field of raw) {
      for (const item of field.result) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        results.push({
          id: item.id,
          title: item.doc.title || 'Untitled',
          excerpt: makeExcerpt(item.doc.content, q),
        })
      }
    }
    set({ results })
  },

  indexPaste: (paste) => {
    index.add({ id: paste.id, title: paste.title ?? '', content: paste.content ?? '' })
    persistIndex()
  },

  removePaste: (id: number) => {
    index.remove(id)
    persistIndex()
  },

  hydrateIndex: (pastes) => {
    for (const p of pastes) {
      index.add({ id: p.id, title: p.title ?? '', content: p.content ?? '' })
    }
    persistIndex()
  },
}))
