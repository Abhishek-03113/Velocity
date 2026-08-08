# Velocity

**v1.0** — A self-hosted notes manager built for speed.

Create, organize, and search notes with near-zero perceived latency. Every interaction resolves instantly in client state while the backend persists asynchronously in the background.

> **"Backend stores. Frontend thinks."**

---

## Features

### Notes & Tabs

- Browser-style tab bar — open multiple notes at once, close without deleting
- Inline tab rename (double-click, Enter to confirm, Escape to cancel)
- Sidebar note list with active-note highlighting
- Groups (flat folders) — create, rename, delete, filter, and drag-and-drop assign
- Up to 5 most-recent unnamed notes kept in the sidebar; named notes are always preserved
- Unsynced indicator (dot on tab) and status-bar save state

### Editor

- **CodeMirror 6** — multi-cursor (`Alt` + click), undo/redo, rectangular selection
- **Markdown** with Catppuccin syntax highlighting and Obsidian-style live preview
- **Read mode** — full rendered preview (`⌘/Ctrl + E`)
- Rich formatting shortcuts — bold, italic, inline code, strikethrough, links
- Image paste, drag-and-drop, and clipboard insert — stored as server-side assets (not embedded data URLs)
- Clickable task-list checkboxes in live preview
- Status bar — word count, line count, group, save state

### Whiteboard

- Per-note **Excalidraw** drawing board (`⌘/Ctrl + Shift + D`)
- Resizable split pane alongside the editor
- Scenes persisted in `localStorage` per note

### Search

- **FlexSearch** full-text index over titles and content — sub-10 ms, client-side
- Index serialized to `localStorage` and hydrated on startup (no cold rebuild)
- Inline search in the editor (`⌘/Ctrl + F`)
- Global search across all notes (`⌘/Ctrl + Shift + F`)

### Sync & Durability

- **Local-first** — UI never waits on the network
- Debounced writes (~800 ms idle) to a SQLite backend
- Retry queue with exponential backoff (max 3 attempts)
- Lazy content fetch — body loaded on first tab open, not at startup
- Write failures logged server-side; dirty-state dot is the only user-facing signal

---

## Keyboard Shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| New note | `⌘ N` | `Ctrl + N` |
| Close tab | `⌘ W` | `Ctrl + W` |
| Read mode | `⌘ E` | `Ctrl + E` |
| Toggle whiteboard | `⌘ ⇧ D` | `Ctrl + Shift + D` |
| Inline search | `⌘ F` | `Ctrl + F` |
| Global search | `⌘ ⇧ F` | `Ctrl + Shift + F` |
| Toggle sidebar | `⌘ 1` | `Ctrl + 1` |
| Bold | `⌘ B` | `Ctrl + B` |
| Italic | `⌘ I` | `Ctrl + I` |
| Inline code | `⌘ ⇧ C` | `Ctrl + Shift + C` |
| Strikethrough | `⌘ ⇧ X` | `Ctrl + Shift + X` |
| Insert link | `⌘ K` | `Ctrl + K` |
| Multi-cursor | `⌥ Click` | `Alt + Click` |
| Undo / Redo | `⌘ Z` / `⌘ ⇧ Z` | `Ctrl + Z` / `Ctrl + Shift + Z` |

Press the `?` button in the top bar for the in-app shortcuts reference.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18 + Vite | Fast builds, small bundles |
| Editor | CodeMirror 6 | Multi-cursor, Markdown, keymaps |
| Whiteboard | Excalidraw | Per-note drawing canvas |
| State | Zustand | Client-side source of truth |
| Search | FlexSearch | Sub-10 ms full-text search |
| Styling | Tailwind CSS 4 + CSS Modules | Scoped, zero-runtime-cost styles |
| Backend | Hono on Node.js | Thin REST API |
| Database | SQLite (better-sqlite3) | Embedded persistence |
| Proxy | nginx | Reverse proxy + static serving |
| Deploy | Docker Compose | Self-contained deployment |

---

## Quick Start

### Docker (recommended)

Requires Docker and Docker Compose.

```bash
git clone <repo-url> velocity
cd velocity
cp .env.example .env
make up
```

| Service | URL |
|---|---|
| Client | http://localhost:37801 |
| API (via proxy) | http://localhost:37800 |

```bash
make down      # stop containers
make restart   # rebuild and restart
make rebuild   # clean rebuild (no cache)
```

Data is stored in the `velocity_data` Docker volume. Markdown image assets are also written to `~/velocity_docs` on the host (mounted into the server container).

### Local development

Requires Node.js 18+.

```bash
npm run install:all
cp .env.example .env
npm run dev
```

| Service | URL |
|---|---|
| Client | http://localhost:5173 |
| Server | http://localhost:3000 |

```bash
npm run dev:client   # Vite only
npm run dev:server   # Hono only
npm run build        # production client build
cd client && npm run lint
```

---

## Project Structure

```
Velocity/
├── client/                  # Vite + React frontend
│   └── src/
│       ├── components/      # Editor, PasteList, Whiteboard, SearchModal, …
│       ├── store/           # Zustand slices (editor, groups, search, whiteboard)
│       └── lib/             # API client, image upload helpers
├── server/                  # Hono + Node.js backend
│   ├── routes/              # /api/pastes, /api/groups, /api/assets
│   ├── db/                  # SQLite client + migrations
│   └── workers/             # Background markdown sync
├── data/                    # SQLite database (gitignored)
├── docker-compose.yml
├── Makefile
└── .env.example
```

---

## Environment Variables

Copy `.env.example` to `.env` before starting.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Hono server listen port |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin |
| `VITE_API_URL` | `http://localhost:3000` | API base URL (client build-time) |

For Docker, set `CLIENT_URL=http://localhost:37801` and `VITE_API_URL=http://localhost:37800` in `.env`.

---

## API

All routes return `{ success, data?, error? }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pastes` | List notes (metadata only) |
| `GET` | `/api/pastes/:id` | Fetch note with content |
| `POST` | `/api/pastes` | Create note |
| `PUT` | `/api/pastes/:id` | Update note |
| `DELETE` | `/api/pastes/:id` | Delete note |
| `GET/POST/PUT/DELETE` | `/api/groups` | Group CRUD |
| `POST` | `/api/assets` | Upload image asset |

---

## Known Limitations (v1)

- No authentication — intended for trusted local / self-hosted use
- No collaboration or real-time sync
- No export / import
- Whiteboard data is browser-local (`localStorage`), not synced to SQLite
- 1 MB per-note soft cap is planned but not yet surfaced in the UI
- No automated test suite yet

---

## License

ISC
