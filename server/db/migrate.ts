import { db } from './client.ts'

export function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pastes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT,
      content    TEXT,
      group_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- A board belongs to its note: deleting the note deletes the board.
    CREATE TABLE IF NOT EXISTS whiteboards (
      paste_id   INTEGER PRIMARY KEY REFERENCES pastes(id) ON DELETE CASCADE,
      scene      TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      mime_type  TEXT NOT NULL,
      ext        TEXT NOT NULL,
      byte_size  INTEGER NOT NULL,
      sha256     TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
}
