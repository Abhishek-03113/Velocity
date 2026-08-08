# Frontend Migration

Source: `worktrees/genesis-repo-tool/src/velocity/`  
Target: `client/src/`

## Migration Map

| Source (velocity/) | Target (client/src/) | Strategy |
|---|---|---|
| `velocity.css` | `velocity.css` | Direct copy |
| `../styles.css` (Velocity theme slice) | `styles.css` | Adapted — Tailwind v4 + `v-*` tokens only |
| `App.tsx` | `App.tsx` | Direct copy (Tailwind layout) |
| `components/Editor.tsx` | `components/Editor.tsx` | Direct copy |
| `components/Editor.module.css` | `components/Editor.module.css` | Direct copy |
| `components/markdownRich.ts` | `components/markdownRich.ts` | Direct copy (new) |
| `components/MarkdownPreview.tsx` | `components/MarkdownPreview.tsx` | Direct copy |
| `components/MarkdownPreview.module.css` | `components/MarkdownPreview.module.css` | Direct copy |
| `components/PasteList.tsx` | `components/PasteList.tsx` | Direct copy |
| `components/SearchModal.tsx` | `components/SearchModal.tsx` | Direct copy |
| `components/ShortcutsModal.tsx` | `components/ShortcutsModal.tsx` | Direct copy |
| `store/editorStore.ts` | `store/editorStore.ts` | Copy — adds `addPaste(groupId?)` |
| `lib/api.ts` | `lib/api.ts` | **Keep current** — real backend, no mock |
| `store/groupStore.ts` | — | Unchanged |
| `store/searchStore.ts` | — | Unchanged |
| `types/index.ts` | — | Unchanged |
| `VelocityApp.tsx` | `main.tsx` | Adapt — wrap App with `data-velocity-root` |
| — | `App.module.css`, `App.css`, `index.css`, unused `*.module.css` | Remove after migration |
| `package.json` deps | `client/package.json` | Add Tailwind + CodeMirror extras |
| — | `vite.config.ts`, `index.html` | Add Tailwind plugin + Google fonts |

## Modules

- [x] Styling infrastructure (Tailwind, styles.css, velocity.css, vite, index.html, main.tsx)
- [x] State management (editorStore — group-aware addPaste)
- [x] Editor (Editor.tsx, markdownRich.ts, Editor.module.css)
- [x] Sidebar & modals (PasteList, SearchModal, ShortcutsModal, MarkdownPreview)
- [x] Layout & shell (App.tsx)
- [x] Cleanup (remove obsolete CSS modules, verify build)

## Notes

- New UI uses Tailwind utility classes (`v-*` design tokens) instead of CSS Modules for layout/shell.
- New layout: top command bar, left sidebar, tab bar above editor, status footer.
- Read mode toggled via `Cmd/Ctrl+E`; editor defaults to markdown mode with live preview.
- PasteList adds drag-and-drop group assignment and per-group "new note" actions.
- Keep existing `api.ts` with `http://localhost:3000` default — do not migrate `mockApi.ts`.
