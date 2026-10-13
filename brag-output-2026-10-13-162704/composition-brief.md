# Hyperframes Composition Brief: Velocity

## Objective
Create a premium product launch film for Velocity, the self-hosted, keyboard-first notes app, using real app footage and covering every major feature plus the Blog Reader plugin.

## Output
- Composition directory: `brag-output-2026-10-13-162704/composition/`
- Rendered video: `brag-output-2026-10-13-162704/brag.mp4`
- Format: landscape, 1920x1080, 30 fps
- Duration: 55 s (the user asked for at least 30 s and every major feature, so this goes past the default 15–25 s)

## Source Material
- Project root: `/home/user/Velocity`
- Primary files read: `README.md`, `CLAUDE.md`, `landing/index.html` (copy), `client/src/styles/themes/gruvbox.css`, `client/src/lib/themes.ts`, `client/src/plugins/blogReader/index.ts`, `docs/plugins.md`, `client/e2e/capture/kit.ts`
- Product name: Velocity
- Tagline / strongest claim: "Think at the speed of your keys." (landing hero)
- Key UI to show: the real app, recorded with Playwright (`capture/capture.ts`) against a live API and Vite dev server, at 1280x800 CSS and 2x DPR, in Gruvbox Dark Hard. The clips are editor, palette, tiling, sliding, whiteboard, blog, themes and folders. The stills are the shortcuts sheet and the phone layout (`landing/media/shot-phone.webp`).
- Copy that must appear verbatim:
  - Think at the speed of your keys.
  - A real editor, not a text box.
  - Search that answers before you finish typing.
  - A workspace that tiles itself.
  - An endless strip of columns.
  - Every note can think in pictures.
  - Open a blog post as a note, filed in your Blogs folder. (plugin manifest)
  - Make it yours. Six ways.
  - Order that keeps itself. / Forget a key? Press ⌘ /
  - Never lose a keystroke. / If the network drops, you will not notice.
  - Get Velocity.

## Creative Direction
- Tone preset: polished, with cinematic scale at the drop and the outro
- Creative direction: a premium keynote-style launch film for a keyboard-first notes app
- Interpretation: one line per feature, big serif statements, long enough holds; motion is physical (the window swings, keycaps press) and cut on the bar.
- Angle: every feature is one keystroke away, so the film is cut on keystrokes. 3D keycaps press in sync with the key events logged during capture, and the app window swings left and right like a focused tile. The "and the rest" beat tiles the frame itself, dwindle-style.
- Hook: the landing headline types itself character by character with real keypress sounds.
- Outro / punchline: icon + wordmark, "Think at the speed of your keys.", Get Velocity.
- Avoid: generic SaaS language, abstract filler, restyling the app.

## Visual Identity
- Background: `#1d2021` (Gruvbox bg0_h); surfaces `#282828` / `#32302f`
- Text: `#fbf1c7` primary, `#d5c4a1` secondary, `#a89984` muted
- Accent: `#fe8019` (orange), `#fabd2f` (yellow, logo nib); plugin badges `#83a598` (Unread) and `#b8bb26` (Read)
- Display font: Instrument Serif (local @font-face)
- Body font: Instrument Sans; mono/keycaps: Geist Mono, with JetBrains Mono supplying ⌘ ⌃ ⌥
- Visual references: the fountain-pen app icon, Velocity's orange focused-tile ring, the tile header bar, and the footer save state (Edited → Saving… → Saved)

## Storyboard
See `brag-plan.md`. Built timeline (seconds):
1. Typed hook: 0–3.6
2. Reveal: 3.56–5.74
3. Editor: 5.74–10.11 (window rises on the drop)
4. Quick open: 10.11–14.47
5. Tiling: 14.47–18.84
6. Sliding: 18.84–23.20
7. Whiteboards: 23.20–27.56
8. Blog Reader plugin: 27.56–36.29 (intro card, then footage from 29.74)
9. Themes: 36.29–40.65 (the six switches land on consecutive beats)
10. And the rest, tiled: 40.65–45.02
11. Never lose a keystroke: 45.02–49.38
12. Outro: 49.38–55.0

## Audio
- Audio role: cinematic support plus a tactile key-foley layer
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` from 3.0 s, with a volume lane (fade in, bed at about 0.36, fade out from 51.6 s)
- Music cue guidance: `assets/music/cues/vol12.music-cues.json` (60 s window via `analyze_music_cues.py`); beat-locked at 5.742, 29.74 and 49.384
- Audio-reactive treatment: subtle; smoothed low-band energy (`assets/audio-env.js`, from `extract-audio-data.py`) drives the glow behind the window and the window's rim light
- SFX: a keypress per typed hook character, sparse key ticks under on-screen typing, a key thud plus click on every keycap press, a card slide on window swings, a plug switch and bell for Blog Reader, a switch on Unread → Read, drops on tile splits, a bong on Saved, and a bell on the outro. Lanes are allocated greedily so overlapping clips never share a track.

## Hyperframes Instructions
`build-composition.py` generates `composition/index.html` from `composition.template.html`, so the timeline and the audio clips share one set of timings (bars, footage key events, hook schedule). Edit the template or the script, then rebuild.
