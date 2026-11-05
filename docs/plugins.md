# Plugins

Velocity plugins are small, additive modules in the spirit of Obsidian community plugins.
A plugin can add **commands** (with keyboard shortcuts) to the command palette, **settings**
to Settings → Plugins, a **text prompt** in the palette, a **URL handler** that turns a URL
pasted into quick open (`Mod+P`) into an action, **note badges** that colour-code its notes
in the notes list, **workspace tiles** that sit beside a note, and an **editor mode** for notes
that are its kind of document. Core code never knows about a specific plugin.

Blog Reader is the first plugin and the reference implementation.

## Anatomy

```
client/src/plugins/
├── types.ts           # VelocityPlugin, PluginContext, PromptSpec, …
├── host.ts            # builds contexts, activates/disposes, exposes commands + URL handlers
├── registry.ts        # PLUGINS = [blogReader, …]  ← the one line you add
├── latex/             # live preview tile, PDF compile, .tex / PDF export
└── blogReader/
    ├── index.ts       # manifest, settings, activate(ctx)
    ├── extract.ts     # Readability + metadata (lazy-loaded)
    ├── markdown.ts    # DOM → Markdown
    └── note.ts        # note header / source URL
server/plugins/
├── types.ts           # ServerPlugin { id, name, router }
├── index.ts           # SERVER_PLUGINS, mountPlugins(app) → /api/plugins/<id>
├── shared/fetchPage.ts# SSRF-guarded page fetch (reusable connector transport)
├── latex/             # POST /api/plugins/latex/compile (TeX engine on the host)
└── blogReader.ts      # GET /api/plugins/blog-reader/fetch?url=
```

"Backend stores. Frontend thinks." still holds: a server plugin is only a transport for what
the browser can't do itself (cross-origin fetches, for example). Parsing and note creation stay on the
client, and notes are saved through the normal pastes API, so sync, search and Markdown export
work unchanged.

## Writing a plugin

```ts
// client/src/plugins/hello/index.ts
import type { VelocityPlugin } from '../types'

const hello: VelocityPlugin = {
  manifest: { id: 'hello', name: 'Hello', description: 'Says hello.', icon: 'doc.text', version: '1.0.0' },
  settings: [{ key: 'greeting', type: 'text', label: 'Greeting', default: 'Hello' }],
  activate(ctx) {
    return {
      commands: [
        {
          id: 'insert',
          title: 'New Greeting Note',
          keys: ['Ctrl+Alt+Shift+KeyH'],
          run: () => ctx.notes.create({ title: 'Greeting', content: ctx.setting<string>('greeting'), folder: 'Hello' }),
        },
      ],
      dispose: () => {},
    }
  },
}
export default hello
```

Then add it to `PLUGINS` in `registry.ts`. Its commands show up in the palette under **Plugins**
as `Hello: New Greeting Note`, and in the shortcuts sheet. Settings → Plugins gets a toggle and
the settings rows. Built-in shortcuts always win over plugin shortcuts.

### `PluginContext`

| Member | What it does |
|---|---|
| `setting(key)` | Current value, falling back to the manifest default |
| `storage.get/set` | Per-plugin JSON bag in `localStorage` (`velocity.plugin.<id>.v1`) |
| `flash(msg)` / `activity(msg \| null)` | Status-bar message (brief) / long-running status. There are no toasts |
| `prompt(spec)` | Spotlight-style text input. `↩` submits and `⌘↩` submits with `split: true` |
| `pick(spec)` | Palette list mode: the user filters and picks one item. Items can have sections, a badge, and be disabled with a hint |
| `panel.open / close / isOpen` | A large plugin-rendered panel over the workspace (one at a time; Escape closes it) |
| `api.get(path)` / `api.post(path, body)` | `/api/plugins/<id><path>`, unwraps the `{ success, data, error }` envelope; both take `{ headers }` (errors keep their HTTP `status`) |
| `api.stream(path, handlers, opts)` | Server-sent events read over `fetch`, so a token header can be sent; reconnects with back-off; returns a stop function |
| `notes.create / open / exists / current` | Create a note (in a folder, optionally in a new tile and in Read mode), open one, and so on |
| `notes.title / content / append / selection` | A note's title, its Markdown (loaded if needed), append Markdown, the editor selection |
| `notes.useContent(id)` | React hook for plugin components: the note's content, re-rendering as it changes |
| `notes.goToLine(id, line)` | Show the note in its editor with that line selected (e.g. a compiler error) |
| `tiles.open / close / toggle / isOpen` | A workspace tile showing one of the plugin's `tiles` views for a note, beside the note's tile |
| `files.download(name, data, mime?)` | Hand the user a file (`Blob` or string) as a browser download |
| `boards.has / exportPng` | Whether the note has a whiteboard; render it to a PNG data URL with Excalidraw |
| `folders.ensure(name)` | Existing folder (case-insensitive) or a new one |
| `refreshBadges()` | Re-read this plugin's note badges after their state changes |

A `text` setting with `secret: true` is masked in Settings.

### Note badges

Return `noteBadge(noteId)` from `activate` to mark your notes in the sidebar list: a tinted edge
on the row and a small pill (`{ label, tone, title?, onClick? }`, where `tone` is a system colour
such as `blue` or `green`). With `onClick` the pill is a button, and its `title` also appears in the
row's context menu. Return `null` for notes the plugin doesn't own. It runs for every visible row,
so keep it cheap, and call `ctx.refreshBadges()` whenever the answer changes.

### Workspace tiles

Return `tiles: { <view>: { title, icon?, render(noteId) } }` from `activate`, then call
`ctx.tiles.open(view, noteId)`. The view gets its own tile beside the note's tile (a real tile:
focus, swap, zoom, close, drag and sliding columns all work). The layout stores it as
`{ kind: 'plugin', pluginId, view, noteId }`, so it is restored after a reload, follows the note's
temp → server id swap and closes when the note is deleted. While the plugin is off, the tile says
so instead of rendering. `render` is called by React, so lazy-load heavy components inside it and
keep state in a store; `ctx.notes.useContent(noteId)` keeps a view in step with the note.

### Editor modes

Return `editorMode: { matches(content), extensions() }` to edit your kind of note with its own
CodeMirror language instead of Markdown and its live preview. `matches` sees the first 4,000
characters and runs as the user types, so keep it to a regex. The editor swaps modes in place
when the answer changes (no remount) and when plugins are switched on or off. The first running
plugin whose `matches` returns true wins.

Enabled state and settings are stored per browser in `velocity.plugins.v1`, like other preferences.

## Server side (optional)

```ts
// server/plugins/hello.ts
import { Hono } from 'hono'
import type { ServerPlugin } from './types.ts'
const router = new Hono()
router.get('/ping', (c) => c.json({ success: true, data: 'pong' }))
export const helloPlugin: ServerPlugin = { id: 'hello', name: 'Hello', router }
```

Add it to `SERVER_PLUGINS` in `server/plugins/index.ts`. It is served at `/api/plugins/hello/ping`.
A plugin with its own tables sets `migrate()` (run once when plugins are mounted, at startup); one
with timers or connections sets `dispose()`.
To fetch remote pages, use `fetchPage()` from `shared/fetchPage.ts`. It allows only http(s), blocks
private and loopback hosts (set `PLUGIN_FETCH_ALLOW_PRIVATE=on` to allow them), re-checks every
redirect, and caps time (15 s) and size (5 MB).

## Blog Reader

- **Open:** `Ctrl+Alt+B` → paste a URL → `↩`. Or paste a URL into quick open (`Mod+P`) and pick
  **Open in Blog Reader**. `⌘↩` flips the "Open in" setting between a new tile and the current tile.
- The post opens as a note in the **Blogs** folder (created if it doesn't exist). By default it opens
  in a new tile beside the current note, in Read mode, so you can read it, take notes or draw a
  whiteboard side by side. `Mod+E` switches to editing so you can annotate the article itself.
- The note starts with a source header (`> [Site](url) · Author · Date`, `> Saved … · n min read`),
  followed by the article as Markdown: headings, lists, code fences with their language, tables,
  quotes and images (remote URLs, rendered inline).
- Opening the same URL again opens the existing note. **Blog Reader: Refresh Article** fetches
  the current article again and replaces its content.
- **Read status:** every Blog Reader note is colour-coded in the notes list: a blue **Unread**
  pill and edge, or a green **Read** one. Click the pill, use the row's context menu, or press
  `Ctrl+Alt+Shift+B` (**Blog Reader: Mark as Read / Unread**) on the open post to flip it. The
  state is kept per browser in the plugin's storage, and survives **Refresh Article**.
- Settings: folder name, open in new or current tile, Read mode, include images, colour-code read status.

## Herdr

Shares a note with a coding agent that is already running in [herdr](https://herdr.dev) (Claude
Code, Codex, OpenCode and the rest) and follows every conversation on one **Agents board**. Velocity
starts no agent processes: it is a client of herdr's local socket API.

### Setup

1. Run herdr 0.9.0 or later and start agents in its panes. For Claude Code, also run
   `herdr integration install claude`, so summaries can be read from Claude's transcript.
2. On the Velocity server, set `HERDR_CONNECTOR_TOKEN` (any long random string). Without it every
   `/api/plugins/herdr` route answers 503. `HERDR_SOCKET_PATH` or `HERDR_SESSION` choose the socket;
   the default is `~/.config/herdr/herdr.sock`.
3. In Settings → Plugins → Herdr, paste the same token.

### Use

- **Share Note with Agent** (`Ctrl+Alt+G`): the first send to an agent is the note's title and every
  paragraph; after that only paragraphs Velocity hasn't sent before (it keeps fingerprints, never
  the text). A selection is sent as it is. **Share Note with Another Agent…** (`Ctrl+Alt+Shift+G`)
  always opens the agent picker. Agents that need you can't be picked.
- **Attachments:** images embedded from Velocity (`/api/assets/<id>`) and the note's whiteboard (a PNG
  rendered in the browser plus the Excalidraw scene) are written to
  `<agent folder>/.velocity/attachments/<turn>/`; the prompt points at those files and `.velocity/` is
  added to the repo's `.git/info/exclude`. When Velocity runs in Docker, set
  `HERDR_ATTACHMENTS_DIR` (a folder the container can write) and `HERDR_ATTACHMENTS_HOST_DIR` (the
  same folder on the host); agents may then ask permission to read files outside their own folder.
- **Summaries:** each send ends by asking the agent for a summary of what it implemented between
  `<velocity-summary id="…">` marker lines. When herdr reports the agent idle, Velocity reads that
  block, whole, from Claude Code's transcript or from the agent's screen. Without a block it keeps
  the final message (Claude Code). The transcript itself is never stored.
- **Agents board** (`Ctrl+Alt+A`): Shared, Working, Blockers, Completed, following herdr's live state.
  Click a card for the conversation: each turn's summary with Copy and **Add summary to note** (an
  `### Outcome · <agent> · <time>` section; Off / Ask / Always in Settings), the agent's screen for
  blockers, and **Open in herdr**. Velocity never answers approvals.
- Note badges: Shared, Working, Needs you, New summary, Summary, Didn't finish, Check agent.

### Server pieces

`server/plugins/herdr/`: `socket.ts` (NDJSON client with a method allow-list: no raw keys, no shell
input, no layout changes), `service.ts` (prompt + wait, Needs you, restart recovery, agent polling),
`summary.ts`, `transcript.ts`, `attachments.ts`, `store.ts` (`plugin_herdr_conversations`,
`plugin_herdr_turns`). Tests run against `server/tests/fixtures/fakeHerdr.ts`.

Not built yet: a host bridge for Docker Desktop (Unix sockets don't cross its VM), showing the board
as a workspace tile beside the editor (it is a panel for now), and margin marks on sent paragraphs.

## LaTeX

Write LaTeX in a note and read it typeset beside it, then compile to a real PDF on the server.

- **New LaTeX Document** (palette) creates a note from a template in the **LaTeX** folder and opens
  the preview beside it. Any note works: one with `\documentclass` (or `\begin{document}`) is a
  full document; anything else is a body that compiles inside an article preamble (amsmath,
  amssymb, amsthm, graphicx, hyperref, plus `\newtheorem`s for the theorem environments it uses).
- **Toggle Live Preview** (`Ctrl+Alt+X`, or click the note's **TeX** pill): a tile with the
  document typeset as you type: title block, numbered sections and table of contents, lists,
  tables, figures and captions, theorems and proofs, footnotes, `\label` / `\ref` / `\eqref` / `\cite`,
  verbatim and listings, and maths with KaTeX (equations numbered, `\newcommand` macros work in
  maths and text). It is a preview, not TeX: unknown commands show muted and are listed in the
  tile's status line, and TikZ shows a placeholder.
- **Compile to PDF** (`Ctrl+Alt+Shift+X`): the tile's **PDF** view shows the PDF from the server's
  TeX engine. Errors and warnings are listed with their line; click one to jump to it in the note
  (lines of a wrapped body are mapped back). With **Recompile as you type** on, the PDF view
  compiles again 1.5 s after you stop typing.
- **Export as .tex** saves the source (a body is saved wrapped, so it compiles on its own).
  **Export as PDF** compiles if needed and saves the PDF. Without a TeX engine on the server it
  prints the live preview instead (choose "Save as PDF" in the print dialog).
- `\documentclass` notes are edited with LaTeX syntax highlighting instead of rich Markdown.
- Settings: TeX engine (Auto, latexmk, pdfLaTeX, XeLaTeX, LuaLaTeX, Tectonic), recompile as you type,
  folder for new documents, TeX pills in the notes list.

### Server

Compiling needs a TeX distribution on the machine running the Velocity server: TeX Live,
MiKTeX or Tectonic, with `latexmk`, `pdflatex`, `xelatex`, `lualatex` or `tectonic` on `PATH`. In
Docker, build the server image with `LATEX=on docker compose build server` (adds a TeX Live subset).
`GET /api/plugins/latex/status` reports what was found.

`POST /api/plugins/latex/compile { source, engine? }` writes the source to a fresh temporary folder,
runs the engine there (reruns for cross-references) and deletes the folder. Nothing is stored. Shell
escape is off, kpathsea runs in paranoid mode (`openin_any=p`, `openout_any=p`: no absolute paths,
no `..`, no dot files), latexmk ignores rc files (`-norc`) and Tectonic runs `--untrusted`. A run is
killed with its process group after `LATEX_TIMEOUT_MS` (30 s). Sources are capped at 2 MB, PDFs at
`LATEX_MAX_PDF_BYTES` (20 MB), and `LATEX_MAX_CONCURRENT` (2) engines run at once with up to 8
waiting (then 429). TeX errors are not HTTP errors: the answer is `{ ok, pdf (base64), log, issues,
engine, durationMs }`. `LATEX_ENGINE` picks the default engine, `LATEX_BIN_DIR` is searched before
`PATH`, and `LATEX_COMPILE=off` turns compiling off (503).

Images: `\includegraphics` with an `https://` URL or a Velocity asset (`/api/assets/<id>`) shows in
the live preview; the TeX engine only sees the note, so the PDF shows images it can find itself.
