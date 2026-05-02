# Velocity

A self-hosted paste manager built for speed. Create, organize, and search text snippets with near-zero perceived latency — every interaction resolves instantly in client state while the backend persists asynchronously in the background.

---

## Features

- Browser-style tab bar — open multiple pastes simultaneously with inline rename
- CodeMirror 6 editor — multi-cursor, Markdown support, syntax highlighting
- Instant full-text search across titles and content (FlexSearch, client-side)
- Sidebar paste list with group/folder organization
- Local-first architecture — UI never waits for the server
- Debounced persistence with a dirty-state indicator and retry queue

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend framework | React 18 + Vite | Fast builds, small bundles |
| Editor engine | CodeMirror 6 | Multi-cursor, Markdown, keymaps |
| State management | Zustand | Lightweight client-side store |
| Search | FlexSearch | Sub-10ms full-text search |
| Styling | CSS Modules | Scoped styles, zero runtime cost |
| Backend framework | Hono on Node.js | Thin REST API |
| Database | SQLite (better-sqlite3) | Embedded, zero-config persistence |
| Proxy / serving | nginx | Reverse proxy + static file serving |
| Containerisation | Docker + Compose | Self-contained deployment |

---

## Local Setup

### Option 1 — Docker (recommended)

Requires Docker and Docker Compose.

```bash
# 1. Clone the repo
git clone <repo-url> velocity
cd velocity

# 2. Configure environment
cp .env.example .env

# 3. Start everything
make up
```

| Service | URL |
|---|---|
| Client | http://localhost:37801 |
| API (via proxy) | http://localhost:37800 |

Other Makefile targets:

```bash
make down      # stop all containers
make restart   # rebuild images and restart
```

### Option 2 — Local dev (no Docker)

Requires Node.js 18+.

```bash
# 1. Install all dependencies (root + client + server)
npm run install:all

# 2. Configure environment
cp .env.example .env

# 3. Start client and server concurrently
npm run dev
```

| Service | URL |
|---|---|
| Client | http://localhost:5173 |
| Server | http://localhost:3000 |

Individual processes:

```bash
npm run dev:client   # Vite dev server only
npm run dev:server   # Hono server only
```

---

## Project Structure

```
Velocity/
├── client/               # Vite + React frontend
│   └── src/
│       ├── components/   # Editor, PasteList, ModeToggle
│       ├── store/        # Zustand state (pastes, active tab)
│       └── lib/          # API client
├── server/               # Hono + Node.js backend
│   ├── routes/           # Paste and group API routes
│   └── db/               # SQLite client (better-sqlite3)
├── data/                 # SQLite database file (gitignored)
├── docker-compose.yml
├── Makefile
└── .env.example
```

---

## Environment Variables

Copy `.env.example` to `.env` before starting.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the Hono server listens on |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin |
| `VITE_API_URL` | `http://localhost:3000` | API base URL used by the client |
