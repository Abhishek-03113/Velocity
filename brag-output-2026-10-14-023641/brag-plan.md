# Brag Plan: Velocity (v2)

v2 keeps v1's footage, design and choreography. Only the voice changes. v1's lines came from the
landing page ("Think at the speed of your keys.", "Built for keyboard warriors.") and read like
selling. v2 is written the way the person who built it would say it on a stage. Short sentences,
plain words, the problem first, then the product doing the talking. No adjectives that the footage
can't prove.

## What is this app?
A self-hosted notes app that never waits on the network or the mouse. You write in Markdown, split
notes side by side with one keystroke, sketch on whiteboards, and find any note in under 10 ms. It
now has plugins, starting with Blog Reader.

## The angle
A keynote, not an ad. Start with what is wrong with notes apps, in one sentence. Answer it in one
sentence. Then say almost nothing and let the real app work on screen, one plain caption per
feature. Save the plugin for "One more thing."

## Voice rules
- One idea per line. Five words or fewer where possible.
- Say what it does, not how it feels: "Side by side. One keystroke." not "A workspace that tiles itself."
- Numbers over adjectives: "in under 10 ms", "Six themes."
- Parallel pairs: "Write plain text. / Read it typeset." · "Your notes. / Your machine."
- Owner's voice: "we", "our first plugin". No "keyboard warriors", no exclamation, no superlatives.
- Bookend: open on "Most notes apps make you wait.", close on "Notes, without the wait."
- Only claims the code backs up: < 10 ms search (CLAUDE.md search budget), six theme families in
  light and dark (`lib/themes.ts`), self-hosted, offline-tolerant sync, notes mirrored to `.md` files.
  No "open source" (the repo has no LICENSE).

## Script (on-screen text, v1 → v2)

| Beat | v1 | v2 |
|---|---|---|
| Hook (typed) | Think at the speed / of your *keys.* | Most notes apps / make you *wait.* |
| Answer | n/a | So we built one / that *doesn't.* |
| Reveal | Velocity · KEYBOARD-FIRST NOTES. | Velocity |
| Editor | 01 — Editor · A *real* editor, / not a text box. | Writing · Write plain text. / Read it *typeset.* |
| Search | 02 — Quick open · Search that / answers *before* / you finish typing. | Search · Find any note / in under *10 ms.* |
| Tiling | 03 — Tiling · A workspace / that *tiles itself.* | Tiling · Side by side. / *One keystroke.* |
| Sliding | 04 — Sliding mode · An *endless* strip / of columns. | Sliding · Need more room? / *Scroll sideways.* |
| Whiteboards | 05 — Whiteboards · Every note can / think in *pictures.* | Whiteboards · Some ideas / need a *drawing.* |
| Plugin setup | NEW · PLUGINS | One more thing. |
| Plugin title | Blog Reader · Open a blog post as a note, filed in your Blogs folder. | Blog Reader · *Our first plugin.* |
| Plugin demo | 06 — Plugins · Blog *Reader* · Paste a link. Read it beside your notes, as Markdown. | Plugins · Blog *Reader* · Paste a link. / Read it next to your notes. |
| Themes | 07 — Themes · Make it yours. / *Six ways.* | Themes · Six themes. / *Light and dark.* |
| The rest | 08 — And the rest · Order that keeps itself. · Forget a key? Press ⌘ / · On your phone, too. | The little things · Folders, from the keyboard. · Forgot a shortcut? ⌘ / · And on your phone. |
| Local-first | 09 — Local-first · Never lose / a *keystroke.* · If the network drops, you will not notice. · local-first / self-hosted / ~/velocity_docs/*.md | Local-first · Your notes. / Your *machine.* · Saved as you type. Even offline. · self-hosted / works offline / plain .md files |
| Outro | Velocity · Think at the speed of your keys. · Get Velocity. · self-hosted · local-first · keyboard-first | Velocity · *Notes, without the wait.* · Get Velocity · github.com/Abhishek-03113/Velocity |

## Hook (first 5.6 seconds)
The problem, typed live with real keypress sounds: "Most notes apps / make you *wait.*" The caret
blinks on "wait." for a beat. It lifts away, and the answer rises in its place: "So we built one /
that *doesn't.*" Then the icon and the word "Velocity", and nothing else.

## Key moments (the middle)
Unchanged from v1: the window lands on the music's drop, already mid-edit; ⌘E reads it; ⌘P finds a
note mid-query; ⌃⌥\ and ⌃⌥− split; ⌃⌥T turns the tiles into a strip; ⌘⇧D opens a whiteboard.

## One more thing
The window leaves. The music drops back. "One more thing." sits alone on the dark stage for over a
second. The plug clicks into its socket and "Blog Reader" lands on the strongest hit in the
track, with "Our first plugin." under it. Then the real thing: ⌃⌥B, a link, the article as a note
beside your own, marked Read.

## Outro
Icon and wordmark, then "Notes, without the wait." (the answer to the opening line), then the button
and the real repo address.

## Tone
- Preset: `polished`
- Creative direction: a product keynote, presented by the person who built it.
- Interpretation: calm and certain. Fewer words than v1, longer silences around them, the same
  physical motion. One deliberate quiet moment ("One more thing.") with the music pulled back.

## Format: landscape, 1920x1080, 30 fps
## Duration: 59.4 s (v1 was 55 s; +1 bar for the problem/answer opening, +1 bar for "One more thing.")

## Visual identity
Unchanged from v1: Gruvbox Dark Hard `#1d2021`, text `#fbf1c7`, accent `#fe8019`, Instrument Serif
headlines, Instrument Sans body, Geist Mono labels and keycaps, the real app in Gruvbox Dark.
Numbered kickers ("01 —") are gone; each scene keeps a plain one-word label.

## Audio direction
- Music: `happy-beats-business-moves-vol-12` (109.96 BPM), now started 0.817 s into the track (v1:
  3.0 s) so the opening gets one more bar and the drop still lands with the window (7.925 s).
- Strong-cue locks (v2 time): 7.925 s window lands on the drop; 31.936 s "Blog Reader" lands on the
  track's strongest cue (track 32.74 s); 53.75 s outro logo.
- The bed dips to ~0.17 under "One more thing." (30.1–31.75 s) and comes back on the Blog Reader title.
- Audio-reactive glow re-extracted for the new music offset (`assets/audio-env.js`).
- SFX as v1, remapped; plus one soft drop under "So we built one…", a card slide as the window
  leaves for "One more thing.", and the plug click + bell on Blog Reader.

## Storyboard (v2 time)

| # | Scene | Time | What's on screen |
|---|---|---|---|
| 1 | Problem | 0.00–3.40 | "Most notes apps / make you *wait.*" typed, caret blinks |
| 2 | Answer | 3.42–5.66 | "So we built one / that *doesn't.*" rises in, holds ~1.6 s |
| 3 | Reveal | 5.63–7.93 | Icon + "Velocity" |
| 4 | Writing | 7.93–12.29 | Window lands on the drop; Markdown, checklist, ⌘E Read mode |
| 5 | Search | 12.29–16.66 | ⌘P "search index", highlighted matches |
| 6 | Tiling | 16.66–21.02 | ⌃⌥\ ⌃⌥− splits, swap, zoom |
| 7 | Sliding | 21.02–25.39 | ⌃⌥T, columns, ⌃⌥C width |
| 8 | Whiteboards | 25.39–29.56 | ⌘⇧D, shapes and an arrow |
| 9 | One more thing | 29.70–31.40 | Text alone; music dips |
| 10 | Blog Reader | 31.30–33.95 | Plug, title on the strong cue, "Our first plugin." |
| 11 | Blog Reader demo | 33.93–40.65 | ⌃⌥B, link, article beside notes, Unread → Read |
| 12 | Themes | 40.65–45.02 | Six families switch on the beat |
| 13 | The little things | 45.02–49.39 | Folders (⌃⌥M), shortcuts sheet, phone |
| 14 | Local-first | 49.39–53.75 | Edited → Saving… → Saved; three chips |
| 15 | Outro | 53.75–59.40 | Velocity · Notes, without the wait. · Get Velocity · repo URL |
