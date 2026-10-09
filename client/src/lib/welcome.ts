import { comboLabel } from './platform'

/** First-run note — teaches the essentials by example. */
export function welcomeNote(): string {
  const k = comboLabel
  return `# Welcome to Velocity

Velocity is a fast, private place for your notes. Everything saves automatically as you type.

## The basics
- [ ] Create a note with **${k('Ctrl+Alt+KeyN')}** or the compose button
- [ ] Find anything with **${k('Mod+KeyP')}**. Search covers titles and full text
- [ ] Run any action from the command palette: **${k('Mod+Shift+KeyP')}**
- [ ] Switch between editing and reading with **${k('Mod+KeyE')}**

## Work side by side
Velocity tiles notes the way a tiling window manager does:

- **${k('Mod+Backslash')}** splits the current tile. The new tile opens on the longer side
- **${k('Ctrl+Alt+ArrowRight')}** and the other arrows move focus between tiles
- **${k('Ctrl+Alt+Shift+ArrowRight')}** swaps notes between tiles
- **${k('Ctrl+Alt+Enter')}** zooms the focused tile. **${k('Ctrl+Alt+KeyQ')}** closes it
- Drag a note from the sidebar onto the edge of a tile to split there

## Sketch ideas
Press **${k('Mod+Shift+KeyD')}** to open a whiteboard next to any note.

> Tip: press **${k('Mod+Slash')}** at any time to see every keyboard shortcut.
`
}
