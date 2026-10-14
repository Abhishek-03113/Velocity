#!/usr/bin/env python3
"""Builds composition/index.html for the Velocity launch film (v2).

All timing lives here so the visuals (GSAP timeline) and the audio (<audio> clips) share one
source of truth: the music bar grid, the captured footage's key events (footage/*.events.json),
the typed hook, and the keycap HUD presses.

    python3 build-composition.py

v2 keeps v1's footage and choreography, authored in v1 time, and maps it onto the v2 timeline
with T(): the opening grows by one bar (problem, then answer) and a one-bar "One more thing."
beat is inserted before Blog Reader. Sections new to v2 (hook statement, "One more thing.",
plugin title) are authored directly in v2 time.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMP = HERE / "composition"
FOOT = COMP / "assets" / "footage"
DUR = 59.4

# One bar of the music (4 beats at 109.96 BPM).
BAR = 2.183


def T(t):
    """Map a v1 time onto the v2 timeline (same rule as T() in the template)."""
    if t < 3.3:
        return t
    if t < 27.5:
        return round(t + BAR, 3)
    if t >= 29.5:
        return round(t + 2 * BAR, 3)
    raise ValueError(f"v1 time {t} falls in the replaced plugin intro")

# Music: vol-12 started 0.817 s into the track (v1: 3.0 s), so v1 time t plays the same music at T(t)
# until the plugin intro. Bars below are v1 time.
# beat-locked (v2 time): drop 7.925 (window lands), 31.936 (Blog Reader title, strongest cue at
# track 32.74), 53.75 (outro logo).
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

# Typed hook.
HOOK1, HOOK2 = "Most notes apps", "make you "
HOOK2_EM = "wait."
hook_times = []
t = 0.30
for ch in HOOK1:
    hook_times.append(round(t, 3)); t += 0.052
t += 0.22
for ch in HOOK2 + HOOK2_EM:
    hook_times.append(round(t, 3)); t += 0.056

# Sparse key ticks under on-screen typing in the footage.
def ticks(t0, t1, step):
    out, t = [], t0
    while t < t1 - 0.02:
        out.append(round(t, 3)); t += step
    return out


typing_ticks = (
    ticks(at("editor", "type-start"), at("editor", "type-end"), 0.105)
    + ticks(at("palette", "type-start"), at("palette", "type-end"), 0.085)
    + ticks(at("blog", "url-start"), at("blog", "url-end"), 0.1)
    + ticks(at("folders", "type-start"), at("folders", "type-start") + 4 * 0.11 / 0.85, 0.13)
)

# ───────────────────────────── audio clips ─────────────────────────────
audio = []  # (id, src, start, dur, vol)
KEYS = [f"assets/sfx/keyboard/keypress-{n:03d}.wav" for n in (3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25)]
k = 0
full_hook = HOOK1 + HOOK2 + HOOK2_EM
for i, (ch, tt) in enumerate(zip(full_hook, hook_times)):
    if ch == " ":
        continue
    audio.append((f"sfx-hook-{i:02d}", KEYS[(i * 7) % len(KEYS)], tt, 0.25, 0.62))
for i, tt in enumerate(typing_ticks):
    audio.append((f"sfx-type-{i:02d}", KEYS[(i * 5 + 3) % len(KEYS)], T(tt), 0.25, 0.26))
n = 0
for h in HUD:
    for p in h["presses"]:
        audio.append((f"sfx-key-{n:02d}", KEYS[(n * 3 + 1) % len(KEYS)], T(p), 0.25, 0.85))
        audio.append((f"sfx-keyclick-{n:02d}", "assets/sfx/interface/click_003.ogg", T(p), 0.05, 0.5))
        n += 1
# Moments (v1 time, mapped with T) …
SW = [10.108, 14.473, 18.838, 23.204]
moments = [
    ("sfx-icon", "assets/sfx/interface/drop_002.ogg", 3.56, 0.2, 0.6),
    ("sfx-drop", "assets/sfx/impact/impactSoft_heavy_003.ogg", 5.742, 0.55, 0.75),
    ("sfx-blog-in", "assets/sfx/impact/impactSoft_medium_001.ogg", 29.74, 0.19, 0.55),
    ("sfx-read", "assets/sfx/interface/switch_007.ogg", at("blog", "mark-read"), 0.62, 0.55),
    ("sfx-card", "assets/sfx/interface/drop_001.ogg", at("blog", "article") + 0.12, 0.11, 0.5),
    ("sfx-wall-1", "assets/sfx/interface/drop_001.ogg", 40.70, 0.11, 0.5),
    ("sfx-wall-2", "assets/sfx/interface/drop_002.ogg", 41.20, 0.2, 0.5),
    ("sfx-wall-3", "assets/sfx/interface/drop_001.ogg", 41.75, 0.11, 0.5),
    ("sfx-saved", "assets/sfx/interface/bong_001.ogg", 46.93, 0.13, 0.5),
    ("sfx-chip", "assets/sfx/interface/drop_002.ogg", 47.202, 0.2, 0.4),
    ("sfx-outro", "assets/sfx/impact/impactBell_heavy_004.ogg", 49.384, 0.31, 0.6),
]
for i, b in enumerate(SW):
    moments.append((f"sfx-swing-{i}", "assets/sfx/casino/card-slide-1.ogg", b - 0.22, 0.6, 0.32))
moments.append(("sfx-swing-themes", "assets/sfx/casino/card-slide-1.ogg", 36.07, 0.6, 0.3))
audio += [(a, src, T(st), du, vol) for a, src, st, du, vol in moments]
# … and the v2-only beats, in v2 time.
audio += [
    ("sfx-hook2", "assets/sfx/interface/drop_001.ogg", 3.52, 0.11, 0.38),
    ("sfx-swing-blog", "assets/sfx/casino/card-slide-1.ogg", 29.6, 0.6, 0.28),
    ("sfx-plug", "assets/sfx/interface/switch_007.ogg", 31.56, 0.62, 0.5),
    ("sfx-bell-blog", "assets/sfx/impact/impactBell_heavy_000.ogg", 31.936, 1.48, 0.42),
]

# Greedy track allocation so overlapping clips never share a lane.
audio.sort(key=lambda a: a[2])
lanes = []
rows = []
for aid, src, st, du, vol in audio:
    for li, end in enumerate(lanes):
        if end <= st + 1e-6:
            lanes[li] = st + du
            break
    else:
        lanes.append(st + du)
        li = len(lanes) - 1
    rows.append(
        f'    <audio id="{aid}" src="{src}" data-start="{st:.3f}" data-duration="{du:.3f}" '
        f'data-track-index="{20 + li}" data-volume="{vol}"></audio>'
    )
# The bed dips under "One more thing." and comes back on the Blog Reader title.
music_lane = {"version": 1, "lanes": [{"target": "volume", "points": [
    {"t": 0, "v": 0}, {"t": 0.5, "v": 0.2}, {"t": 5.4, "v": 0.25}, {"t": 7.8, "v": 0.36},
    {"t": 29.4, "v": 0.36}, {"t": 30.1, "v": 0.17}, {"t": 31.75, "v": 0.17}, {"t": 31.94, "v": 0.4},
    {"t": 32.8, "v": 0.36}, {"t": 56.0, "v": 0.36}, {"t": 59.3, "v": 0}]}]}
rows.insert(0,
    '    <audio id="music" src="assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3" '
    f'data-start="0" data-duration="{DUR}" data-media-start="0.817" data-track-index="10" data-volume="1" '
    f"data-automation='{json.dumps(music_lane, separators=(',', ':'))}'></audio>")

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

DATA = dict(
    dur=DUR, bar=BAR, bars=BARS, beat=BEAT, poses=POSES, W0=W0, H0=H0, hud=HUD,
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
        .replace("%%DUR%%", str(DUR)))
# Section clip windows are authored in v1 time in the template; remap them (v2-only ones are fixed).
import re

FIXED = {"s-hook": (0, 5.75), "s-bi": (29.7, 4.3)}


def clip_window(m):
    sid, st, du = m.group(1), float(m.group(3)), float(m.group(4))
    st, du = FIXED.get(sid, (T(st), du))
    return f'<section id="{sid}" class="{m.group(2)}" data-start="{st}" data-duration="{du}"'


html = re.sub(r'<section id="([\w-]+)" class="([^"]*)" data-start="([\d.]+)" data-duration="([\d.]+)"', clip_window, html)
(COMP / "index.html").write_text(html)
print(f"wrote index.html: {len(rows)} audio clips, {len(HUD)} keycap clusters, {len(lanes)} sfx lanes")
print(json.dumps(DATA["ev"], indent=1, ensure_ascii=False))
