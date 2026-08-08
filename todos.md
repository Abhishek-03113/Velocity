# Excalidraw Integration Migration

## Discovery

- [x] Inspect latest Genesis commit (`ee70b0b` / `43d1422` Changes)
- [x] Identify Genesis Excalidraw changes
- [x] Compare Genesis and existing integration
- [x] Identify functionality that must be preserved

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

- [ ] Migrate Excalidraw UI (Whiteboard component + styles)
- [ ] Migrate Excalidraw initialization/configuration
- [ ] Migrate toolbar/actions (board toggle, header, split resize)
- [ ] Migrate state/event handling (whiteboardStore + Cmd⇧D)
- [ ] Migrate persistence/API wiring (localStorage scenes + legacy paste drawings)
- [ ] Preserve existing integration-specific functionality
- [ ] Tone down New Note button
- [ ] Update ShortcutsModal

## Review

- [ ] Review migrated files
- [ ] Check for accidentally removed existing functionality
- [ ] Check imports/dependencies
- [ ] Review Git diff
- [ ] Commit migration changes
