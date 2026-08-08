# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Velocity** (383 symbols, 623 relationships, 29 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Velocity/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Velocity/clusters` | All functional areas |
| `gitnexus://repo/Velocity/processes` | All execution flows |
| `gitnexus://repo/Velocity/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
