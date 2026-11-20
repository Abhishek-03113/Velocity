# Motion

Velocity's interface motion follows a short list of principles. One module, `client/src/lib/motion.ts`, holds the
durations, easings and helpers, so components never hard-code timings.

## Rules

- **Frequency of use sets the tier.** The more often something happens, the less it moves.

  | Tier | Duration | Used for |
  |---|---|---|
  | hot | 0–90 ms, opacity only | typing, tab switch, palette results and arrow keys, focus |
  | warm | 120–180 ms | menus, palette open, tab open / close |
  | cool | 200–280 ms | sheets, alerts, tile swaps and drops, deletes |
  | rare | up to 300 ms + one flourish | ⌘S save, back online |

- **300 ms ceiling.** `clampDuration` caps every animation; the unit tests fail above it.
- **Transform and opacity only**, after state has committed, so input never waits (sub-50 ms latency holds).
  Tile geometry stays a FLIP pass; `e2e/z-tiling-budget.spec.ts` guards the layout budget.
- **Reduced motion wins.** `reducedMotion()` is true when the OS asks for it or Settings → Appearance →
  "Reduce interface motion" is on (`<html data-reduce-motion>`). Every helper then jumps to the end state.
- **No toasts.** Save feedback stays in the status bar and the dirty dots.

## Easings (`EASE`, mirrored by `--ease-*` tokens)

| Name | Curve | For |
|---|---|---|
| `out` | `.22, 1, .36, 1` | fades, menus |
| `spring` | `.32, .72, 0, 1` | things arriving (sheets, tiles) |
| `inOut` | `.65, 0, .35, 1` | travel and exits (slow in, slow out) |
| `overshoot` | `.34, 1.56, .64, 1` | spring-backs after a stretch only |

## Helpers

| Helper | What it does |
|---|---|
| `animate(el, keyframes, opts)` | WAAPI with a clamped duration; `null` under reduced motion |
| `reversible(el, keyframes)` | an entrance whose `reverse(done)` plays it backwards from the current frame |
| `rubberBand(over, dim)`, `rubberBandClamp` | distance drawn past a limit: `dim · (1 − 1 / (0.55 · over / dim + 1))` |
| `tween(from, to, onFrame)` | rAF tween for values WAAPI cannot animate (a CSS variable), with `easeOutBack` |
| `flipFrom`, `flipList` | FLIP maths and sibling FLIP with stagger and overshoot |
| `trackPointerOrigins()`, `recentPointer()` | where the last pointer press was (keyboard use clears it) |
| `installPressFeedback()` | `[data-press]` elements sink on pointerdown and spring back; sliding off cancels |
| `staggerDelay(i)` | 14 ms apart, first 6 items only |

## Where each principle lives

| Principle | Surface |
|---|---|
| Origin awareness | `ContextMenu` (scales from the click), `useOverlayMotion` (sheets and alerts from the pressed button), new tab from `+` |
| Staggering | menu items, notes list rows after a delete |
| Interruptible motion | menus and sheets reverse mid-open; presses cancel on slide-off |
| Rubber banding | `SidebarResizer`, sliding strip pan and wheel (`Workspace`) |
| Fitts's law | tab close answers to 28 px, new tab button 28 px |
| Doherty threshold | press feedback on pointerdown (same frame) |
| Anticipation, arcs, squash, follow-through | tile swaps (`moveTile` in `Workspace`), note delete |
| Solid drawing | a tile held by its header lifts (`[data-lifted]`) |
| Peak-end, exaggeration, secondary action | status bar: check pop on save, pulsing "All changes saved" on ⌘S and after offline recovery; `DirtyDot` pops in and squashes out; read badge pop |
| Hick's law, Von Restorff | palette `>` shows Recent (`lib/recentCommands.ts`) and Suggested first; only the Enter target has the accent and ↵ |

Tests: `src/lib/motion.test.ts`, `src/lib/recentCommands.test.ts`, `e2e/zz-motion.spec.ts`.
