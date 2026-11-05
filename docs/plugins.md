# Plugins

Velocity plugins are small, additive modules in the spirit of Obsidian community plugins.
A plugin can add **commands** (with keyboard shortcuts) to the command palette, **settings**
to Settings → Plugins, a **text prompt** in the palette, a **URL handler** that turns a URL
pasted into quick open (`Mod+P`) into an action, and **note badges** that colour-code its notes
in the notes list. Core code never knows about a specific plugin.

Blog Reader is the first plugin and the reference implementation.

## Anatomy

```
client/src/plugins/
├── types.ts           # VelocityPlugin, PluginContext, PromptSpec, …
├── host.ts            # builds contexts, activates/disposes, exposes commands + URL handlers
├── registry.ts        # PLUGINS = [blogReader, …]  ← the one line you add
└── blogReader/
    ├── index.ts       # manifest, settings, activate(ctx)
    ├── extract.ts     # Readability + metadata (lazy-loaded)
    ├── markdown.ts    # DOM → Markdown
    └── note.ts        # note header / source URL
server/plugins/
├── types.ts           # ServerPlugin { id, name, router }
├── index.ts           # SERVER_PLUGINS, mountPlugins(app) → /api/plugins/<id>
├── shared/fetchPage.ts# SSRF-guarded page fetch (reusable connector transport)
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
