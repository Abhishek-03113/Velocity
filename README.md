# Velocity

A fast, private, self-hosted notes app. It looks and feels like a native Mac app, and power users get a tiling workspace.

Create, organize, and search notes with near-zero perceived latency. Every interaction resolves instantly in client state while the backend persists asynchronously in the background.

> **"Backend stores. Frontend thinks."**

---

## Features

### Designed like a native Mac app

- Follows the **Apple Human Interface Guidelines**: a system font stack, semantic colours, vibrancy sidebar materials, a unified toolbar, segmented controls, alerts and sheets
- **Light, Dark and Auto** appearance, plus the eight macOS **accent colours**
- **Modular colour themes**: Apple (default), Catppuccin, Catppuccin Macchiato, Gruvbox, Everforest, Nord and Solarized, each in Light and Dark. Pick one in Settings. Each theme also themes the editor's syntax colours (`--syntax-*`), and "Theme default" uses the theme's own accent
- Apple Notes-style three-column layout: Folders, a notes list with date sections, previews and folder chips, and the editor
- Untitled notes take their **title from the first line**
- **Folders**: Unfiled is listed last. Move a note with the folder chip on its row, the folder subtitle in the toolbar, or `Ctrl+Alt+M` (palette move mode). Each menu offers "New Folder…". Dragging is forgiving: drop on a folder header, and folders spring open while you hover
- A fountain-pen logo (`client/public/brand/`) is used as the favicon and in the sidebar
- Responsive layout: the folders column collapses below 1180 px, and phones get an overlay sidebar with a single tile

### Tiling workspace (Hyprland-style)

- Split the editor into **tiles** and work on several notes side by side
- **Dwindle auto-tiling**: each new tile splits the focused one along its longer side
- **Sliding mode** (`Ctrl+Alt+T` toggles it) is the scrolling alternative, in the style of niri and PaperWM. Tiles sit in columns on a horizontal strip that scrolls to keep the focused column in view
  - `Ctrl+Alt+C` cycles the column width (½, ⅔, full, ⅓). `Ctrl+Alt+-` stacks a tile in the focused column
  - Focus, swap, split, close and zoom work per column
  - Wheel or drag to pan, drag a column edge to resize, and use the column minimap to jump
  - The mode is a "Tiling" row in Settings and is stored with the layout
- Directional focus, swap, zoom (monocle), rotate split, equalise, and drag-to-resize dividers
- Drag a note from the sidebar or the tab bar onto a tile edge to split there. Drop it in the centre to replace the note
- Empty tiles act as a launcher: type to filter, then press ↩ to open
- The whiteboard is just another tile (`⌘⇧D`). Whiteboards are stored in SQLite, so they sync across devices like notes do
- Tabs and the tile layout are restored after a reload

### Editor

- **CodeMirror 6** with Obsidian-style live preview: headings, emphasis, bullets, round checklist toggles and images
- Proportional reading type by default. Choose System, Serif or Mono, set the text size and line width
- **Read mode** (`⌘E`) for typeset Markdown, sanitised with DOMPurify
- Formatting shortcuts: bold, italic, strikethrough, inline code, link, cycle heading, checklist
- Paste or drop images. They are stored as server-side assets
- Status bar: words, characters, save state, and a warning when a note passes the 1 MB soft cap

### Whiteboards

- Each note can have an Excalidraw whiteboard. The scene is saved to the server (`whiteboards` table, up to 10 MB) through a queued, retrying save (`client/src/lib/boardSync.ts`), so a board drawn on one device loads on another
- Deleting a note deletes its board. Boards previously kept in `localStorage` are uploaded once on first load (`client/src/lib/boardMigration.ts`)

### Find anything

- **Command palette** (`⌘P`): full-text note search with highlighted matches. Type `>` to run any command. `⌘↩` opens the result in a new tile
- FlexSearch index cached in `localStorage`, so it is never rebuilt cold
- Find in note (`⌘F`)

### Sync & durability

- **Local-first**: the UI never waits on the network
- An auto-save worker with per-note revisions and a single in-flight request. It sends partial payloads, debounces for 800 ms with a 5 s max-wait, and **flushes on tab close and page hide**
- Back-off retries, then a visible "Offline" state. Saving resumes automatically on reconnect. `⌘S` forces a save
- Destructive actions (delete note, delete folder) use HIG alerts, with Cancel as the default
- **Markdown export worker** mirrors every note to `~/velocity_docs`. It is event-driven and incremental, follows renames and deletes, and copies images next to the Markdown files
- **Empty-note cleanup**: untitled, blank notes with no whiteboard are pruned so they do not pile up. The client removes inactive ones (not open, not dirty, older than 30 s) and keeps the 5 most recently used. A server sweep runs on startup and hourly, never touches notes edited in the last 10 minutes, and can be disabled with `EMPTY_NOTE_CLEANUP=off`

---

## Keyboard Shortcuts

Browsers reserve `⌘/Ctrl + N`, `W`, `T` and `1–9`, so they never reach a web page. Every such action also lives on the **`⌃⌥` (Ctrl + Alt) layer**, which works the way Hyprland's Super key does for window management. Shortcuts match physical keys, so they work on any keyboard layout. `AltGr` is ignored, so typing `@ { [ €` never triggers a shortcut.

`Mod` is `⌘` on macOS and `Ctrl` on Windows and Linux. Press `Mod + /` in the app for the full sheet.

| Action | Shortcut |
|---|---|
| New note | `Ctrl+Alt+N` (`Mod+N` where the browser allows it) |
| New note in a new tile | `Ctrl+Alt+Shift+N` |
| Close note tab | `Ctrl+Alt+W` |
| Rename note | `F2` |
| Move note to folder | `Ctrl+Alt+M` |
| Save now | `Mod+S` |
| Delete note | `Mod+Shift+Backspace` |
| Export as Markdown | `Mod+Shift+E` |
| Search notes / quick open | `Mod+P` or `Mod+Shift+F` |
| Command palette | `Mod+Shift+P` or `F1` |
| Find in note | `Mod+F` |
| Next / previous tab | `Ctrl+Alt+]` / `Ctrl+Alt+[` |
| Go to tab 1–9 | `Ctrl+Alt+1…9` |
| Focus notes list | `Ctrl+Alt+0` |
| Split tile (auto) | `Mod+\` |
| Split right / down | `Ctrl+Alt+\` / `Ctrl+Alt+-` |
| Focus tile | `Ctrl+Alt+Arrows` or `Ctrl+Alt+H/J/K/L` |
| Move note to neighbouring tile | `Ctrl+Alt+Shift+Arrows` |
| Zoom tile | `Ctrl+Alt+Enter` |
| Close tile | `Ctrl+Alt+Q` |
| Equalise / rotate split | `Ctrl+Alt+=` / `Ctrl+Alt+R` |
| Toggle tiling mode (dwindle / sliding) | `Ctrl+Alt+T` |
| Cycle column width (sliding) | `Ctrl+Alt+C` |
| Toggle sidebar / folders | `Ctrl+Alt+S` / `Ctrl+Alt+Shift+S` |
| Read mode | `Mod+E` |
| Whiteboard tile | `Mod+Shift+D` |
| Text size | `Mod+=` / `Mod+-` / `Mod+0` |
| Settings | `Mod+,` |
| Bold / italic / link | `Mod+B` / `Mod+I` / `Mod+K` |
| Strikethrough / inline code | `Mod+Shift+X` / `Mod+Shift+M` |
| Cycle heading / checklist | `Mod+Shift+H` / `Mod+Shift+L` |
| Multi-cursor | `Alt + Click` |

In the notes list, `↑`/`↓` browse, `↩` opens, `⌘↩` or `Alt+↩` opens in a new tile, and `⌫` deletes after confirmation.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18 + Vite | Fast builds, small bundles |
| Editor | CodeMirror 6 | Multi-cursor, Markdown, keymaps |
| Whiteboard | Excalidraw | Per-note drawing canvas (lazy-loaded) |
| State | Zustand | Client-side source of truth |
| Search | FlexSearch | Sub-10 ms full-text search |
| Styling | CSS Modules + HIG design tokens | Scoped, zero-runtime styles; light/dark/accent and colour-family theming |
| Backend | Hono on Node.js | Thin REST API (gzip for note bodies) |
| Database | SQLite (better-sqlite3) | Embedded persistence |
| Tests | Vitest, node:test, Playwright | Unit, API/worker, end-to-end |
| Deploy | Docker Compose + nginx | Self-contained deployment |

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

| Service         | URL                    |
| --------------- | ---------------------- |
| Client          | http://localhost:37801 |
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

| Service | URL                   |
| ------- | --------------------- |
| Client  | http://localhost:5173 |
| Server  | http://localhost:3000 |

```bash
npm run dev:client   # Vite only
npm run dev:server   # Hono only
npm run build        # production client build
cd client && npm run lint
```

### Tests

```bash
cd client && npm test            # Vitest: tiling and sliding engines, auto-save worker, board sync, cleanup, themes, shortcuts
cd server && npm test            # node:test: API routes, whiteboards, cleanup + Markdown export worker
cd client && npm run test:e2e    # Playwright (headless Chromium): full product walkthrough
```

The E2E suite starts its own API server on a throwaway database. It writes review screenshots to [`docs/screenshots/after/`](docs/screenshots/after). The original UI is preserved in [`docs/screenshots/before/`](docs/screenshots/before), and the redesign plan and UX audit are in [`docs/ux-revamp/PLAN.md`](docs/ux-revamp/PLAN.md).

---

## Project Structure

```
Velocity/
├── client/                    # Vite + React frontend
│   ├── e2e/                   # Playwright end-to-end suite
│   └── src/
│       ├── components/
│       │   ├── chrome/        # Toolbar, tab bar, status bar
│       │   ├── sidebar/       # Folders + notes list
│       │   ├── workspace/     # Tiling workspace, tiles, empty-tile launcher
│       │   ├── overlays/      # Command palette, alerts, settings, shortcuts sheet
│       │   └── ui/            # HIG controls (segmented, toolbar button, menu, kbd)
│       ├── lib/               # tiling + sliding engines, sync engine, board sync, themes registry, cleanup, command registry, workspace actions
│       ├── store/             # Zustand: editor, layout, ui, groups, search
│       └── styles/            # Design tokens + global base styles
│           └── themes/        # One CSS file per theme family
│   └── public/brand/          # Logo and favicons
├── server/                    # Hono + Node.js backend
│   ├── routes/                # /api/pastes, /api/groups, /api/assets, whiteboards
│   ├── db/                    # SQLite client + migrations
│   ├── workers/               # Markdown export + empty-note cleanup workers
│   └── tests/                 # API + worker tests
├── docs/                      # Redesign plan, before/after screenshots
├── data/                      # SQLite database (gitignored)
├── docker-compose.yml
└── Makefile
```

---

## Environment Variables

Copy `.env.example` to `.env` before starting.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Hono server listen port |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin |
| `VITE_API_URL` | `http://localhost:3000` | API base URL (client build-time) |
| `DB_PATH` | `data/velocity.db` | SQLite database file |
| `ASSETS_DIR` | `data/assets` | Uploaded image storage |
| `DOCS_DIR` | `~/velocity_docs` | Markdown export folder |
| `DOCS_SYNC` | `on` | Set to `off` to disable the Markdown export worker |
| `EMPTY_NOTE_CLEANUP` | `on` | Set to `off` to disable the server's empty-note sweep |

For Docker, set `CLIENT_URL=http://localhost:37801` and `VITE_API_URL=http://localhost:37800` in `.env`.

---

## API

All routes return `{ success, data?, error? }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pastes` | List notes (metadata only; includes `has_whiteboard`, `is_empty`, `content_length`) |
| `GET` | `/api/pastes/:id` | Fetch note with content |
| `POST` | `/api/pastes` | Create note |
| `PUT` | `/api/pastes/:id` | Partial update (returns metadata, not the body) |
| `DELETE` | `/api/pastes/:id` | Delete note. With `?only_if_empty=1` it returns `409` if the note has gained content |
| `GET/PUT/DELETE` | `/api/pastes/:id/whiteboard` | Read, save or remove a note's whiteboard scene (`413` above 10 MB) |
| `GET/POST/PUT/DELETE` | `/api/groups` | Group CRUD |
| `POST` | `/api/assets` | Upload image asset |

---

## Known Limitations

- No authentication. Velocity is intended for trusted local or self-hosted use
- No collaboration or real-time sync. Whiteboards load from the server when a note is opened, not live
- Preferences and the tile layout are stored per browser (`localStorage`). Notes and whiteboards are stored in SQLite
- Browser-reserved shortcuts (`⌘N`, `⌘W`, `⌘1`) only work where the browser passes them through. Use the `⌃⌥` equivalents

---

## License

ISC
