/**
 * Highlights and bookmarks (docs/specs/books-reading-experience.md §4): a typed client for
 * `/api/plugins/books/:id/annotations` and a local-first store over it.
 *
 * Every change lands in the store at once. New rows carry a temporary negative id until the server
 * confirms them. The server is written in the background by one sequential queue: 3 attempts with
 * back-off, then parked until the browser comes back online or the window regains focus. The queue is
 * mirrored to plugin storage so a reload never loses an unsynced highlight.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { BooksApiError, request } from './api'
import type { AnnotationPatch, BookAnnotation, NewAnnotation } from './types'

// ── API ──────────────────────────────────────────────────────────────────────

export interface AnnotationsApi {
  list(bookId: number): Promise<BookAnnotation[]>
  create(bookId: number, input: NewAnnotation): Promise<BookAnnotation>
  patch(bookId: number, id: number, patch: AnnotationPatch): Promise<BookAnnotation>
  remove(bookId: number, id: number): Promise<void>
  clear(bookId: number, kind: BookAnnotation['kind']): Promise<void>
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const httpAnnotationsApi: AnnotationsApi = {
  list: (bookId) => request<BookAnnotation[]>(`/${bookId}/annotations`),
  create: (bookId, input) =>
    request<BookAnnotation>(`/${bookId}/annotations`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }),
  patch: (bookId, id, patch) =>
    request<BookAnnotation>(`/${bookId}/annotations/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }),
  remove: async (bookId, id) => {
    await request<unknown>(`/${bookId}/annotations/${id}`, { method: 'DELETE' })
  },
  clear: async (bookId, kind) => {
    await request<unknown>(`/${bookId}/annotations?kind=${kind}`, { method: 'DELETE' })
  },
}

export const listAnnotations = (bookId: number) => api.list(bookId)
export const createAnnotation = (bookId: number, input: NewAnnotation) => api.create(bookId, input)
export const patchAnnotation = (bookId: number, id: number, patch: AnnotationPatch) => api.patch(bookId, id, patch)
export const deleteAnnotation = (bookId: number, id: number) => api.remove(bookId, id)
export const clearAnnotations = (bookId: number, kind: BookAnnotation['kind']) => api.clear(bookId, kind)

let api: AnnotationsApi = httpAnnotationsApi

// ── Store ────────────────────────────────────────────────────────────────────

interface AnnotationsState {
  byBook: Record<number, BookAnnotation[]>
  /** Books whose list has been fetched from the server. */
  loaded: Record<number, true>
}

export const useAnnotationsStore = create<AnnotationsState>(() => ({ byBook: {}, loaded: {} }))

/** One shared empty list, so `useAnnotations` is referentially stable for books without any. */
export const NO_ANNOTATIONS: BookAnnotation[] = []

const state = () => useAnnotationsStore.getState()

function setList(bookId: number, list: BookAnnotation[]) {
  useAnnotationsStore.setState((s) => ({ byBook: { ...s.byBook, [bookId]: list } }))
}

/** Insert in reading order: after every row at or before the same progress. */
function insertSorted(list: BookAnnotation[], row: BookAnnotation): BookAnnotation[] {
  let at = list.length
  while (at > 0 && list[at - 1]!.progress > row.progress) at--
  return [...list.slice(0, at), row, ...list.slice(at)]
}

const serverNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

// ── Pending operations ───────────────────────────────────────────────────────

type Op =
  | { type: 'create'; bookId: number; row: BookAnnotation }
  | { type: 'patch'; bookId: number; id: number; patch: AnnotationPatch }
  | { type: 'delete'; bookId: number; id: number }
  | { type: 'clear'; bookId: number; kind: BookAnnotation['kind'] }

const STORAGE_KEY = 'pendingAnnotations'
const MAX_ATTEMPTS = 3
const backoff = (attempt: number) => 1000 * 2 ** (attempt - 1)

interface Storage {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

let queue: Op[] = []
let storage: Storage | null = null
let running = false
let parked = false
let tempCounter = 0
let generation = 0
const requested = new Set<number>()

const persist = () => {
  try {
    storage?.set(STORAGE_KEY, queue)
  } catch (err) {
    console.error('[books] could not persist pending annotations', err)
  }
}

/** The op the server is working on right now cannot be merged into. */
const inflight = (op: Op) => running && queue[0] === op

const nextTempId = () => --tempCounter

/** Drop queued ops (never the one in flight) matching `drop`. */
function dropQueued(drop: (op: Op) => boolean) {
  queue = queue.filter((op) => inflight(op) || !drop(op))
}

function isPermanent(err: unknown): boolean {
  return err instanceof BooksApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The server confirmed a create: swap the temporary id for the real row and repoint queued ops. */
function confirmCreate(bookId: number, tempId: number, saved: BookAnnotation) {
  const list = state().byBook[bookId] ?? NO_ANNOTATIONS
  if (list.some((a) => a.id === tempId)) {
    // A list fetched meanwhile may already hold the real row: keep one copy.
    const withoutDuplicate = list.some((a) => a.id === saved.id) ? list.filter((a) => a.id !== tempId) : list.map((a) => (a.id === tempId ? saved : a))
    setList(bookId, withoutDuplicate)
  }
  // Else the row was removed locally while in flight: a delete or clear is queued behind this op.
  queue = queue.map((op) => {
    if ((op.type === 'patch' || op.type === 'delete') && op.id === tempId) return { ...op, id: saved.id }
    return op
  })
}

async function execute(op: Op): Promise<void> {
  switch (op.type) {
    case 'create': {
      const r = op.row
      const id = r.id
      const input: NewAnnotation = {
        kind: r.kind,
        locator: r.locator,
        text: r.text,
        note: r.note,
        color: r.color,
        style: r.style,
        chapter: r.chapter,
        progress: r.progress,
        page: r.page,
      }
      const saved = await api.create(op.bookId, input)
      queue.shift()
      confirmCreate(op.bookId, id, saved)
      return
    }
    case 'patch':
      if (op.id < 0) return void queue.shift() // its create never reached the server (it was dropped)
      await api.patch(op.bookId, op.id, op.patch)
      queue.shift()
      return
    case 'delete':
      if (op.id < 0) return void queue.shift()
      await api.remove(op.bookId, op.id)
      queue.shift()
      return
    case 'clear':
      await api.clear(op.bookId, op.kind)
      queue.shift()
      return
  }
}

async function pump(): Promise<void> {
  if (running || !storage) return
  running = true
  parked = false
  const gen = generation
  let attempts = 0
  try {
    while (queue.length && gen === generation) {
      const op = queue[0]!
      try {
        await execute(op)
        attempts = 0
        persist()
      } catch (err) {
        if (gen !== generation) return
        console.error('[books] annotation sync failed', err)
        if (isPermanent(err)) {
          // The server will never accept this (the book or row is gone): forget it, keep the local list.
          queue.shift()
          if (op.type === 'create') {
            const list = state().byBook[op.bookId]
            if (list) setList(op.bookId, list.filter((a) => a.id !== op.row.id))
          }
          persist()
          continue
        }
        attempts++
        if (attempts >= MAX_ATTEMPTS) {
          parked = true
          return
        }
        await sleep(backoff(attempts))
      }
    }
  } finally {
    if (gen === generation) running = false
  }
}

function enqueue(op: Op) {
  queue.push(op)
  persist()
  void pump()
}

const resume = () => {
  if (queue.length && !running) void pump()
}

// ── Mutations (local-first) ──────────────────────────────────────────────────

/** Optimistic add. A bookmark at a locator that already has one returns the existing row. */
export function addAnnotation(bookId: number, input: NewAnnotation): BookAnnotation {
  const list = state().byBook[bookId] ?? NO_ANNOTATIONS
  if (input.kind === 'bookmark') {
    const existing = list.find((a) => a.kind === 'bookmark' && a.locator === input.locator)
    if (existing) return existing
  }
  const now = serverNow()
  const row: BookAnnotation = { ...input, id: nextTempId(), book_id: bookId, created_at: now, updated_at: now }
  setList(bookId, insertSorted(list, row))
  enqueue({ type: 'create', bookId, row })
  return row
}

export function updateAnnotation(bookId: number, id: number, patch: AnnotationPatch): void {
  const list = state().byBook[bookId]
  if (!list?.some((a) => a.id === id)) return
  setList(bookId, list.map((a) => (a.id === id ? { ...a, ...patch, updated_at: serverNow() } : a)))
  if (id < 0) {
    // Not on the server yet: fold the change into its create when that is still waiting.
    const create = queue.find((op) => op.type === 'create' && op.row.id === id && !inflight(op))
    if (create && create.type === 'create') {
      create.row = { ...create.row, ...patch }
      persist()
      return
    }
  } else {
    const pending = queue.find((op) => op.type === 'patch' && op.id === id && !inflight(op))
    if (pending && pending.type === 'patch') {
      pending.patch = { ...pending.patch, ...patch }
      persist()
      return
    }
  }
  enqueue({ type: 'patch', bookId, id, patch })
}

export function removeAnnotation(bookId: number, id: number): void {
  const list = state().byBook[bookId]
  if (!list?.some((a) => a.id === id)) return
  setList(bookId, list.filter((a) => a.id !== id))
  const waiting = id < 0 && queue.some((op) => op.type === 'create' && op.row.id === id && !inflight(op))
  dropQueued((op) => (op.type === 'patch' || op.type === 'delete') && op.id === id)
  if (waiting) {
    dropQueued((op) => op.type === 'create' && op.row.id === id)
    persist()
    return
  }
  enqueue({ type: 'delete', bookId, id })
}

/** Clear every highlight or every bookmark of a book. */
export function clearBookAnnotations(bookId: number, kind: BookAnnotation['kind']): void {
  const list = state().byBook[bookId] ?? NO_ANNOTATIONS
  const gone = new Set(list.filter((a) => a.kind === kind).map((a) => a.id))
  setList(bookId, list.filter((a) => a.kind !== kind))
  dropQueued((op) => (op.type === 'create' && gone.has(op.row.id)) || ((op.type === 'patch' || op.type === 'delete') && gone.has(op.id)))
  enqueue({ type: 'clear', bookId, kind })
}

/** The book was removed: forget its annotations and anything still queued for it. */
export function forgetBook(bookId: number): void {
  dropQueued((op) => op.bookId === bookId)
  persist()
  useAnnotationsStore.setState((s) => {
    const byBook = { ...s.byBook }
    delete byBook[bookId]
    const loaded = { ...s.loaded }
    delete loaded[bookId]
    return { byBook, loaded }
  })
  requested.delete(bookId)
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** The server's list with the not-yet-synced local changes laid over it. */
function overlayPending(bookId: number, list: BookAnnotation[]): BookAnnotation[] {
  let rows = list
  for (const op of queue) {
    if (op.bookId !== bookId) continue
    if (op.type === 'delete') rows = rows.filter((a) => a.id !== op.id)
    else if (op.type === 'clear') rows = rows.filter((a) => a.kind !== op.kind)
    else if (op.type === 'patch') rows = rows.map((a) => (a.id === op.id ? { ...a, ...op.patch } : a))
    else if (!rows.some((a) => a.id === op.row.id)) rows = insertSorted(rows, op.row)
  }
  return rows
}

/** Fetch a book's annotations once (until it fails). Resolves when the list is in the store. */
export async function loadAnnotations(bookId: number): Promise<void> {
  if (state().loaded[bookId] || requested.has(bookId)) return
  requested.add(bookId)
  try {
    const list = await api.list(bookId)
    setList(bookId, overlayPending(bookId, list))
    useAnnotationsStore.setState((s) => ({ loaded: { ...s.loaded, [bookId]: true } }))
  } catch (err) {
    console.error(`[books] could not load annotations for book ${bookId}`, err)
    requested.delete(bookId)
  }
}

/** Live annotations for the reader: loads the book's list once, local changes appear at once. */
export function useAnnotations(bookId: number): BookAnnotation[] {
  useEffect(() => {
    void loadAnnotations(bookId)
  }, [bookId])
  return useAnnotationsStore((s) => s.byBook[bookId] ?? NO_ANNOTATIONS)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function restoreQueue(saved: unknown): Op[] {
  if (!Array.isArray(saved)) return []
  return saved.filter((op): op is Op => {
    if (!op || typeof op !== 'object') return false
    const o = op as Record<string, unknown>
    if (typeof o.bookId !== 'number') return false
    if (o.type === 'create') return typeof o.row === 'object' && o.row != null && typeof (o.row as BookAnnotation).id === 'number'
    if (o.type === 'patch') return typeof o.id === 'number' && typeof o.patch === 'object'
    if (o.type === 'delete') return typeof o.id === 'number'
    return o.type === 'clear' && (o.kind === 'highlight' || o.kind === 'bookmark' || o.kind === 'quote')
  })
}

/**
 * Attach plugin storage: restore unsynced changes, show them straight away, and keep the queue
 * written. Retries when the browser comes back online or the window regains focus. Returns a cleanup.
 */
export function bindAnnotationSync(plugin: Storage, backend: AnnotationsApi = httpAnnotationsApi): () => void {
  storage = plugin
  api = backend
  queue = restoreQueue(plugin.get<unknown>(STORAGE_KEY))
  for (const op of queue) {
    if (op.type !== 'create') continue
    tempCounter = Math.min(tempCounter, op.row.id)
    const list = state().byBook[op.bookId] ?? NO_ANNOTATIONS
    if (!list.some((a) => a.id === op.row.id)) setList(op.bookId, insertSorted(list, op.row))
  }
  const onWake = () => resume()
  window.addEventListener('online', onWake)
  window.addEventListener('focus', onWake)
  resume()
  return () => {
    window.removeEventListener('online', onWake)
    window.removeEventListener('focus', onWake)
    generation++
    running = false
    storage = null
    api = httpAnnotationsApi
  }
}

/** True while changes are waiting for the server (unsynced or parked offline). */
export const hasPendingAnnotations = (): boolean => queue.length > 0
export const isAnnotationSyncParked = (): boolean => parked

/** Test and teardown helper. */
export function resetAnnotations(): void {
  generation++
  running = false
  parked = false
  queue = []
  tempCounter = 0
  requested.clear()
  useAnnotationsStore.setState({ byBook: {}, loaded: {} })
}
