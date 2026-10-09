# Velocity UI/UX Revamp: Plan

Branch: `feature/apple-hig-ui-revamp`

Goal: turn Velocity from a developer side project into a consumer-quality notes app.
The redesign follows Apple's Human Interface Guidelines (HIG) and keeps the
local-first contract: the UI never waits on the network.

Screenshots for review live in [`docs/screenshots/`](../screenshots):
`before/` is the original UI and `after/` is the redesign. The Playwright
end-to-end suite regenerates `after/` on every run.

---

## 1. UX audit: gaps found in the original UI

| # | Area | Gap | Severity |
|---|------|-----|----------|
| 1 | Shortcuts | `Ctrl/⌘+N`, `Ctrl/⌘+W`, `Ctrl/⌘+1` are **reserved by Chrome/Safari** and never reach the page. New note, close tab and sidebar toggle silently did nothing for most users | High |
| 2 | Shortcuts | Shortcuts were defined in three places (window listener, CodeMirror keymap, help modal), so the help sheet could disagree with real behaviour | Medium |
| 3 | Shortcuts | No command palette. Many actions (folders, whiteboard, export) had no keyboard path at all | Medium |
| 4 | Data safety | Closing a tab within 800 ms of typing **cancelled the pending save**, so the edit was lost | High |
| 5 | Data safety | Reloading or closing the browser inside the debounce window lost the last edit (no flush on `pagehide`) | High |
| 6 | Data safety | Delete note / delete folder were one-click hover buttons with no confirmation and no undo | High |
| 7 | Auto-save | Continuous typing reset the debounce forever, so long sessions never saved until you paused | Medium |
| 8 | Auto-save | A save response could clear the dirty flag for edits made *while* the request was in flight | Medium |
| 9 | Auto-save | After 3 failed retries the app gave up silently. Nothing retried on reconnect | Medium |
| 10 | Performance | `App` subscribed to the whole store, so **every keystroke re-rendered the full shell** (sidebar, tabs, toolbar) | High |
| 11 | Performance | Each keystroke re-tokenised the whole note into FlexSearch synchronously | Medium |
| 12 | File sync | The Markdown export worker re-read **every note's full content plus its file on disk every 5 s**, forever | Medium |
| 13 | File sync | Renamed notes left stale `id - Old title.md` files, and deleted notes were never removed from the export | Medium |
| 14 | File sync | Exported Markdown pointed at `/api/assets/:id`, which is unusable offline | Low |
| 15 | Visual | Monospace body text, purple-on-navy palette, dark only, no light mode, no accent choice | High |
| 16 | Visual | "Untitled" everywhere. Titles were never derived from content | Medium |
| 17 | Visual | Sidebar showed bare titles with no dates, previews or sorting | Medium |
| 18 | Layout | Mobile layout broken: the sidebar took 2/3 of the screen and the editor wrapped one word per line | High |
| 19 | Layout | Only one note visible at a time. The whiteboard was a special-case split | Medium |
| 20 | State | Open tabs and layout were lost on reload. The app always reopened the most recent note | Medium |
| 21 | A11y | Missing focus rings, roles (`tablist`, `dialog`), labels. Hover-only controls unreachable by keyboard | Medium |
| 22 | Polish | No loading state (blank screen until the API answered). No 1 MB soft-cap warning (open checklist item) | Low |

---

## 2. Design language (Apple HIG)

* **Typography**: the system font stack (`-apple-system` / SF Pro), with Inter as the cross-platform fallback.
  The macOS type ramp is used: Large Title, Title 1–3, Headline, Body, Callout, Subheadline, Footnote and Caption.
  Note text is proportional. Monospace is only used for code.
* **Color**: semantic tokens modelled on UIKit/AppKit dynamic colors
  (`label`, `secondaryLabel`, `tertiaryLabel`, `systemBackground`,
  `secondarySystemBackground`, `separator`, `fill`…). Full **light and dark**
  palettes follow the system appearance, or a manual override.
* **Accent**: the user picks one of the eight macOS accent colors (Blue, Purple, Pink, Red, Orange, Yellow, Green, Graphite).
* **Materials**: the sidebar uses a translucent vibrancy material (`backdrop-filter`). Sheets and popovers use the thick material.
* **Shape**: continuous-feel corner radii (6 / 8 / 10 / 14). Hairline separators. 44 pt touch targets on touch devices.
* **Iconography**: an SF Symbols-style line icon set (1.6 px strokes, rounded caps).
* **Motion**: short spring-like ease-outs (180–240 ms). Everything honours `prefers-reduced-motion`.
* **Controls**: segmented control (Edit / Read), toolbar buttons, source list, alerts with a destructive role, and sheets.

### Window anatomy

```
┌──────────── Sidebar (vibrancy) ───────────┬────────────── Content ─────────────────────────┐
│ Folders column      │ Notes column        │ Toolbar: ◧  Title / folder   [Edit|Read] ▣ ⊞ ⋯ │
│  Library            │ "All Notes" · 6     │ Tabs (shown when ≥ 2 notes are open)          │
│   All Notes         │ ┌─────────────────┐ │ ┌──────── tile ───────┬──── tile ────┐         │
│   Unfiled           │ │ Title           │ │ │                      │              │         │
│  Folders            │ │ 2m ago  preview │ │ │  editor / reader /   │  whiteboard  │         │
│   ● Work            │ └─────────────────┘ │ │  whiteboard / picker │              │         │
│   ● Personal        │                     │ └──────────────────────┴──────────────┘         │
│ + New Folder        │                     │ Status: Work · 312 words · ✓ Saved           │
└─────────────────────┴─────────────────────┴───────────────────────────────────────────────┘
```

Responsive behaviour:

* **≥ 1180 px**: three columns.
* **< 1180 px**: the folders column collapses into the notes column header.
* **< 760 px**: the sidebar becomes an overlay sheet and the workspace runs in monocle mode, showing only the focused tile.

---

## 3. Tiling workspace (Hyprland "dwindle")

* The workspace is a **binary split tree**. Leaves are *tiles*, and each tile shows one of:
  * a note in edit or read mode
  * a note's whiteboard
  * an empty "picker"
* **Auto-tiling**: opening a note "in a new tile" splits the focused tile along its **longer axis**, the way Hyprland's dwindle layout does.
* Tiles are absolutely positioned from the tree and keyed by tile id. Splitting, closing and swapping therefore **never remount an editor**, so undo history and cursor survive.
  Tile geometry animates.
* Gaps and an accent "active border" appear around tiles when more than one is visible. A single tile is full-bleed.
* Dividers drag to resize. Double-clicking a divider equalises the split.
* Focus moves **directionally** (geometric nearest neighbour). Notes can be swapped between tiles, a tile can be zoomed (monocle), split orientation can be rotated, and the whole layout can be equalised.
* Drag a note from the sidebar or tab bar onto a tile edge to split there. Drop it in the centre to replace the tile's note.
* The whiteboard is just another tile kind. `⌘⇧D` toggles a board tile for the focused note.
* Layout and open tabs persist per browser in `localStorage`.

---

## 4. Keyboard model

Single registry → drives the key handler, command palette, shortcut sheet and tooltips.

| Rule | Why |
|------|-----|
| Browser-reserved combos (⌘N/W/T/1-9, Ctrl+Tab) always get a **working alternative** on `⌃⌥` | Chrome/Safari never deliver them to pages |
| Window/tiling actions live on `⌃⌥` (the "Super" layer, as in Hyprland) | Doesn't collide with text editing or browser chrome |
| `AltGraph` key state is ignored | Typing `@ { [ €` on international layouts must never trigger a shortcut |
| Everything is reachable from the command palette | Discoverability for non-power users |

The full table is in the in-app sheet (`⌘/`) and in the README.

---

## 5. Worker optimisations

### Auto-save worker (client)

* Per-note **revision counter**: only clear "dirty" when the saved revision is still the latest.
* **One request in flight per note**. Edits made during a save are coalesced into exactly one follow-up save.
* Debounce of 800 ms **plus max-wait of 5 s**, so long typing sessions still checkpoint.
* **Partial payloads**: only the changed fields are sent, so a rename never re-uploads a large body.
* **Flush, don't cancel**, when a tab closes. `pagehide` and `visibilitychange` flush with `fetch({ keepalive: true })`. `⌘S` forces a save.
* Exponential back-off (1 s, 2 s, 4 s), then a parked "offline" state that retries automatically on `online` and on window focus.
* The search index update is debounced (250 ms) off the keystroke path.

### File sync worker (server)

* **Event-driven**: writes schedule a debounced sync (750 ms). Polling dropped from every 5 s to every 60 s as a safety net.
* **Incremental**: a metadata-only scan (`id, title, updated_at`) runs first. Content is loaded only for changed notes. An in-memory content hash replaces the read-file-to-compare step.
* Handles **renames** (deletes the stale file) and **deletes** (removes the file and its exported assets).
* Copies `/api/assets/:id` images into the export folder and rewrites links to relative paths, so the export works offline.
* Atomic writes (temp file + rename). The export directory is configurable with `DOCS_DIR`.

---

## 6. Test strategy

* **Vitest unit tests**: layout tree (split, close, dwindle, focus direction, swap, sanitise) and the auto-save engine (coalescing, revisions, max-wait, flush-on-close, retry).
* **Server tests** (`node --test` via tsx): API CRUD envelopes, plus the markdown sync worker (incremental writes, renames, deletes, asset export).
* **Playwright E2E** (headless Chromium): onboarding, create/rename/delete with alert, folders, command palette, every shortcut, tiling (split, focus, swap, zoom, close), whiteboard tile, settings (theme and accent), mobile.
  Each step saves a screenshot to `docs/screenshots/after/`.
