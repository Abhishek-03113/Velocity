# Excalidraw Integration Migration

## Discovery

- [x] Inspect latest Genesis commit (`ee70b0b` / `43d1422` Changes)
- [x] Identify Genesis Excalidraw changes
- [x] Compare Genesis and existing integration
- [x] Identify functionality that must be preserved
- [x] Re-verified after `git pull` — Genesis HEAD is now `798504e` (Lovable update)

## Latest Genesis pull check (`798504e`)

Pulled `origin/main` in `@worktrees/genesis-repo-tool/` (was behind by 2 commits).

- New commits: `77d205e` Work in progress → `798504e` Lovable update (“the page does not load”)
- Diff vs previous Excalidraw baseline (`ee70b0b`): **only** `src/routeTree.gen.ts` (TanStack router regen)
- **No changes** to Whiteboard, whiteboardStore, App whiteboard UX, velocity Excalidraw CSS, or ShortcutsModal
- Migration already matches the current Genesis Excalidraw implementation; no further code port required from this pull

## Migration Map

### Genesis → Integration

| Genesis file | Action | Notes |
|---|---|---|
| `components/Whiteboard.tsx` | **Adapted** | Port to CSS Modules; keep lazy load, debounce, theme, UIOptions |
| `store/whiteboardStore.ts` | **Adapted** | UI state + localStorage scene API; wire `removeBoard` into paste delete |
| `App.tsx` whiteboard chrome | **Merged** | Toggle, split panel, Cmd⇧D, board header, stay-put; keep existing shell |
| `velocity.css` Excalidraw rules | **Adapted** | Into `App.module.css` / whiteboard CSS |
| `ShortcutsModal.tsx` shortcut | **Merged** | Add Toggle whiteboard; keep CSS Modules modal |
| New Note button | **Adapted** | Add sidebar CTA, toned-down accent (not Genesis bright mauve fill) |

### Existing → Keep / Update

| Existing file | Action | Notes |
|---|---|---|
| `lib/drawing.ts` | **Kept** | Legacy drawing-paste parse/create |
| `DrawingCanvas.tsx` | **Kept** | Legacy drawing pastes still render via serializeAsJSON/restore |
| `editorStore.addPaste(title, content, onPersisted)` | **Kept** | Required for legacy drawing paste creation path if retained |
| Drawing-as-paste auto-split | **Merged** | Preserve opening legacy drawing pastes in right pane |
| Server paste CRUD / debounce | **Kept** | Unrelated; do not break |
| Plain/Markdown/Read modes | **Kept** | Existing shell affordance |

### Architecture decision

- **New primary UX (Genesis):** whiteboard is a companion panel for the active note (toggle, resizable split, board stays across tab switches).
- **Persistence for new boards:** localStorage via `whiteboardStore` (Genesis model) — no backend schema change.
- **Preserve:** existing drawing pastes (`type: 'excalidraw'`) continue to open in the split pane via `DrawingCanvas` + server-backed `setContent`.
- **Shell:** keep CSS Modules / existing layout; do not pull Tailwind from Genesis.

## Migration

- [x] Migrate Excalidraw UI (Whiteboard component + styles)
- [x] Migrate Excalidraw initialization/configuration
- [x] Migrate toolbar/actions (board toggle, header, split resize)
- [x] Migrate state/event handling (whiteboardStore + Cmd⇧D)
- [x] Migrate persistence/API wiring (localStorage scenes + legacy paste drawings)
- [x] Preserve existing integration-specific functionality
- [x] Tone down New Note button
- [x] Update ShortcutsModal

## Review

- [x] Review migrated files
- [x] Check for accidentally removed existing functionality
- [x] Check imports/dependencies
- [x] Review Git diff
- [x] Commit migration changes

## Done notes

- Genesis companion whiteboard UX migrated (toggle, Cmd⇧D, stay-put board, split resize, header, switch-to-current).
- Existing drawing pastes (`type: excalidraw`) still open via `DrawingCanvas` + server `setContent`.
- `drawing.ts` helpers kept; primary create path is board toggle (removed ✎ new-drawing button).
- New Note sidebar CTA uses muted accent tint (not solid bright fill).
- detect_changes risk: low.
- Commits split per change: docs → store → Whiteboard UI → shortcut → App wiring → board styles → New Note → tone-down → todos finalize.
