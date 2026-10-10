# Velocity UI/UX Revamp: Results

Branch: `feature/apple-hig-ui-revamp`. The plan and the full UX audit are in [PLAN.md](PLAN.md).

## Before and after

| | Before | After |
|---|---|---|
| Main window | ![](../screenshots/before/01-main.png) | ![](../screenshots/after/12-library-light.png) |
| Search | ![](../screenshots/before/02-search.png) | ![](../screenshots/after/21-palette-search.png) |
| Phone | ![](../screenshots/before/03-mobile.png) | ![](../screenshots/after/69-mobile-editor.png) |

The screenshots from this round are in [Round 2](#round-2-themes-folders-synced-whiteboards-cleanup-sliding-tiling). Every screenshot in `docs/screenshots/after/` comes from the Playwright suite (`cd client && npm run test:e2e`) and is regenerated on each run:

| # | Screen |
|---|---|
| 01 | First-run welcome note |
| 02 | Folder filter |
| 03 | Library, light |
| 04 | New note autosaved |
| 05 | Inline rename (F2) |
| 06–11 | Folders and move menus (Round 2) |
| 12 | Palette: full-text search |
| 13 | Palette: commands (`>`) |
| 14 | Dark mode |
| 15 | Empty tile launcher |
| 16 | Three tiles, dwindle layout |
| 17 | Zoomed tile |
| 18 | Rotated split |
| 19 | Layout restored after reload |
| 20 | Drag a note onto a tile edge |
| 21 | Whiteboard as a tile |
| 22 | Read mode |
| 23 | Delete alert (HIG) |
| 24 | Offline indicator |
| 25 | Settings sheet |
| 26 | Orange accent + serif font |
| 27–53 | Themes, picker and app per family and appearance (Round 2) |
| 54 | Keyboard shortcuts sheet |
| 55 | Sidebar hidden |
| 56 | Dark, tiled, with whiteboard |
| 57 | Phone: editor |
| 58 | Phone: sidebar sheet |
| 59–61 | Empty-note cleanup and synced boards (Round 2) |
| 62–71 | Sliding tiling mode (Round 2) |

## Round 2: themes, folders, synced whiteboards, cleanup, sliding tiling

Branch: `feature/themes-groups-whiteboard-sync-tiling-modes`. Screenshots are in `docs/screenshots/after/`.

### Colour themes

Seven families at this point (Apple, Catppuccin, Catppuccin Macchiato, Gruvbox, Everforest, Nord, Solarized), each Light and Dark. Round 3 below replaces this set with six families that have variants. Each family is one CSS file in `client/src/styles/themes/`, registered in `client/src/lib/themes.ts` and in the pre-paint map in `client/index.html`, so there is no flash on load. `--syntax-*` variables theme the editor, and "Theme default" follows the family's accent.

| Screen | Shot |
|---|---|
| Picker, Apple | ![](../screenshots/after/36-theme-picker-apple.png) |
| Catppuccin light / dark | ![](../screenshots/after/38-app-catppuccin-light.png) ![](../screenshots/after/40-app-catppuccin-dark.png) |
| Gruvbox light / dark | ![](../screenshots/after/42-app-gruvbox-light.png) ![](../screenshots/after/44-app-gruvbox-dark.png) |
| Everforest light / dark | ![](../screenshots/after/46-app-everforest-light.png) ![](../screenshots/after/48-app-everforest-dark.png) |
| Solarized light / dark | ![](../screenshots/after/50-app-solarized-light.png) ![](../screenshots/after/52-app-solarized-dark.png) |
| Nord light / dark | ![](../screenshots/after/54-app-nord-light.png) ![](../screenshots/after/56-app-nord-dark.png) |
| Whiteboard and find panel in Gruvbox dark | ![](../screenshots/after/57-whiteboard-gruvbox-dark.png) ![](../screenshots/after/58-find-panel-gruvbox-dark.png) |

The `*-theme-picker-*` shots in `after/` show Settings for each family and appearance.

### Folders

Unfiled is listed last. "Move to Folder" is on the note-row chip, the toolbar folder subtitle and `Ctrl+Alt+M`, and every menu has "New Folder…". Drops on a folder header work, and folders spring open on hover. The fountain-pen logo is the favicon and sidebar mark.

| Screen | Shot |
|---|---|
| Unfiled last | ![](../screenshots/after/15-folders-unfiled-last.png) |
| Move menu from the row chip | ![](../screenshots/after/16-move-menu-row.png) |
| Move menu from the toolbar | ![](../screenshots/after/17-move-menu-toolbar.png) |
| New Folder… | ![](../screenshots/after/18-move-new-folder.png) |
| Palette move mode | ![](../screenshots/after/19-move-palette.png) |
| Header drop and spring-open | ![](../screenshots/after/20-drag-header-spring-open.png) |

### Whiteboards in SQLite

Scenes live in the `whiteboards` table (`ON DELETE CASCADE`), behind `GET/PUT/DELETE /api/pastes/:id/whiteboard` with a 10 MB cap. `boardSync.ts` queues saves, `boardMigration.ts` uploads old `localStorage` boards once, and list rows carry `has_whiteboard`.

| Screen | Shot |
|---|---|
| Board drawn on device A | ![](../screenshots/after/72-board-drawn-device-a.png) |
| Same board loaded on device B | ![](../screenshots/after/73-board-loaded-device-b.png) |

### Empty-note cleanup

Untitled, blank, board-less notes are pruned. The client removes inactive ones (not open, not dirty, over 30 s old) beyond the 5 most recently used, using the guarded `DELETE ?only_if_empty=1` (409 if the note gained content). A server sweep runs at startup and hourly, skips notes edited in the last 10 minutes, and is disabled with `EMPTY_NOTE_CLEANUP=off`.

| Screen | Shot |
|---|---|
| Empty notes pruned | ![](../screenshots/after/71-empty-notes-pruned.png) |

### Sliding tiling

A scrolling mode beside dwindle, in `client/src/lib/sliding.ts`. The layout persists to `velocity.layout.v3` and migrates from v2. `Ctrl+Alt+T` toggles the mode, `Ctrl+Alt+C` cycles column width (½, ⅔, full, ⅓) and `Ctrl+Alt+-` stacks a tile. Wheel or drag pans, a column edge resizes, and a minimap shows the strip.

| Screen | Shot |
|---|---|
| Switch mode from the palette | ![](../screenshots/after/74-sliding-palette.png) |
| Four columns | ![](../screenshots/after/75-sliding-four-columns.png) |
| Scrolled to the start | ![](../screenshots/after/76-sliding-scrolled-start.png) |
| Width ⅔ / full / ⅓ | ![](../screenshots/after/77-sliding-width-two-thirds.png) ![](../screenshots/after/78-sliding-width-full.png) ![](../screenshots/after/79-sliding-width-third.png) |
| Stacked tiles | ![](../screenshots/after/80-sliding-stacked.png) |
| Back to dwindle | ![](../screenshots/after/81-sliding-back-to-dwindle.png) |
| Settings "Tiling" row | ![](../screenshots/after/82-sliding-settings.png) |
| Dark | ![](../screenshots/after/83-sliding-dark.png) |

Excalidraw is also pre-bundled through `optimizeDeps.include` in `client/vite.config.ts`, so the first whiteboard open in dev no longer triggers a dependency re-optimise.

## Round 3: built-in theme families

Branch: `feature/themes-groups-whiteboard-sync-tiling-modes`. Round 2's seven families became six, with per-appearance **variants**. Variants are declared in `client/src/lib/themes.ts` (its header documents the API): a family lists variants per appearance, `<html data-theme-variant>` carries the choice (absent when the family has none), Settings shows a chip row labelled "Flavour" or "Contrast", the command palette gets a "Theme: <Family> <Variant>" command per variant, and preferences keep one variant per family and appearance. The old `catppuccin-macchiato` family migrates to `catppuccin` + `macchiato` through `LEGACY_THEME_FAMILIES`.

### Families, sources and mapping

| Family | Variants | Source |
|---|---|---|
| Catppuccin | Latte (light), Frappé / Macchiato / Mocha (dark, default Mocha). Row label "Flavour" | [catppuccin/palette](https://github.com/catppuccin/palette) `palette.json` v1.8.0 |
| Gruvbox | Dark and Light, each Hard / Medium (default) / Soft. Row label "Contrast" | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) `colors/gruvbox.vim` at `ef8864b` |
| Everforest | Dark and Light, each Hard / Medium (default) / Soft. Row label "Contrast" | [sainnhe/everforest](https://github.com/sainnhe/everforest) `autoload/everforest.vim` at `85a86eb` (v0.3.0) |
| Apple, Nord, Solarized | none | unchanged |

All hex values are copied from those files; the CSS headers in `client/src/styles/themes/` name the source and the mapping.

* **Catppuccin.** Follows the style guide: `base` is content, `mantle` / `crust` are the sidebar, toolbars and workspace, `surface0-2` are fills and separators. Syntax: keyword mauve, string green, number peach, function blue, type yellow, property teal, comment overlay2. Accent is mauve.
* **Gruvbox.** Dark uses the bright accents on `dark0*`, light uses the faded accents on `light0*`, as `gruvbox.vim` does. Hard / medium / soft change only the base background. Accent is orange.
* **Everforest.** Contrast changes the background ramp (`bg_dim`, `bg0-5` and the tinted backgrounds); the foreground palette is shared per appearance. The exact light green (`#8da101`) is about 2.7:1 on `bg0`, so the light "Theme default" accent is blended 65/35 toward the foreground; `--system-green` stays exact. Accent is green.
* **Pre-paint.** The `var THEMES = ...` map in `client/index.html` is generated from `themeIndex()`; `themes.test.ts` fails until it matches, and it also covers variant parsing, the legacy migration and prefs sanitising.

### Screenshots

| Family | Folder | Contents |
|---|---|---|
| Catppuccin | [`theme-catppuccin/`](../screenshots/theme-catppuccin) | picker (Auto rows, Flavour row, phone), app in Frappé, Macchiato, Mocha and Latte |
| Gruvbox | [`theme-gruvbox/`](../screenshots/theme-gruvbox) | picker (Auto rows, Contrast row, phone), app in dark and light × hard / medium / soft |
| Everforest | [`theme-everforest/`](../screenshots/theme-everforest) | picker (Auto rows, Contrast row, phone), app in dark and light × hard / medium / soft |

Previews: ![](../screenshots/theme-catppuccin/54-catppuccin-app-mocha.png) ![](../screenshots/theme-gruvbox/62-app-dark-hard.png) ![](../screenshots/theme-everforest/70-06-app-light-hard.png)

The canonical `after/` set was regenerated from the full suite and also contains the Gruvbox and Everforest shots, so its numbering differs from Round 2's.

### Tests

| Suite | Count |
|---|---|
| Client unit (Vitest) | 106 |
| Server (`node:test`) | 20 |
| End-to-end (Playwright) | 39 |

New E2E specs: `theme-gruvbox.spec.ts`, `theme-everforest.spec.ts` (Catppuccin variants are covered in `velocity.spec.ts`'s theme test) and `palette-warmup.spec.ts`.

### Palette search flake

On a cold start `velocity.spec.ts` › "command palette: full-text search" failed once on `toContainText('Kyoto')`. Cause: after load, `warmSearchIndex` fetches note bodies in the background, but the palette computed its results only when the query changed. A query typed before the Kyoto note was indexed showed only "Create note", and stayed stale after the index filled. The theme specs were not involved (they delete their notes and the palette test runs in a fresh browser context). `CommandPalette` now also depends on the `pastes` list, which `warmSearchIndex` refreshes when it finishes, and `palette-warmup.spec.ts` delays one note's fetch to cover the case deterministically.

## Performance

Input-to-next-frame latency was measured while typing 120 characters, using headless Chromium on the same machine and the same API server. "Before" is `main`.

| Note | Build | Median | p95 | Long tasks (>50 ms) |
|---|---|---|---|---|
| Large (4,000 lines, ~220 KB) | before | 77 ms | 94 ms | **120 / 120 keystrokes** |
| Large (4,000 lines, ~220 KB) | after | **36 ms** | **48 ms** | **2** |
| Small (grocery list) | before | 17 ms | 21 ms | 0 |
| Small (grocery list) | after | 17 ms | 21 ms | 0 |

What changed:

* **Live-preview image field.** It used to force a full parse (with a 5 s budget) and regex-scan every line on *every keystroke*. It now rebuilds only when an edit or the cursor touches a line with image syntax. Otherwise it maps positions.
* **Editor and React.** CodeMirror owns its document. Keystrokes flow out to the store, and only external changes flow back in through a subscription, so typing never re-renders the editor's React tree.
* **Shell subscriptions.** The old `App` subscribed to the whole store, so the sidebar, tabs and toolbar all re-rendered on every keystroke. Each component now selects only what it shows. The notes list follows a throttled (300 ms), deferred view of the data and caches title and preview text per note object.
* **Search indexing.** FlexSearch re-tokenising moved off the keystroke path (250 ms idle debounce). Startup no longer re-indexes cached documents.
* **Bundle.** Tailwind was removed. CodeMirror has its own cacheable chunk, and Excalidraw stays lazy-loaded. Read mode (marked + DOMPurify) and the Settings and Shortcuts sheets are lazy-loaded and prefetched when the browser is idle. Initial JS is 296 KB gzip, against 286 KB on `main`, with all the new features included. The command palette stays in the startup bundle on purpose, so that keys typed straight after ⌘P are never dropped.

## Workers

### Auto-save (client): `client/src/lib/syncEngine.ts`

| Behaviour | Before | After |
|---|---|---|
| Close a tab within 800 ms of typing | **edit lost** (timer cancelled) | flushed immediately |
| Reload or close the browser mid-debounce | edit lost | `pagehide` keepalive flush, plus a flush when the page is hidden |
| Continuous typing | never saved until a pause | max-wait checkpoint every 5 s |
| Edit during an in-flight save | dirty flag cleared too early | revisions: only the latest revision clears "dirty" |
| Concurrent saves of one note | possible | one in flight, the rest coalesced into one follow-up |
| Payload | full title + content + group on every save | changed fields only |
| After 3 failures | silently gave up | "Offline" status, then retried on `online`, focus, or ⌘S |

### File sync (server): `server/workers/markdownSync.ts`

| Behaviour | Before | After |
|---|---|---|
| Trigger | poll every 5 s | write-triggered (750 ms debounce), plus a 60 s safety poll |
| Work per pass | read **all** content and **all** files | metadata scan; content loaded only for changed notes; compared by hash |
| Rename | stale `id - Old.md` left behind | old file removed |
| Delete | file left forever | file and exported assets removed. Orphans are cleaned on start |
| Images | `/api/assets/:id` links (broken offline) | copied next to the Markdown with relative links |
| Writes | direct | atomic (temp file + rename) |

The API also stopped echoing the note body in `PUT` responses, and note routes are gzip-compressed.

## Tests

| Suite | Command | Count |
|---|---|---|
| Client unit (Vitest) | `cd client && npm test` | 106 |
| Server API + worker (`node:test`) | `cd server && npm test` | 20 |
| End-to-end (Playwright, headless Chromium) | `cd client && npm run test:e2e` | 39 |

The E2E suite runs against a throwaway database. It covers:

* onboarding, autosave, flush-on-close, rename and folders
* the palette and every tiling operation
* layout restore, drag-to-tile, the whiteboard tile and read mode
* formatting keys, the delete alert, offline recovery, settings and the phone layout
* a large-note typing budget
* theme switching (including Gruvbox and Everforest contrast variants), the palette's search warm-up, folder moves, board sync between two devices, empty-note pruning and sliding mode

## Follow-ups worth considering

* Pinned notes and a "Recently Deleted" folder. Both need a small schema change.
* Verify multi-cursor by hand (CodeMirror native). It is still unchecked in the CLAUDE.md checklist.
* User-rebindable shortcuts. The command registry already makes this a small change.
