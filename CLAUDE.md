# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**Velocity** is a self-hosted paste manager with a **local-first architecture**. The guiding philosophy is _"Backend stores. Frontend thinks."_ — the UI never waits for the server; all interactions resolve instantly in Zustand state, with async debounced persistence to a SQLite backend.

---

## Commands

All commands run from the project root unless noted.

```bash
# Install all dependencies (root + client + server)
npm run install:all

# Start both client and server in development (concurrently)
npm run dev

# Start only the server
npm run dev:server

# Start only the client
npm run dev:client

# Build the client for production
npm run build

# Lint the client
cd client && npm run lint
```

Server runs on `http://localhost:3000`, client on `http://localhost:5173`.

Environment: copy `.env.example` to `.env` and set `PORT` and `CLIENT_URL`.

---

## Architecture

### Monorepo Structure

```
Velocity/
├── client/          # Vite + React frontend
│   └── src/
│       ├── components/   # UI components
│       ├── store/        # Zustand state slices
│       └── lib/          # API client, utilities
├── server/          # Hono + Node.js backend
│   ├── index.ts
│   ├── routes/
│   ├── db/              # SQLite client (better-sqlite3)
│   └── middleware/
└── data/            # SQLite database file lives here
```

### Frontend (client/)

- **React + Vite** — framework and build tool
- **CodeMirror 6** — editor engine (multi-cursor, Markdown, keymaps)
- **Zustand** — client-side state (primary source of truth during runtime)
- **FlexSearch** — full-text search index, serialized to `localStorage` for persistence across page loads
- **CSS Modules** — scoped styles, zero runtime cost

The entire UX interaction loop is client-side. Writes to the backend are **async and debounced**. Dirty state is tracked in Zustand; failed writes enter a retry queue (exponential backoff, max 3 attempts).

### Backend (server/)

- **Hono** on Node.js — thin REST API
- **better-sqlite3** — synchronous SQLite driver
- The server is a **persistence layer only** — no business logic in the critical path

### Database Schema

```sql
CREATE TABLE groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pastes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  content    TEXT,
  group_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- A paste belongs to at most one group (flat/tag-style, no nesting).
- Deleting a group sets `group_id = NULL` on its pastes; pastes are never cascade-deleted.

---

## Key Design Constraints

- **No IndexedDB** — SQLite on the filesystem is the sole durability guarantee.
- **No toast notifications** — backend write failures are logged server-side only; a dirty-state indicator in the UI is the only user-facing signal.
- **1 MB soft cap per paste** — warn in the editor status bar; no hard enforcement.
- **Sub-50ms interaction latency** — never block the UI on a network call.
- **Search latency < 10ms** — FlexSearch index is hydrated from `localStorage` on startup, never rebuilt cold.

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| New Paste | `Ctrl/Cmd + N` |
| Search | `Ctrl/Cmd + F` |
| Global Search | `Ctrl/Cmd + Shift + F` |
| Toggle Sidebar | `Ctrl/Cmd + 1` |
| Multi-cursor | `Alt + Click` (CodeMirror 6 native) |

---

## Implementation Checklist

Track feature development status here. Update each item as work is completed.

### Infrastructure
- [x] Monorepo scaffold (root `package.json` with `concurrently`)
- [x] Vite + React client bootstrap
- [x] Hono server with CORS and logger middleware
- [x] SQLite client (better-sqlite3) wired up
- [x] `.env` / `.env.example` configuration
- [x] Docker Compose setup (client + server + nginx proxy)
- [x] Makefile (`up`, `down`, `restart`)
- [x] Database schema migration (groups + pastes tables)
- [x] API routes: pastes CRUD (`/api/pastes`)
- [x] API routes: groups CRUD (`/api/groups`)

### Core Editor
- [x] CodeMirror 6 integration
- [x] Plain text mode (Markdown treated as plain text, no syntax highlighting)
- [x] Markdown edit mode with CodeMirror Markdown language support
- [x] "Read Mode" Markdown preview toggle (renders via `marked`)
- [ ] 1MB soft cap warning in editor status bar

### UI Shell
- [x] Browser-style tab bar (open pastes as tabs)
- [x] Tab creation via `+` button (immediately right of last tab)
- [x] Tab close (`×`) — closes tab only, paste stays in sidebar; closing last tab auto-creates a new Untitled
- [x] Inline tab rename on double-click (Enter/blur confirms, Escape cancels)
- [x] Active tab visual distinction
- [x] Sidebar paste list (live from Zustand state)
- [x] Active paste highlighted in sidebar
- [x] Sidebar paste click opens paste as a new tab
- [x] Named pastes always preserved in sidebar after tab close
- [x] Up to 5 MRU unnamed local pastes persisted in sidebar
- [x] Sidebar toggle (`Ctrl/Cmd + 1`) with animation
- [x] Delete paste from sidebar (discard `×` button on each paste item)
- [x] Group list in sidebar
- [x] Create / rename / delete group
- [x] Assign paste to group
- [x] Filter sidebar by group

### State & Sync
- [x] Zustand store: pastes slice (title, content, open tabs, activeId)
- [x] openTabIds slice tracks open tabs independently of full pastes list
- [x] Tab-local state: each paste holds independent content
- [x] Lazy content fetch — content loaded on first tab open, not on startup
- [x] Zustand store: groups slice
- [x] Dirty state flag per paste
- [x] Unsynced indicator (dot in tab title)
- [x] On-startup: load all pastes from API into Zustand
- [x] Debounced persistence (write to backend after idle, ~800ms)
- [x] Retry queue: exponential backoff, max 3 attempts
- [x] Server-side write failure logging (paste ID + timestamp)

### Search
- [x] FlexSearch index on title + content
- [x] Index serialization to `localStorage` on each write
- [x] Index hydration from `localStorage` on startup, preserving cached content documents
- [x] Inline search (`Ctrl/Cmd + F`) — CodeMirror built-in panel
- [x] Global search (`Ctrl/Cmd + Shift + F`) across all pastes

### Keyboard Shortcuts
- [x] `Ctrl/Cmd + N` — new paste (new tab)
- [x] `Ctrl/Cmd + F` — inline search (CodeMirror built-in)
- [x] `Ctrl/Cmd + Shift + F` — global search
- [x] `Ctrl/Cmd + 1` — toggle sidebar
- [ ] `Alt + Click` — multi-cursor (CodeMirror 6 native, no custom binding needed)

### UX Polish
- [ ] Multi-cursor editing verified (CodeMirror 6 native API)
- [x] Sidebar toggle animation
- [x] CSS Modules applied to all components (global CSS limited to app reset/base styles)
- [x] Responsive layout

### Quality & Reliability
- [x] API response envelope (`{ success, data?, error? }`) on all routes
- [x] Input validation on all API routes (Zod)
- [ ] Unit tests: Zustand store logic (dirty flag, retry queue)
- [ ] Integration tests: API routes (paste CRUD, group CRUD)
- [ ] E2E tests: paste creation, search, group assignment (Playwright)

---

## Current Durability Status

The current UI is durable across reloads. Migrations run at server startup, paste and group CRUD APIs are wired, client bootstrap loads pastes/groups into Zustand, paste creation/deletion use server IDs, and `setContent` / `setTitle` / group assignment sync through debounced `PUT /api/pastes/:id` calls.

Remaining intentionally incomplete areas are tracked above: rich text mode is not implemented, the 1MB editor status warning is not implemented, multi-cursor behavior has not been manually verified, and automated tests have not been added.
