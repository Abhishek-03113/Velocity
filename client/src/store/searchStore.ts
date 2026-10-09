import { create } from 'zustand'
import { Document } from 'flexsearch'
import type { Paste } from '../types'

const STORAGE_KEY = 'velocity:search-index'
const DOCS_KEY = 'velocity:search-docs'

type SearchDoc = {
  id: number
  title: string
  content: string
}

export interface SearchResult {
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
  ensureReady: () => Promise<void>
  hasCachedDocuments: () => boolean
  flushIndex: () => void
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

const documents = new Map<number, SearchDoc>()

/** Cached plain text for a note (from the persisted index) — used for list previews. */
export function cachedContent(id: number): string | undefined {
  return documents.get(id)?.content
}

const PERSIST_DEBOUNCE_MS = 2000
let persistTimer: ReturnType<typeof setTimeout> | null = null

// Serialized index cache in localStorage — export/stringify/write is expensive,
// so this must never run synchronously on a hot path (e.g. every keystroke).
function persistIndexNow(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    const exported: Record<string, unknown> = {}
    index.export((key, data) => {
      exported[key as string] = data
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exported))
    localStorage.setItem(DOCS_KEY, JSON.stringify([...documents.values()]))
  } catch {
    // localStorage quota exceeded — silently skip
  }
}

// Debounced persist for hot paths (e.g. indexPaste on every keystroke) — the
// in-memory index is still updated synchronously, only the expensive
// export/stringify/write to localStorage is batched.
function schedulePersistIndex(): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistIndexNow()
  }, PERSIST_DEBOUNCE_MS)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (persistTimer !== null) persistIndexNow()
  })
}

function addOrReplace(doc: SearchDoc): void {
  try {
    index.remove(doc.id)
  } catch {
    // The document may not exist in a freshly imported index.
  }
  index.add(doc)
}

async function loadIndex(): Promise<void> {
  try {
    const rawDocs = localStorage.getItem(DOCS_KEY)
    if (rawDocs) {
      const parsed = JSON.parse(rawDocs) as SearchDoc[]
      for (const doc of parsed) {
        if (Number.isInteger(doc.id)) {
          documents.set(doc.id, {
            id: doc.id,
            title: doc.title ?? '',
            content: doc.content ?? '',
          })
        }
      }
    }

    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      for (const doc of documents.values()) addOrReplace(doc)
      return
    }
    const exported = JSON.parse(raw) as Record<string, unknown>
    const imports = Object.entries(exported).map(([key, data]) =>
      index.import(key, data as string)
    )
    await Promise.all(imports)
  } catch {
    documents.clear()
    // corrupted cache — ignore, will rebuild from server/list data
  }
}

// Extract a short excerpt around the query match
function makeExcerpt(content: string | undefined, query: string): string {
  const text = content ?? ''
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 80).replace(/\s+/g, ' ')
  const start = Math.max(0, idx - 30)
  const end = Math.min(text.length, idx + query.length + 50)
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ')
  return (start > 0 ? '…' : '') + excerpt + (end < text.length ? '…' : '')
}

/** Full-text search across titles and content (pure — no store updates). */
export function searchNotes(q: string, limit = 20): SearchResult[] {
  if (!q.trim()) return []
  const raw = index.search(q, { enrich: true, limit }) as Array<{
    field: string
    result: Array<{ id: number; doc: { title: string; content: string } }>
  }>

  // Merge results across fields (title hits first), deduplicate by id
  raw.sort((a, b) => (a.field === 'title' ? -1 : b.field === 'title' ? 1 : 0))
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
  return results
}

// Load persisted index on module init
const indexReady = loadIndex()

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
    set({ results: searchNotes(q) })
  },

  indexPaste: (paste) => {
    const previous = documents.get(paste.id)
    const doc = {
      id: paste.id,
      title: paste.title ?? previous?.title ?? '',
      content: paste.content ?? previous?.content ?? '',
    }
    documents.set(paste.id, doc)
    addOrReplace(doc)
    schedulePersistIndex()
  },

  removePaste: (id: number) => {
    documents.delete(id)
    try {
      index.remove(id)
    } catch {
      // Already absent from the hydrated index.
    }
    persistIndexNow()
  },

  hydrateIndex: (pastes) => {
    let changed = false
    for (const p of pastes) {
      const previous = documents.get(p.id)
      // Unchanged cached docs are already in the imported index — don't re-tokenise on startup.
      if (previous && p.content === undefined && previous.title === (p.title ?? '')) continue
      changed = true
      const doc = {
        id: p.id,
        title: p.title ?? previous?.title ?? '',
        content: p.content ?? previous?.content ?? '',
      }
      documents.set(p.id, doc)
      addOrReplace(doc)
    }
    if (changed) persistIndexNow()
  },

  ensureReady: () => indexReady,
  hasCachedDocuments: () => documents.size > 0,
  flushIndex: () => persistIndexNow(),
}))
