#!/usr/bin/env python3
"""Builds composition/index.html for the Velocity launch film.

All timing lives here so the visuals (GSAP timeline) and the audio (<audio> clips) share one
source of truth: the music bar grid, the captured footage's key events (footage/*.events.json),
the typed hook, and the keycap HUD presses.

    python3 build-composition.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMP = HERE / "composition"
FOOT = COMP / "assets" / "footage"
DUR = 55.0

# Music: vol-12 started 3.0 s into the track. Bars (video time) from the cue analysis.
# beat-locked: drop 5.742 (window lands), 29.74 (Blog Reader window), 49.384 (outro logo).
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
HOOK1, HOOK2 = "Think at the speed", "of your "
HOOK2_EM = "keys."
hook_times = []
t = 0.36
for ch in HOOK1:
    hook_times.append(round(t, 3)); t += 0.058
t = 1.56
for ch in HOOK2 + HOOK2_EM:
    hook_times.append(round(t, 3)); t += 0.062

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
    audio.append((f"sfx-type-{i:02d}", KEYS[(i * 5 + 3) % len(KEYS)], tt, 0.25, 0.26))
n = 0
for h in HUD:
    for p in h["presses"]:
        audio.append((f"sfx-key-{n:02d}", KEYS[(n * 3 + 1) % len(KEYS)], p, 0.25, 0.85))
        audio.append((f"sfx-keyclick-{n:02d}", "assets/sfx/interface/click_003.ogg", p, 0.05, 0.5))
        n += 1
# Moments.
SW = [10.108, 14.473, 18.838, 23.204]
audio += [
    ("sfx-icon", "assets/sfx/interface/drop_002.ogg", 3.56, 0.2, 0.6),
    ("sfx-drop", "assets/sfx/impact/impactSoft_heavy_003.ogg", 5.742, 0.55, 0.75),
    ("sfx-plug", "assets/sfx/interface/switch_007.ogg", 28.0, 0.62, 0.5),
    ("sfx-bell-blog", "assets/sfx/impact/impactBell_heavy_000.ogg", 28.103, 1.48, 0.42),
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
    audio.append((f"sfx-swing-{i}", "assets/sfx/casino/card-slide-1.ogg", b - 0.22, 0.6, 0.32))
audio.append(("sfx-swing-blog", "assets/sfx/casino/card-slide-1.ogg", 27.42, 0.6, 0.3))
audio.append(("sfx-swing-themes", "assets/sfx/casino/card-slide-1.ogg", 36.07, 0.6, 0.3))

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
music_lane = {"version": 1, "lanes": [{"target": "volume", "points": [
    {"t": 0, "v": 0}, {"t": 0.5, "v": 0.22}, {"t": 3.3, "v": 0.26}, {"t": 5.6, "v": 0.36},
    {"t": 51.6, "v": 0.36}, {"t": 54.9, "v": 0}]}]}
rows.insert(0,
    '    <audio id="music" src="assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3" '
    f'data-start="0" data-duration="{DUR}" data-media-start="3.0" data-track-index="10" data-volume="1" '
    f"data-automation='{json.dumps(music_lane, separators=(',', ':'))}'></audio>")

# ───────────────────────────── footage <video> clips ─────────────────────────────
vids = []
for name in ["editor", "palette", "tiling", "sliding", "whiteboard", "blog", "themes"]:
    c = CLIPS[name]
    vids.append(
        f'            <video id="v-{name}" src="assets/footage/{name}.mp4" muted playsinline '
        f'data-start="{c["start"]}" data-duration="{round(c["end"] - c["start"], 3)}" '
        f'data-media-start="{c["ms"]}" data-playback-rate="{c["rate"]}" data-track-index="1"></video>')
fc = CLIPS["folders"]
folders_video = (
    f'<video id="v-folders" src="assets/footage/folders.mp4" muted playsinline '
    f'data-start="{fc["start"]}" data-duration="{round(fc["end"] - fc["start"], 3)}" '
    f'data-media-start="{fc["ms"]}" data-playback-rate="{fc["rate"]}" data-track-index="2"></video>')

DATA = dict(
    dur=DUR, bars=BARS, beat=BEAT, poses=POSES, W0=W0, H0=H0, hud=HUD,
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
(COMP / "index.html").write_text(html)
print(f"wrote index.html: {len(rows)} audio clips, {len(HUD)} keycap clusters, {len(lanes)} sfx lanes")
print(json.dumps(DATA["ev"], indent=1, ensure_ascii=False))
