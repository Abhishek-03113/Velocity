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
