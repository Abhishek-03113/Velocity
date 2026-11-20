import { Database } from 'bun:sqlite'
import fs from 'fs'
import path from 'path'

const DB_PATH = process.env.DB_PATH ?? path.resolve(import.meta.dir, '../../data/velocity.db')

// Ensure the data directory exists before opening the database
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

// `strict` binds named parameters (`@id`, `$id`, `:id`) from plain object keys
// (`{ id }`) and throws on missing ones, which is what the queries here expect.
export const db = new Database(DB_PATH, { create: true, strict: true })

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
// better-sqlite3 set these two by default and bun:sqlite does not. Keep them so another
// process writing the file (a backup, a `sqlite3` shell) makes us wait instead of failing
// with SQLITE_BUSY, and so the page cache stays at 16 MB rather than SQLite's 2 MB.
db.exec('PRAGMA busy_timeout = 5000')
db.exec('PRAGMA cache_size = -16000')
