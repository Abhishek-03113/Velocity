import { db } from '../../db/client.ts'
import type { BookFormat } from './files.ts'
import { migrateAnnotations } from './annotations.ts'

export type BookStatus = 'unread' | 'reading' | 'finished'

export interface BookRow {
  id: number
  format: BookFormat
  title: string
  author: string | null
  file_name: string
  byte_size: number
  sha256: string
  cover_url: string | null
  position: string | null
  progress: number
  status: BookStatus
  page_count: number | null
  /** Per-book reader settings (appearance, layout, …) as opaque JSON, owned by the client. */
  settings: string | null
  last_opened_at: string | null
  created_at: string
  updated_at: string
}

export interface Book extends BookRow {
  file_url: string
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      format TEXT NOT NULL CHECK (format IN ('epub','pdf')),
      title TEXT NOT NULL, author TEXT, file_name TEXT NOT NULL,
      byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE,
      cover_url TEXT, position TEXT, progress REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','reading','finished')),
      page_count INTEGER, last_opened_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  const cols = db.prepare('PRAGMA table_info(plugin_books)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'settings')) db.exec('ALTER TABLE plugin_books ADD COLUMN settings TEXT')
  migrateAnnotations()
}

export function toBook(row: BookRow): Book {
  return { ...row, file_url: `/api/plugins/books/${row.id}/file` }
}

export function listBooks(): Book[] {
  const rows = db
    .prepare(
      `SELECT * FROM plugin_books
       ORDER BY last_opened_at IS NULL, last_opened_at DESC, created_at DESC, id DESC`,
    )
    .all() as BookRow[]
  return rows.map(toBook)
}

export function getBookRow(id: number): BookRow | undefined {
  return db.prepare('SELECT * FROM plugin_books WHERE id = ?').get(id) as BookRow | undefined
}

export function getBookBySha(sha256: string): BookRow | undefined {
  return db.prepare('SELECT * FROM plugin_books WHERE sha256 = ?').get(sha256) as BookRow | undefined
}

export function insertBook(b: {
  format: BookFormat
  title: string
  file_name: string
  byte_size: number
  sha256: string
}): number {
  const info = db
    .prepare('INSERT INTO plugin_books (format, title, file_name, byte_size, sha256) VALUES (?, ?, ?, ?, ?)')
    .run(b.format, b.title, b.file_name, b.byte_size, b.sha256)
  return Number(info.lastInsertRowid)
}

export function deleteBookRow(id: number) {
  db.prepare('DELETE FROM plugin_books WHERE id = ?').run(id)
}

export type BookPatch = Partial<
  Pick<BookRow, 'title' | 'author' | 'cover_url' | 'position' | 'progress' | 'status' | 'page_count' | 'settings'>
> & { opened?: true }

const PATCH_COLUMNS = ['title', 'author', 'cover_url', 'position', 'progress', 'status', 'page_count', 'settings'] as const

export function patchBook(id: number, patch: BookPatch): BookRow | undefined {
  const sets: string[] = []
  const vals: (string | number | null)[] = []
  for (const key of PATCH_COLUMNS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = ?`)
      vals.push(v)
    }
  }
  if (patch.opened) sets.push('last_opened_at = CURRENT_TIMESTAMP')
  sets.push('updated_at = CURRENT_TIMESTAMP')
  db.prepare(`UPDATE plugin_books SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return getBookRow(id)
}
