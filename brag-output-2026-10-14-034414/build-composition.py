#!/usr/bin/env python3
"""Builds composition/index.html and the SFX stem for the Velocity launch film (v4).

All timing lives here so the visuals (GSAP timeline) and the audio (<audio> clips) share one
source of truth: the music bar grid, the captured footage's key events (footage/*.events.json),
the typed hook, and the keycap HUD presses.

    python3 build-composition.py

v3 keeps v1's footage and choreography, authored in v1 time, and maps it onto the v3 timeline
with T(): the opening grows by one bar (problem, then answer), a one-bar "One more thing." beat
is inserted before Blog Reader (v2), and three bars are inserted after Blog Reader for the
"Make it yours." theme lineup (v3). Sections new since v1 are authored directly in v3 time.
"""
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
COMP = HERE / "composition"
FOOT = COMP / "assets" / "footage"
DUR = 65.95
SFX_VOL = 1.0  # set after measuring the stem against the bed (see brag-plan.md)

# One bar of the music (4 beats at 109.96 BPM).
BAR = 2.183


def T(t):
    """Map a v1 time onto the v2 timeline (same rule as T() in the template)."""
    if t < 3.3:
        return t
    if t < 27.5:
        return round(t + BAR, 3)
    if 29.5 <= t < 35.95:
        return round(t + 2 * BAR, 3)
    if t >= 35.95:
        return round(t + 5 * BAR, 3)
    raise ValueError(f"v1 time {t} falls in the replaced plugin intro")

# Music: vol-12 started 0.817 s into the track (v1: 3.0 s), so v1 time t plays the same music at T(t)
# until the plugin intro. Bars below are v1 time.
# beat-locked (v3 time): drop 7.925 (window lands), 31.936 (Blog Reader title, strongest cue at
# track 32.74), 43.02 (lineup settles), 60.30 (outro logo, strong cue at track 61.1).
BEAT = 0.5457
BARS = [5.742, 7.925, 10.108, 12.29, 14.473, 16.656, 18.838, 21.021, 23.204, 25.375, 27.558,
        29.74, 31.923, 34.105, 36.288, 38.471, 40.654, 42.836, 45.019, 47.202, 49.384]

# Footage placement: composition start/end, media offset (s) and playback rate.
CLIPS = {
    "editor":     dict(start=5.30,   end=10.108, ms=0.325, rate=1.3),
    "palette":    dict(start=10.108, end=14.473, ms=0.0,   rate=0.87),
    "tiling":     dict(start=14.473, end=18.838, ms=0.0,   rate=1.5),
    "sliding":    dict(start=18.838, end=23.204, ms=0.0,   rate=1.9),
    "whiteboard": dict(start=23.204, end=27.85,  ms=0.1,   rate=1.6),
    "blog":       dict(start=29.74,  end=36.288, ms=0.0,   rate=1.1),
    "themes":     dict(start=36.288, end=40.70,  ms=0.011, rate=1.0),
    "folders":    dict(start=40.654, end=45.10,  ms=0.0,   rate=0.85),
}

events = {k: json.loads((FOOT / f"{k}.events.json").read_text())["events"] for k in CLIPS}


def at(clip, label=None, keys=None, nth=0):
    """Composition time of the nth matching footage event."""
    c = CLIPS[clip]
    hits = [e for e in events[clip] if (label is None or e.get("label") == label) and (keys is None or "".join(e["keys"]) == keys)]
    e = hits[nth]
    return round(c["start"] + (e["t"] - c["ms"]) / c["rate"], 3)


# Window poses: translate (x, y) from the centred base, scale, rotationY.
W0, H0 = 1280, 834
POSES = {
    "hero":  dict(x=0,    y=30, s=1.12, ry=0),
    "right": dict(x=335,  y=18, s=0.84, ry=-6),
    "left":  dict(x=-335, y=18, s=0.84, ry=6),
    "wide":  dict(x=278,  y=12, s=0.94, ry=-4),
}


def hud_anchor(pose):
    p = POSES[pose]
    return 960 + p["x"], 540 + p["y"] + H0 * p["s"] / 2 + 4


T1_ANCHOR = (80 + 960 / 2, 958)

# Keycap HUD clusters: keys, press times, anchor.
HUD = []


def hud(keys, presses, anchor):
    HUD.append(dict(keys=keys, presses=presses, x=round(anchor[0]), y=round(anchor[1])))


hud(["⌘", "E"], [at("editor", keys="⌘E")], hud_anchor("right"))
hud(["⌘", "P"], [at("palette", keys="⌘P")], hud_anchor("left"))
hud(["↩"], [at("palette", label="enter")], hud_anchor("left"))
hud(["⌃", "⌥", "\\"], [at("tiling", keys="⌃⌥\\")], hud_anchor("right"))
hud(["⌃", "⌥", "−"], [at("tiling", keys="⌃⌥−")], hud_anchor("right"))
hud(["⌃", "⌥", "⇧", "←"], [at("tiling", keys="⌃⌥⇧←")], hud_anchor("right"))
hud(["⌃", "⌥", "↩"], [at("tiling", keys="⌃⌥↩")], hud_anchor("right"))
hud(["⌃", "⌥", "T"], [at("sliding", keys="⌃⌥T")], hud_anchor("left"))
hud(["⌃", "⌥", "\\"], [at("sliding", keys="⌃⌥\\", nth=n) for n in range(3)], hud_anchor("left"))
hud(["⌃", "⌥", "←"], [at("sliding", keys="⌃⌥←", nth=n) for n in range(2)], hud_anchor("left"))
hud(["⌘", "⇧", "D"], [at("whiteboard", keys="⌘⇧D")], hud_anchor("right"))
hud(["⌃", "⌥", "B"], [at("blog", keys="⌃⌥B")], hud_anchor("wide"))
hud(["↩"], [at("blog", label="enter")], hud_anchor("wide"))
hud(["⌃", "⌥", "M"], [at("folders", keys="⌃⌥M")], T1_ANCHOR)
hud(["↩"], [at("folders", label="enter")], T1_ANCHOR)

# Typed hook (v4): the problem, typed live. A real mouse click lands on "click."
HOOK1, HOOK2 = "You think faster", "than you "
HOOK2_EM = "click."
hook_times = []
t = 0.30
for ch in HOOK1:
    hook_times.append(round(t, 3)); t += 0.052
t += 0.22
for ch in HOOK2 + HOOK2_EM:
    hook_times.append(round(t, 3)); t += 0.056


def ticks(t0, t1, step):
    out, t = [], t0
    while t < t1 - 0.02:
        out.append(round(t, 3)); t += step
    return out


def A(clip, label=None, keys=None, nth=0):
    """v4 time of a footage event."""
    return T(at(clip, label, keys, nth))


# Moments the picture punches on (flash + shake in the template; impact + music dip in the mix).
HITS = [3.45, 5.743, T(5.742), 31.936, 42.71, T(49.384)]

# The bed dips under "One more thing.", comes back on the Blog Reader title, and ducks briefly
# under every big hit so the impacts land.
lane = [(0, 0), (0.5, 0.2), (5.4, 0.25), (7.8, 0.36), (29.4, 0.36), (30.1, 0.17), (31.75, 0.17),
        (31.94, 0.4), (32.8, 0.36), (62.55, 0.36), (65.85, 0)]
base = lambda t: float(np.interp(t, [p[0] for p in lane], [p[1] for p in lane]))

pts = dict(lane)
for h in HITS:
    v = base(h)
    pts[round(h - 0.02, 3)] = v
    pts[round(h + 0.03, 3)] = v * 0.55
    pts[round(h + 0.45, 3)] = v
music_lane = {"version": 1, "lanes": [{"target": "volume", "points": [
    {"t": t, "v": round(v, 3)} for t, v in sorted(pts.items())]}]}

# ───────────────────────────── footage <video> clips ─────────────────────────────
vids = []
for name in ["editor", "palette", "tiling", "sliding", "whiteboard", "blog", "themes"]:
    c = CLIPS[name]
    vids.append(
        f'            <video id="v-{name}" src="assets/footage/{name}.mp4" muted playsinline '
        f'data-start="{T(c["start"])}" data-duration="{round(c["end"] - c["start"], 3)}" '
        f'data-media-start="{c["ms"]}" data-playback-rate="{c["rate"]}" data-track-index="1"></video>')
fc = CLIPS["folders"]
folders_video = (
    f'<video id="v-folders" src="assets/footage/folders.mp4" muted playsinline '
    f'data-start="{T(fc["start"])}" data-duration="{round(fc["end"] - fc["start"], 3)}" '
    f'data-media-start="{fc["ms"]}" data-playback-rate="{fc["rate"]}" data-track-index="2"></video>')

# ───────────────────────────── "Make it yours." lineup (v3) ─────────────────────────────
# Seven real app windows (capture.ts `lineup`), one per look, alternating light and dark, with
# Gruvbox (the house theme) at the centre. k runs -3..3 from left to right.
import math

LU_FY = 760            # floor line (px): every window stands on it
LU_S0 = 0.42           # centre window scale (of the 1280x834 window)
LU_OVERLAP = 0.54      # share of the narrower neighbour hidden behind its inner neighbour
LOOKS = [
    # img, name, mode, accent (spill + ambient glow)
    ("lineup-nord.jpg", "Nord", "Light", "#88c0d0"),
    ("lineup-catppuccin.jpg", "Catppuccin", "Mocha", "#cba6f7"),
    ("lineup-everforest.jpg", "Everforest", "Light", "#a7c080"),
    ("lineup-gruvbox.jpg", "Gruvbox", "Dark", "#fe8019"),
    ("lineup-catppuccin-latte.jpg", "Catppuccin", "Latte", "#8839ef"),
    ("lineup-solarized.jpg", "Solarized", "Dark", "#2aa198"),
    ("lineup-apple.jpg", "Apple", "Light", "#0a84ff"),
]
lineup = []
for i, (img, name, mode, acc) in enumerate(LOOKS):
    k = i - 3
    lineup.append(dict(k=k, img=img, name=name, mode=mode, acc=acc,
                       s=round(LU_S0 * (1 - 0.1 * abs(k)), 4), r=-7 * k))
# x positions: walk outward from the centre, overlapping each neighbour by LU_OVERLAP.
app = lambda c: 1280 * c["s"] * math.cos(math.radians(c["r"]))
by_k = {c["k"]: c for c in lineup}
by_k[0]["x"] = 0
for side in (-1, 1):
    for a in (1, 2, 3):
        inner, outer = by_k[side * (a - 1)], by_k[side * a]
        step = app(inner) / 2 + app(outer) / 2 - LU_OVERLAP * app(outer)
        outer["x"] = round(inner["x"] + side * step, 1)
edge = max(abs(c["x"]) + app(c) / 2 for c in lineup)
assert edge * 1.045 < 900, f"lineup too wide: {edge:.0f}px from centre"

# Names and floor light sit under the visible part of each window (outer ones are mostly covered).
for c in lineup:
    k = c["k"]
    if k == 0:
        c["vx"] = 0.0
        continue
    side, inner = (1 if k > 0 else -1), by_k[k - (1 if k > 0 else -1)]
    outer_edge = c["x"] + side * app(c) / 2
    inner_edge = inner["x"] + side * app(inner) / 2
    c["vx"] = round((outer_edge + inner_edge) / 2, 1)

lu_html = []
for c in lineup:
    k = c["k"]
    lu_html.append(
        f'          <div class="lu-spill" id="lus{k + 3}" style="left:{960 + c["vx"] - 360:.0f}px;--acc:{c["acc"]}"></div>')
for c in sorted(lineup, key=lambda c: -abs(c["k"])):  # outer first, so the centre paints on top
    k = c["k"]
    lu_html.append(
        f'          <div class="lu" id="lu{k + 3}" style="--acc:{c["acc"]}">'
        f'<div class="lu-refl" style="background-image:url(assets/img/{c["img"]})"></div>'
        f'<div class="lu-win"><div class="strip"><div class="lights"><span style="background:#fb4934"></span>'
        f'<span style="background:#fabd2f"></span><span style="background:#b8bb26"></span></div><div class="wt">Velocity</div></div>'
        f'<img class="lu-img" src="assets/img/{c["img"]}" alt="Velocity in {c["name"]} {c["mode"]}" />'
        f'<div class="lu-rim"></div><div class="lu-sheen" data-layout-allow-overflow></div></div></div>')
for c in lineup:
    k = c["k"]
    lu_html.append(
        f'          <div class="lu-lab" id="lul{k + 3}" style="left:{960 + c["vx"] - 120:.0f}px">'
        f'<span class="nm">{c["name"]}</span><span class="md">{c["mode"]}</span></div>')

# ───────────────────────────── sound design (v4) ─────────────────────────────
# One stereo SFX stem, rendered by sound_design.py from this cue sheet. Every cue is tied to a
# footage event (A), a v1 choreography time (T) or a v4 beat, so sound and picture land together.
C = []


def cue(kind, t, db, **kw):
    C.append(dict(kind=kind, t=round(float(t), 3), db=db, **kw))


# 1 · hook: typed keys, a mouse click on "click.", then "So stop clicking." slams in
full_hook = HOOK1 + HOOK2 + HOOK2_EM
for i, (ch, tt) in enumerate(zip(full_hook, hook_times)):
    if ch != " ":
        cue("key", tt, -9 - (i % 3), i=i * 7)
cue("mouse", hook_times[-1] + 0.14, -3)
cue("riser", 3.45, -17, dur=1.0)
cue("impact", 3.45, -5, size=0.7)
cue("whoosh", 3.42, -12, dur=0.4, f0=300, f1=2600, peak=0.8)
# 2 · reveal: riser into the logo, hit + shimmer, wordmark wipe, tagline chime
cue("riser", 5.743, -13, dur=1.5)
cue("impact", 5.743, -4, size=0.9)
cue("shimmer", 5.76, -16, dur=1.5, p0=-0.3, p1=0.3)
cue("whoosh", T(3.74) + 0.2, -15, dur=0.45, f0=2000, f1=6000, peak=0.45, p0=-0.6, p1=0.6)
cue("chime", 6.12, -19, notes=["G5", "C6"], gap=0.09)
# 3 · the drop: the window rises out of the floor and lands on the hit
cue("swell", T(5.742), -10, dur=1.3)
cue("riser", T(5.742), -14, dur=1.4)
cue("whoosh", T(5.742) - 0.15, -9, dur=0.7, f0=150, f1=1800, peak=0.75)
cue("impact", T(5.742), -2, size=1.25)
cue("whoosh", T(6.42) + 0.45, -16, dur=0.6, f0=600, f1=2400, peak=0.5, p0=-0.3, p1=0.5)

# keycap presses everywhere (the on-screen HUD)
for h in HUD:
    for pr in h["presses"]:
        cue("hud", T(pr), -11)
# typing inside the footage
for tt in ticks(A("editor", "type-start"), A("editor", "type-end"), 0.105):
    cue("key", tt, -21)
for tt in ticks(A("palette", "type-start"), A("palette", "type-end"), 0.085):
    cue("key", tt, -21)
for tt in ticks(A("blog", "url-start"), A("blog", "url-end"), 0.1):
    cue("key", tt, -22)
for tt in ticks(A("folders", "type-start"), A("folders", "type-start") + 4 * 0.11 / 0.85, 0.13):
    cue("key", tt, -21)

# window swings between scenes: travel with the window, thud on the bar
for b, frm, to in ((10.108, 0.5, -0.5), (14.473, -0.5, 0.5), (18.838, 0.5, -0.5), (23.204, -0.5, 0.5)):
    cue("whoosh", T(b), -10, dur=0.8, f0=250, f1=3000, peak=0.5, p0=frm, p1=to)
    cue("thump", T(b) + 0.02, -14)

# 4 · writing: click into the line, tick a checklist, ⌘E flips to typeset Read mode and back
cue("mouse", A("editor", "click-line"), -14)
cue("pluck", A("editor", "tick"), -13, note="G6", p=0.4)
cue("snap", A("editor", "tick"), -18, p=0.4)
cue("flip", A("editor", keys="⌘E") + 0.05, -11, p=0.4)
cue("shimmer", A("editor", keys="⌘E") + 0.12, -19, dur=0.8, p0=0.1, p1=0.7)
cue("flip", A("editor", keys="⌘E", nth=1) + 0.05, -14, p=0.4, up=False)

# 5 · search: the palette zips open, results arrive, ↩ opens the note
cue("whoosh", A("palette", keys="⌘P") + 0.1, -15, dur=0.25, f0=1200, f1=5200, peak=0.7, p0=-0.5, p1=-0.4)
cue("snap", A("palette", keys="⌘P") + 0.12, -16, p=-0.45)
cue("blips", A("palette", "type-end") + 0.08, -20, n=3)
cue("snap", A("palette", "enter"), -12, p=-0.45)
cue("pluck", A("palette", "enter") + 0.02, -17, note="C6", p=-0.45)

# 6 · tiling: each split slices the tile, the swap swishes across, zoom pushes in and out
cue("slice", A("tiling", keys="⌃⌥\\") + 0.12, -9, p0=0.0, p1=0.75)
cue("slice", A("tiling", keys="⌃⌥−") + 0.12, -9, p0=0.5, p1=0.5)
cue("whoosh", A("tiling", keys="⌃⌥⇧←") + 0.18, -12, dur=0.35, f0=900, f1=3600, peak=0.5, p0=0.7, p1=0.0)
cue("whoosh", A("tiling", keys="⌃⌥↩") + 0.22, -11, dur=0.45, f0=300, f1=2600, peak=0.75, p0=0.4, p1=0.4)
cue("thump", A("tiling", keys="⌃⌥↩") + 0.3, -16)
cue("whoosh", A("tiling", keys="⌃⌥↩", nth=1) + 0.1, -13, dur=0.45, f0=2600, f1=300, peak=0.3, p0=0.4, p1=0.4)

# 7 · sliding: the strip forms, columns swipe in from the right, focus skates, width ratchets
cue("switch", A("sliding", keys="⌃⌥T"), -10)
cue("whoosh", A("sliding", keys="⌃⌥T") + 0.25, -14, dur=0.5, f0=400, f1=3000, peak=0.5, p0=0.6, p1=-0.4)
for n in range(3):
    tt = A("sliding", keys="⌃⌥\\", nth=n)
    cue("whoosh", tt + 0.25, -11, dur=0.45, f0=600, f1=3200, peak=0.55, p0=0.9, p1=-0.1)
    cue("snap", tt + 0.32, -16, p=-0.2)
for n in range(2):
    cue("whoosh", A("sliding", keys="⌃⌥←", nth=n) + 0.12, -14, dur=0.3, f0=2400, f1=1200, peak=0.4, p0=-0.2, p1=-0.8)
cue("ratchet", A("sliding", keys="⌃⌥C"), -12, n=3)

# 8 · whiteboard: the board flips open, then the marker on every real stroke
cue("flip", A("whiteboard", keys="⌘⇧D") + 0.05, -12, p=0.5)
cue("whoosh", A("whiteboard", keys="⌘⇧D") + 0.12, -15, dur=0.4, f0=500, f1=3500, peak=0.5, p0=0.1, p1=0.7)
WB = CLIPS["whiteboard"]
for (fs, fe), mk in zip(((2.20, 2.77), (3.47, 4.20), (5.37, 5.63), (6.27, 6.63)), ("rect", "ellipse", "arrow", "pen")):
    cue("snap", A("whiteboard", mk), -21, p=0.5, pitch=1900)  # tool key
    cue("scribble", T(WB["start"] + (fs - WB["ms"]) / WB["rate"]), -11, dur=round((fe - fs) / WB["rate"], 3), p=0.5)
cue("whoosh", T(27.38) + 0.2, -12, dur=0.5, f0=2500, f1=300, peak=0.35, p0=0.4, p1=0.0)

# 9 · One more thing … Blog Reader: riser, cable, plug, zap, the title lands with a bell
cue("riser", 31.936, -13, dur=1.0)
cue("whoosh", 31.5, -20, dur=0.4, f0=800, f1=2400, peak=0.6, p0=-0.6, p1=0.0)
cue("snap", 31.72, -11, p=0.15, pitch=1800)
cue("zap", 31.72, -9)
cue("impact", 31.936, -3, size=1.1)
cue("bellsample", 31.936, -10, file="impactBell_heavy_000.ogg")
cue("shimmer", 31.95, -15, dur=1.6, p0=-0.4, p1=0.4)
cue("pluck", 32.42, -19, note="E6")
cue("whoosh", 33.75, -16, dur=0.4, f0=2000, f1=600, peak=0.4, p0=0.0, p1=-0.8)
# 10 · Blog Reader at work: window flies in, ⌃⌥B, the link, the fetch, the article lands, Read
cue("whoosh", T(29.74) - 0.1, -9, dur=0.6, f0=300, f1=3200, peak=0.55, p0=0.9, p1=0.3)
cue("thump", T(29.74), -12)
cue("whoosh", A("blog", keys="⌃⌥B") + 0.1, -15, dur=0.25, f0=1200, f1=5200, peak=0.7, p0=0.3, p1=0.3)
cue("riser", A("blog", "article"), -15, dur=0.45)
cue("impact", A("blog", "article"), -9, size=0.5)
cue("flip", A("blog", "article") + 0.04, -12, p=0.5)
cue("shimmer", A("blog", "article") + 0.08, -18, dur=0.9, p0=0.2, p1=0.7)
cue("pluck", A("blog", "article") + 0.12, -16, note="C6", p=-0.5)
cue("mouse", A("blog", "mark-read"), -12)
cue("switch", A("blog", "mark-read") + 0.02, -12)
cue("chime", A("blog", "mark-read") + 0.1, -12, notes=["C6", "E6", "G6"], p=-0.3)

# 11 · Make it yours: lights up, seven windows whoosh in from their own sides, the set lands,
#      light sweeps across, headline, names ring up the scale, the set parts, Gruvbox flies home
cue("whoosh", 40.45, -12, dur=0.5, f0=2400, f1=250, peak=0.35, p0=0.3, p1=0.0)
cue("lights", 40.4, -7)
LU_PATH = {  # k: (f0, f1, pan from, pan to)
    -3: (700, 2600, -1.0, -0.75), 3: (700, 2600, 1.0, 0.75),
    -2: (3200, 700, -0.5, -0.5), 2: (500, 2600, 0.5, 0.5),
    -1: (500, 2600, -0.25, -0.25), 1: (3200, 700, 0.25, 0.25),
    0: (200, 1800, 0.0, 0.0),
}
for j, k in enumerate([-3, 3, -2, 2, -1, 1, 0]):
    t0 = 40.654 + j * BEAT / 2
    f0, f1, p0, p1 = LU_PATH[k]
    cue("whoosh", t0 + 0.16, -8 if k == 0 else -11, dur=0.6, f0=f0, f1=f1, peak=0.3, p0=p0, p1=p1)
    if k:
        cue("thump", t0 + 0.38, -17)
cue("impact", 42.71, -5, size=0.85)
cue("shimmer", 43.2, -13, dur=1.4, p0=-0.85, p1=0.85)
cue("impact", 43.52, -11, size=0.45)
cue("whoosh", 43.5, -16, dur=0.35, f0=400, f1=2400, peak=0.8)
for i, (k, note) in enumerate(zip([0, -1, 1, -2, 2, -3, 3], ["C6", "D6", "E6", "G6", "A6", "C7", "D7"])):
    vx = next(c["vx"] for c in lineup if c["k"] == k)
    cue("pluck", 43.85 + i * 0.06, -21, note=note, p=round(vx / 960, 2), dur=0.7)
cue("riser", 46.4, -16, dur=1.6)
cue("whoosh", 46.55, -12, dur=0.55, f0=1800, f1=600, peak=0.3, p0=0.0, p1=-0.9)
cue("whoosh", 46.55, -12, dur=0.55, f0=1800, f1=600, peak=0.3, p0=0.0, p1=0.9)
cue("whoosh", 46.9, -11, dur=0.75, f0=300, f1=2000, peak=0.6, p0=0.0, p1=-0.5)
cue("thump", 47.2, -12)

# 12 · themes switching live: one note per theme up the scale, a chord when Gruvbox is back
for i, note in enumerate(["C5", "D5", "E5", "G5", "A5"]):
    cue("pluck", A("themes", nth=i), -12, note=note, p=-0.45)
    cue("snap", A("themes", nth=i), -21, p=-0.45, pitch=2600)
cue("chime", A("themes", nth=5), -12, notes=["C6", "E6", "G6"], p=-0.4)

# 13 · the little things: the frame tiles itself (slice, slice), phone rises, a note gets filed
cue("whoosh", T(40.66) + 0.25, -13, dur=0.5, f0=300, f1=2500, peak=0.5)
cue("slice", T(41.2) + 0.24, -10, p0=0.0, p1=0.7)
cue("slice", T(41.75) + 0.24, -10, p0=0.5, p1=0.5)
cue("whoosh", T(41.85) + 0.35, -16, dur=0.5, f0=400, f1=2200, peak=0.6, p0=0.6, p1=0.6)
cue("snap", A("folders", "enter") + 0.05, -14, p=-0.4)
cue("pluck", A("folders", "enter") + 0.08, -15, note="G5", p=-0.4)
cue("whoosh", T(44.72) + 0.2, -12, dur=0.45, f0=3000, f1=400, peak=0.4)
# 14 · local-first: edited, saving (data), saved (chord), three chips pop
cue("whoosh", T(45.35) + 0.2, -17, dur=0.4, f0=800, f1=2800, peak=0.5, p0=0.8, p1=0.4)
cue("snap", T(45.55), -18, p=0.4, pitch=1800)
cue("blips", T(46.12), -18, n=6)
cue("chime", T(46.644), -10, notes=["C6", "E6", "G6"], p=0.4)
cue("thump", T(46.644), -16)
for tt, note in zip((47.202, 47.736, 48.293), ("G5", "A5", "C6")):
    cue("pluck", T(tt), -15, note=note, p=0.4)
    cue("snap", T(tt), -20, p=0.4)
cue("whoosh", T(49.06) + 0.15, -18, dur=0.4, f0=2000, f1=500, peak=0.4)
# 15 · outro: everything pulls into the logo, the biggest hit, a bell, the tagline, the button
cue("swell", T(49.384), -10, dur=1.4)
cue("riser", T(49.384), -16, dur=1.2)
cue("impact", T(49.384), -2, size=1.3)
cue("bellsample", T(49.384), -8, file="impactBell_heavy_004.ogg")
cue("shimmer", T(49.384) + 0.02, -14, dur=2.4, p0=-0.5, p1=0.5)
cue("whoosh", T(49.52) + 0.25, -15, dur=0.5, f0=1500, f1=5000, peak=0.45, p0=-0.6, p1=0.6)
cue("chime", T(50.12), -17, notes=["G5", "C6"], gap=0.09)
cue("snap", T(50.8), -14)
cue("pluck", T(50.8) + 0.02, -16, note="C6")

# Mix: the screen-specific layer sits up with the music, the biggest hits come down a touch so
# they punch without swamping (measured against the bed; see brag-plan.md).
TRIM = {"impact": -2, "swell": -2, "bellsample": -2, "hud": 2, "key": 0}
for c in C:
    c["db"] += TRIM.get(c["kind"], 3)
C.sort(key=lambda c: c["t"])
(HERE / "sfx-cues.json").write_text(json.dumps({"duration": DUR, "cues": C}, indent=1, ensure_ascii=False))
sys.path.insert(0, str(HERE))
from sound_design import render as render_sfx  # noqa: E402

BRAG_SFX = next(Path("/root/.claude/plugins/synced").glob("*/brag/skills/brag/assets/sfx"))
render_sfx(C, DUR, COMP / "assets" / "sfx-stem.wav", BRAG_SFX)
rows = [
    '    <audio id="music" src="assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3" '
    f'data-start="0" data-duration="{DUR}" data-media-start="0.817" data-track-index="10" data-volume="1" '
    f"data-automation='{json.dumps(music_lane, separators=(',', ':'))}'></audio>",
    f'    <audio id="sfx" src="assets/sfx-stem.wav" data-start="0" data-duration="{DUR}" data-track-index="11" data-volume="{SFX_VOL}"></audio>',
]
lanes = [0]

DATA = dict(
    dur=DUR, bar=BAR, bars=BARS, hits=HITS,
    lineup=dict(fy=LU_FY, cards=[{k: c[k] for k in ("k", "s", "r", "x", "acc")} for c in lineup]), beat=BEAT, poses=POSES, W0=W0, H0=H0, hud=HUD,
    hook=dict(l1=HOOK1, l2=HOOK2, em=HOOK2_EM, times=hook_times),
    ev=dict(
        editorTypeStart=at("editor", "type-start"), editorReadMode=at("editor", keys="⌘E"),
        paletteOpen=at("palette", keys="⌘P"), paletteEnter=at("palette", "enter"),
        blogPrompt=at("blog", keys="⌃⌥B"), blogEnter=at("blog", "enter"), blogArticle=at("blog", "article"),
        blogRead=at("blog", "mark-read"),
        themes=[at("themes", nth=i) for i in range(6)],
        boardOpen=at("whiteboard", keys="⌘⇧D"),
        foldersMove=at("folders", keys="⌃⌥M"), foldersEnter=at("folders", "enter"),
    ),
)

tpl = (HERE / "composition.template.html").read_text()
html = (tpl.replace("%%DATA%%", json.dumps(DATA, ensure_ascii=False))
        .replace("%%AUDIO%%", "\n".join(rows))
        .replace("%%VIDEOS%%", "\n".join(vids))
        .replace("%%FOLDERS_VIDEO%%", folders_video)
        .replace("%%LINEUP%%", "\n".join(lu_html))
        .replace("%%DUR%%", str(DUR)))
# Section clip windows are authored in v1 time in the template; remap them (v2-only ones are fixed).
import re

FIXED = {"s-hook": (0, 5.75), "s-bi": (29.7, 4.3), "s-lineup": (40.25, 7.2)}


def clip_window(m):
    sid, st, du = m.group(1), float(m.group(3)), float(m.group(4))
    st, du = FIXED.get(sid, (T(st), du))
    return f'<section id="{sid}" class="{m.group(2)}" data-start="{st}" data-duration="{du}"'


html = re.sub(r'<section id="([\w-]+)" class="([^"]*)" data-start="([\d.]+)" data-duration="([\d.]+)"', clip_window, html)
(COMP / "index.html").write_text(html)
print(f"wrote index.html + sfx-stem.wav: {len(C)} sound cues, {len(HUD)} keycap clusters")
print("lineup:", [(c["name"], c["mode"], c["s"], c["x"], c["vx"]) for c in lineup], f"edge {edge:.0f}px")
print(json.dumps(DATA["ev"], indent=1, ensure_ascii=False))
