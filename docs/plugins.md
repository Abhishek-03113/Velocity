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
| `api.get(path)` | `GET /api/plugins/<id><path>`, unwraps the `{ success, data, error }` envelope |
| `notes.create / open / exists / current` | Create a note (in a folder, optionally in a new tile and in Read mode), open one, and so on |
| `folders.ensure(name)` | Existing folder (case-insensitive) or a new one |
| `refreshBadges()` | Re-read this plugin's note badges after their state changes |

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
