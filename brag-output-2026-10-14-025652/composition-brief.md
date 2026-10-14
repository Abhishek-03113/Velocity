# Hyperframes Composition Brief: Velocity (v3)

v3 adds a "Make it yours." multi-colour product-lineup reveal of the themes (see the v3 section in
`brag-plan.md`): seven real app windows in different themes glide in from different directions
on half-beat staggers, settle into an overlapping lineup under studio light with floor
reflections and accent light spill, ease out, and hand off to the live theme footage via a
match cut on the Gruvbox window. Output for v3: `brag-output-2026-10-14-025652/brag.mp4`,
65.95 s. Timeline remap `T()` gains a +5-bar segment for v1 times ≥ 35.95 s; the outro logo now
lands at 60.30 s on the track's strong cue at 61.1 s.

---


## Objective
Re-voice the Velocity launch film. v1's footage, design and motion stay. Every line on screen is
rewritten in the builder's own voice, keynote-style: the problem, the answer, then the product
with one plain caption per feature, and "One more thing." for the Blog Reader plugin.

## Output
- Composition directory: `brag-output-2026-10-14-023641/composition/`
- Rendered video: `brag-output-2026-10-14-023641/brag.mp4`
- Format: landscape, 1920x1080, 30 fps
- Duration: 59.4 s (user asked for at least 30 s covering every major feature and the plugin)

## Source Material
- v1: `brag-output-2026-10-13-162704/` (footage, composition template, build script)
- Real app footage recorded with Playwright (`capture/capture.ts`) against the live API and Vite
  dev server, reused unchanged from v1
- Facts the copy relies on: search budget < 10 ms (CLAUDE.md), six theme families each in light
  and dark (`client/src/lib/themes.ts`), self-hosted, offline-tolerant sync (`lib/syncEngine.ts`),
  Markdown mirror to disk (export worker), Blog Reader plugin (`client/src/plugins/blogReader/`),
  repo `github.com/Abhishek-03113/Velocity` (landing CTA)
- Copy that must appear verbatim: see the script table in `brag-plan.md`

## Creative Direction
- Tone preset: polished
- Creative direction: a product keynote, presented by the person who built it
- Hook: "Most notes apps / make you wait." typed live, then "So we built one / that doesn't."
- Outro: Velocity · "Notes, without the wait." · Get Velocity · repo URL
- Avoid: taglines that sell, superlatives, "keyboard warriors", numbered section labels, any claim
  the code does not back (no "open source": the repo has no LICENSE)

## Visual Identity
Unchanged from v1 (Gruvbox Dark Hard `#1d2021`, `#fbf1c7`, accent `#fe8019`; Instrument Serif /
Instrument Sans / Geist Mono).

## Timeline
`build-composition.py` + `composition.template.html` generate `composition/index.html`. v1's
choreography is authored in v1 time and mapped onto v2 with `T()` (same function in Python and in
the template): +1 bar (2.183 s) after the opening, +2 bars after the plugin intro. New v2 beats
(answer line, "One more thing.", plugin title) are authored in v2 time on `master`.

## Audio
- Music: vol-12 from track 0.817 s (v1: 3.0 s), volume lane with a dip to 0.17 under
  "One more thing." and a lift on the Blog Reader title
- Beat locks (v2 time): 7.925 (window on the drop), 31.936 (Blog Reader on track 32.74 s, the
  strongest cue), 53.75 (outro logo)
- Audio-reactive glow re-extracted for the new offset (`assets/audio-env.js`)
- SFX as v1, remapped with `T()`, plus a soft drop under the answer line, a card slide out of
  the whiteboard scene, and the plug click + bell on Blog Reader

## Hyperframes Instructions
Rebuild with `python3 build-composition.py`, gate with `npx hyperframes check`, render with
`npx hyperframes render --quality delivery --output ../brag.mp4`.
