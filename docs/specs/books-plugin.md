# Books plugin: engineering spec

Status: approved for build · Board: Agent Command Center, ACC-19 to ACC-25 · Integration branch: `feat/books-plugin`

Velocity gets a **Books** plugin: add EPUB and PDF files, see them as covers on a **Bookshelf** opened
from the **Books** folder, read them in a **Reader** tile beside your notes, and quote passages into
each book's note. It must feel like a finished part of Velocity, not a developer add-on: same tokens,
same tile chrome, same palette / context-menu / alert patterns as Blog Reader, Herdr and LaTeX.

Read `CLAUDE.md` and `docs/plugins.md` first. The LaTeX plugin (`client/src/plugins/latex/`) is the
closest reference for a plugin with tiles, a store, lazy-loaded heavy code and a server route.

---

## 1. User stories

| ID | Story | Task |
|---|---|---|
| US-1 | As a reader, I add EPUB and PDF files (file picker or drag and drop) and they are kept on my Velocity server, so my library is on every device. | ACC-20, ACC-23 |
| US-2 | As a reader, I find my books in a **Books** folder and open a **Bookshelf** of covers from that folder (or `Ctrl+Alt+L`). | ACC-19, ACC-23 |
| US-3 | As a reader, I read EPUBs comfortably: pages or scroll, contents, font size and family, Auto / Light / Sepia / Dark, and I resume where I left off on any device. | ACC-21, ACC-24 |
| US-4 | As a reader, I read PDFs sharply at any zoom, with the outline, selectable text and page jumps, and I resume where I left off. | ACC-22, ACC-24 |
| US-5 | As a note-taker, I keep a note per book beside the reader and quote a selected passage into it in one click. | ACC-24 |
| US-6 | As a reader, I sort, filter and search my shelf, mark books unread / finished, rename, download and remove them. | ACC-23 |
| US-7 | As a plugin author, I can open a workspace view that is not tied to a note, and add an action to a folder. | ACC-19 |

## 2. Architecture

"Backend stores. Frontend thinks." The server stores book files and a small row per book. All parsing,
metadata and cover extraction, rendering and reading-position logic runs in the browser.

```
client/src/plugins/books/
├── index.ts            ACC-23  manifest, settings, activate(): commands, views, tiles, badges, folderAction
├── api.ts              ACC-23  typed client for /api/plugins/books (upload via XHR with progress)
├── store.ts            ACC-23  zustand: books, uploads, appearance; selectors for shelf sort/filter
├── note.ts             ACC-23  book-note marker, note template, quote Markdown
├── metadata.ts         ACC-23  import pipeline glue: meta + cover → /api/assets → PATCH
├── Bookshelf.tsx/.css  ACC-23  the shelf workspace view
├── ReaderTile.tsx/.css ACC-24  reader tile shell (toolbar, contents, appearance, progress, quotes)
├── position.ts         ACC-24  debounced position persistence (local-first)
└── reader/
    ├── types.ts        scaffold  shared engine contract (do not change without the orchestrator)
    ├── epub/           ACC-21  EpubView.tsx, meta.ts (epubjs 0.3.93)
    └── pdf/            ACC-22  PdfView.tsx, meta.ts, pdf.css (pdfjs-dist 4.10.38)
server/plugins/books/   ACC-20  index.ts (router), store.ts (table), files.ts (upload, sniff, range)
```

Dependencies are already pinned on the integration branch: `epubjs@0.3.93`, `pdfjs-dist@4.10.38`.
Both engines and both views load lazily (`React.lazy` / dynamic `import()`); nothing from them may land
in the main chunk.

### 2.1 Book ↔ note

Every book has one **book note** in the Books folder (title = book title). Its first line is a marker
the plugin owns; the rest is the user's notes:

```md
<!-- velocity-book:12 -->
> **Martin Kleppmann** · EPUB · added 18 Nov 2026

## Notes

```

- `bookIdOf(content)` = `/^<!-- velocity-book:(\d+) -->/` on the first 200 characters. Notes are found
  from `useEditorStore` pastes' content or `cachedContent(id)` (`store/searchStore`), like LaTeX does.
- If a book's note was deleted, opening the book from the shelf creates a fresh note first.
- Removing a book from the shelf deletes the server book (file + row) **and** its note, after a
  destructive confirm (`useUiStore.getState().confirm({...destructive: true})`).

### 2.2 Bookshelf = a note-less workspace view (ACC-19)

Tiles today always belong to a note. ACC-19 adds a fourth tile kind and two plugin hooks:

```ts
// lib/tiling.ts
| { kind: 'view'; pluginId: string; view: string }      // tileKey `view:<pluginId>:<view>`, tileNoteId → null

// plugins/types.ts
export interface WorkspaceView { title: string; icon?: IconName; render: () => ReactNode }
export interface FolderAction { label: string; icon: IconName; run: () => void }
PluginInstance.views?: Record<string, WorkspaceView>
PluginInstance.folderAction?: (folder: { id: number; name: string }) => FolderAction | null
PluginContext.views: { open(view: string, opts?: { focus?: boolean }): string; close(view: string): void; isOpen(view: string): boolean }
```

`views.open`: focus it if open; else fill the focused tile when it is empty; else split beside the
focused tile. The folder action shows (a) as a trailing icon button on the folder row (hover, focus or
selected), (b) as the first item of the folder's context menu, (c) as a button in the notes-column
header while that folder is selected. Books returns `{ label: 'Open Bookshelf', icon: 'books.vertical' }`
for the folder whose name matches its folder setting (case-insensitive).

### 2.3 Server API (ACC-20), mounted at `/api/plugins/books`

JSON routes use the `{ success, data?, error? }` envelope and Zod validation.

```ts
interface Book {
  id: number
  format: 'epub' | 'pdf'
  title: string
  author: string | null
  file_name: string            // original file name
  byte_size: number
  sha256: string
  cover_url: string | null     // '/api/assets/<id>' (cover uploaded by the client through the core assets route)
  position: string | null      // opaque to the server: EPUB CFI or PDF 'page:<n>'
  progress: number             // 0..1
  status: 'unread' | 'reading' | 'finished'
  page_count: number | null
  last_opened_at: string | null
  created_at: string
  updated_at: string
  file_url: string             // '/api/plugins/books/<id>/file'
}
```

| Method | Path | Behaviour |
|---|---|---|
| GET | `/` | `Book[]`, most recently opened first, then newest added |
| GET | `/:id` | `Book` or 404 |
| POST | `/` | Raw file body (not multipart). Headers: `Content-Type` (`application/epub+zip`, `application/pdf` or `application/octet-stream`), `X-File-Name` (URI-encoded). Streamed to disk while hashing; over `BOOKS_MAX_BYTES` (default 200 MB) → 413; format sniffed from bytes (PDF `%PDF-`; EPUB = ZIP whose first entry is `mimetype` containing `application/epub+zip`), else 415; empty → 400. Same sha256 as an existing book → 200 `{ book, duplicate: true }`, else 201 `{ book, duplicate: false }`. Title defaults to the file name without extension. |
| PATCH | `/:id` | Any of `title` (1–300), `author` (≤300 or null), `cover_url` (`^/api/assets/\d+$` or null), `position` (≤4000 or null), `progress` (0–1), `status`, `page_count` (int ≥ 0 or null), `opened: true` (sets `last_opened_at`). Returns `Book`. |
| DELETE | `/:id` | Deletes row and file. 404 if missing. |
| GET | `/:id/file` | The bytes. `Accept-Ranges: bytes`, single `Range` → 206 + `Content-Range`, unsatisfiable → 416. `ETag` = sha256, `Content-Type`, `Content-Disposition: inline; filename*=UTF-8''…`, `Cache-Control: private, max-age=31536000, immutable`. |

Table `plugin_books` (created in `migrate()`); files in `BOOKS_DIR` (default `data/books`, beside
`data/assets`) as `<id>.epub` / `<id>.pdf`. nginx configs need `client_max_body_size 200m;` on `/api/`.

### 2.4 Reader engines (ACC-21, ACC-22)

Both engines implement `reader/types.ts` (already committed). They are pure React components with no
knowledge of notes, the plugin context or the server API: the shell (ACC-24) gives them a URL, a start
position, appearance and resolved colours, and listens to callbacks.

### 2.5 Reading position (ACC-24): local-first

- On every `onLocation`, update the store at once and write `pos.<bookId> = { position, progress, at }`
  to `ctx.storage`. PATCH the server debounced 1.5 s (`position`, `progress`, `status`), and flush on
  tile unmount and `pagehide` with `fetch(..., { keepalive: true })`.
- On open, use whichever of server row / local entry is newer. First open of a session sends `opened: true`.
- `status`: `finished` when progress ≥ 0.98, else `reading` once progress > 0. Never downgrade
  `finished` automatically.

## 3. UX spec (all surfaces)

Tokens only (`client/src/styles/tokens.css`), CSS Modules, no raw hex except the fixed Sepia / Light /
Dark reader palettes in one constant. Every surface works in all 6 theme families, light and dark, and
at phone width. No toasts: `ctx.flash` / `ctx.activity` and inline states only.

**Icons** (add to `components/Icon.tsx`, SF-Symbols-style 24-unit paths like the existing ones):
`books.vertical`, `book`, `list.bullet`, `magnifyingglass`, `arrow.up.arrow.down`,
`line.3.horizontal.decrease`, `minus`, `plus`, `quote.bubble`. ACC-19 adds `books.vertical`; ACC-23
and ACC-24 add the rest they use.

**Bookshelf view** (screenshot reference: a grid of covers with Sort / Filter / Search / New in the bar)
- Bar (38px, like `latex/LatexPreview.module.css .bar`): "Bookshelf" · "11 books" (label-secondary) ·
  spacer · Sort menu (Recently opened, Title, Author, Date added, Progress) · Filter menu (All, Reading,
  Unread, Finished; All formats, EPUB, PDF) · search field (filters title and author as you type) ·
  **Add Books** (accent button, `plus`).
- Grid `repeat(auto-fill, minmax(150px, 1fr))`, gap 28px / 24px, padding 28px. Cover 2:3, `--radius-sm`,
  `--shadow-md`, a 6px spine highlight on the left edge (gradient), hover lift 2px over `--dur-fast`.
  Under it: title (2-line clamp, `--text-subheadline`, 600), author (`--text-footnote`,
  `--label-secondary`), a 3px progress bar in `--accent` while reading, a green "Finished" check when done.
- No cover → a generated cover: background from a `--system-*` colour chosen by hashing the title,
  title and author set in `--font-serif`.
- Card: focusable, Enter / click opens the reader, right-click and a hover `ellipsis.circle` button open
  the context menu (`components/ui/ContextMenu`): Open, Open Notes, Mark as Unread / Mark as Finished,
  Rename…, Download Original, separator, Remove from Library… (destructive confirm).
- Uploading: a placeholder card per file with name and a progress bar; failure shows the reason
  inline (too large, not an EPUB or PDF, server unreachable) with Retry and Dismiss.
- Drag files over the shelf → dashed `--accent` overlay "Drop to add to Books". Dropping EPUB/PDF files
  anywhere in the workspace while the shelf is open imports them.
- Empty state: `books.vertical` icon, "Your bookshelf is empty", "Add EPUB or PDF files, or drop them
  here.", **Add Books…** button.

**Reader tile** (tile header: book title + "Reader", icon `book`)
- Bar: Contents (`list.bullet`) · chapter / page label (truncates) · spacer · ‹ › · progress label
  ("Page 12 of 300" for PDF, "Chapter 3 · 42%" for EPUB) · Appearance (`textformat.size`) · Notes
  (`square.and.pencil`, opens the book note beside).
- Contents: a 280px drawer inside the tile, levels indented, current item highlighted, Escape closes.
- Appearance popover: Theme chips Auto / Light / Sepia / Dark (Auto follows the Velocity theme);
  EPUB: text size − / + (80–160 %), font Serif / Sans / Original, layout Pages / Scroll; PDF: Fit Width,
  Fit Page, − / + zoom (50–400 %). Stored per browser in `ctx.storage('appearance')`.
- A 3px progress track at the bottom; click or drag to jump.
- Selecting text shows a small floating bar: **Quote in Notes** (`quote.bubble`) and Copy. Quote
  appends `> passage\n>\n> — *Chapter 3* · 42%` (PDF: `p. 12`) to the book note and flashes
  "Quoted in <title>".
- Keys while the reader has focus: ←/→, PageUp/PageDown, Space / Shift+Space, Home/End. Engines catch
  keys inside their own iframes / scrollers too.
- Loading: centred spinner "Opening <title>…". Error: "This book couldn't be opened", the reason, Retry
  and Download Original.

**Notes list**: book notes get a badge (`noteBadge`): "EPUB" / "PDF" purple while unread, "42%" blue
while reading, "Finished" green; clicking it opens the reader. Setting toggles badges.

**Commands** (palette section Plugins, prefix "Books:"):
`Open Bookshelf` (`Ctrl+Alt+L`), `Add Books…` (`Ctrl+Alt+Shift+L`), `Open in Reader` (enabled when the
current note is a book note). **Settings**: Books folder name (default `Books`), Mark books in the notes
list (toggle).

## 4. Definition of done (every task)

- Lint and typecheck clean: `cd client && npm run lint && npx tsc --noEmit`.
- Unit tests for new logic; run only the files you touched (CLAUDE.md "Testing in agent sessions").
- No change to unrelated behaviour; `host.test.ts` still passes (it switches every plugin off and on).
- Conventional Commits (`feat(books): …`, `test(books): …`), one branch per task, pushed.
