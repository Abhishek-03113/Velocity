#!/usr/bin/env python3
"""Sound design for the Velocity launch film (v4).

Renders the whole SFX layer as one stereo stem from a cue list, so every sound can be shaped and
panned for the exact moment it sits under: whooshes that travel with the window, risers that cut
into hits, sub impacts, tile slices, column swipes, whiteboard scribbles, plucks and chimes in the
music's key (C major), a studio-lights clunk, a plug zap. Everything is synthesised with numpy and
seeded, so the stem is identical on every build; the only samples are the keyboard / click / switch
/ bell sounds from the /brag library.

    from sound_design import render
    render(cues, duration, "composition/assets/sfx-stem.wav", sample_dir)
"""
import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 48000

# C major pentatonic, Hz.
NOTE = {
    "C4": 261.63, "D4": 293.66, "E4": 329.63, "G4": 392.00, "A4": 440.00,
    "C5": 523.25, "D5": 587.33, "E5": 659.25, "G5": 783.99, "A5": 880.00,
    "C6": 1046.50, "D6": 1174.66, "E6": 1318.51, "G6": 1567.98, "A6": 1760.00,
    "C7": 2093.00, "D7": 2349.32,
}


# ───────────────────────────── building blocks ─────────────────────────────

def _t(dur):
    return np.arange(int(round(dur * SR))) / SR


def _fade(x, a=0.002, r=0.01):
    n = len(x)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na:
        x[:na] *= np.linspace(0, 1, na)
    if nr:
        x[n - nr:] *= np.linspace(1, 0, nr)
    return x


def band_noise(dur, fc, bw_oct=1.0, seed=0, am=None):
    """Noise through a band-pass whose centre follows fc(u), u = 0..1 over the sound (STFT mask)."""
    n = max(1, int(round(dur * SR)))
    N, hop = 1024, 256
    frames = int(math.ceil((n + N) / hop)) + 1
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(frames * hop + N)
    win = np.hanning(N)
    f = np.fft.rfftfreq(N, 1 / SR)
    f[0] = 1.0
    out = np.zeros(frames * hop + N)
    norm = np.zeros(frames * hop + N)
    sig = bw_oct / 2.355
    for i in range(frames):
        u = min(1.0, max(0.0, (i * hop - N / 2) / n))
        c = fc(u)
        spec = np.fft.rfft(noise[i * hop:i * hop + N] * win)
        spec *= np.exp(-0.5 * (np.log2(f / c) / sig) ** 2)
        out[i * hop:i * hop + N] += np.fft.irfft(spec, N) * win
        norm[i * hop:i * hop + N] += win ** 2
    y = out[N // 2:N // 2 + n] / np.maximum(norm[N // 2:N // 2 + n], 1e-3)
    if am is not None:
        y *= am
    return y / (np.max(np.abs(y)) + 1e-9)


def sweep_env(n, peak=0.5, a=2.2, r=1.6):
    u = np.linspace(0, 1, n)
    return np.where(u < peak, (u / peak) ** a, ((1 - u) / (1 - peak + 1e-9)) ** r)


def pan(x, p0=0.0, p1=None):
    """Equal-power pan from p0 to p1 (-1 left … 1 right)."""
    p1 = p0 if p1 is None else p1
    p = np.linspace(p0, p1, len(x))
    th = (p + 1) * math.pi / 4
    return np.stack([x * np.cos(th), x * np.sin(th)], axis=1)


def stereo(x):
    return np.stack([x, x], axis=1)


def norm(x, peak=1.0):
    return x * (peak / (np.max(np.abs(x)) + 1e-9))


# ───────────────────────────── instruments ─────────────────────────────

def whoosh(dur=0.5, f0=500, f1=4000, peak=0.55, bw=1.1, p0=0.0, p1=0.0, seed=1):
    n = int(dur * SR)
    lo = band_noise(dur, lambda u: f0 * (f1 / f0) ** u, bw, seed)
    hi = band_noise(dur, lambda u: 2.2 * f0 * (f1 / f0) ** u, bw * 0.7, seed + 1)
    env = sweep_env(n, peak)
    # air brightens as it passes the listener
    y = (lo * 0.8 + hi * 0.45 * env) * env
    return pan(_fade(norm(y)), p0, p1)


def riser(dur=1.4, f0=220, f1=5200, tone=(110, 440), seed=3):
    n = int(dur * SR)
    t = _t(dur)
    u = np.linspace(0, 1, n)
    trem = 0.65 + 0.35 * np.sin(2 * np.pi * np.cumsum(6 + 18 * u ** 2) / SR)
    nz = band_noise(dur, lambda v: f0 * (f1 / f0) ** (v ** 1.4), 1.3, seed) * trem
    fr = tone[0] * (tone[1] / tone[0]) ** (u ** 1.3)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    saw = sum(np.sin(k * ph) / k for k in range(1, 7)) * 0.5
    saw += 0.35 * sum(np.sin(k * ph * 1.006) / k for k in range(1, 5))
    y = nz * u ** 3.2 + saw * u ** 2.6 * 0.55
    return stereo(_fade(norm(y), 0.01, 0.006))


def swell(dur=1.2, seed=5):
    """Reversed tail + shimmer: sucks in toward a hit."""
    tl = tail(dur, seed)[::-1]
    sh = shimmer_mono(dur, seed + 1)[::-1]
    u = np.linspace(0, 1, len(tl))
    y = (tl[:, 0] * 0.7 + sh * 0.5) * u ** 2
    return pan(_fade(norm(y), 0.01, 0.004), -0.3, 0.3)


def sub_boom(dur=1.0, f0=95, f1=36, decay=0.35):
    t = _t(dur)
    fr = f1 + (f0 - f1) * np.exp(-t / 0.06)
    y = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / decay)
    y = np.tanh(1.6 * y)
    return _fade(norm(y), 0.003, 0.05)


def crack(dur=0.14, seed=7):
    t = _t(dur)
    y = band_noise(dur, lambda u: 3600 - 1200 * u, 2.4, seed) * np.exp(-t / 0.02)
    return _fade(norm(y), 0.0005, 0.01)


def tail(dur=1.3, seed=9, fc=(900, 380)):
    t = _t(dur)
    e = np.exp(-t / (dur * 0.28))
    l = band_noise(dur, lambda u: fc[0] * (fc[1] / fc[0]) ** u, 2.6, seed) * e
    r = band_noise(dur, lambda u: fc[0] * (fc[1] / fc[0]) ** u, 2.6, seed + 100) * e
    return np.stack([_fade(l, 0.004), _fade(r, 0.004)], axis=1)


def impact(size=1.0, seed=11):
    dur = 0.7 + 0.9 * size
    b = sub_boom(dur, 90 + 20 * size, 34, 0.22 + 0.25 * size)
    c = crack(0.14, seed)
    tl = tail(dur, seed + 1)
    y = stereo(b) * 1.0
    y[: len(c)] += stereo(c) * (0.45 + 0.25 * size)
    y += tl * (0.22 + 0.25 * size)
    return norm(y)


def thump(seed=13):
    b = sub_boom(0.4, 85, 45, 0.11)
    c = crack(0.05, seed)
    y = stereo(b)
    y[: len(c)] += stereo(c) * 0.25
    return norm(y)


def snap(p=0.0, seed=15, pitch=2400):
    t = _t(0.09)
    click = band_noise(0.09, lambda u: 5200, 2.0, seed) * np.exp(-t / 0.0016)
    blip = np.sin(2 * np.pi * pitch * t) * np.exp(-t / 0.007) * 0.55
    y = click + blip
    return pan(_fade(norm(y), 0.0003, 0.02), p, p)


def slice_(p0=-0.2, p1=0.6, seed=17, dur=0.24):
    w = whoosh(dur, 7600, 1700, 0.32, 0.9, p0, p1, seed)
    s = snap(p1, seed + 3)
    y = w * 0.8
    off = int((dur - 0.06) * SR)
    end = off + len(s)
    if end > len(y):
        y = np.concatenate([y, np.zeros((end - len(y), 2))])
    y[off:end] += s * 0.75
    return norm(y)


def ratchet(n=3, seed=19):
    parts = [snap(0.0, seed + i, 2000 + 350 * i) for i in range(n)]
    gap = int(0.05 * SR)
    y = np.zeros((gap * (n - 1) + len(parts[0]), 2))
    for i, p in enumerate(parts):
        y[i * gap:i * gap + len(p)] += p * (0.7 + 0.15 * i)
    return norm(y)


def scribble(dur=0.5, p=0.4, seed=21):
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    # pen pressure: smoothed random at ~28 Hz, never fully silent mid-stroke
    k = max(4, int(dur * 28))
    ctrl = 0.35 + 0.65 * rng.random(k)
    am = np.interp(np.linspace(0, k - 1, n), np.arange(k), ctrl)
    jitter = np.interp(np.linspace(0, k - 1, 200), np.arange(k), 2600 + 900 * rng.random(k))
    y = band_noise(dur, lambda u: float(jitter[min(199, int(u * 199))]), 1.4, seed, am)
    body = band_noise(dur, lambda u: 700, 1.2, seed + 1, am) * 0.35
    y = _fade(norm(y + body), 0.015, 0.03)
    return pan(y, p, p)


def pluck(freq=880.0, dur=0.9, p=0.0, seed=23):
    t = _t(dur)
    rng = np.random.default_rng(seed)
    y = np.zeros_like(t)
    for k in range(1, 11):
        y += (1 / k ** 1.25) * np.sin(2 * np.pi * k * freq * t + rng.random() * 6.28) * np.exp(-t * (2.6 + 1.9 * k))
    y += 0.25 * np.sin(2 * np.pi * freq * 1.003 * t) * np.exp(-t * 3)
    pick = band_noise(0.03, lambda u: min(9000, freq * 4), 1.5, seed) * np.exp(-_t(0.03) / 0.004)
    y[: len(pick)] += pick * 0.3
    return pan(_fade(norm(y), 0.001, 0.05), p, p)


def bell(freq=1046.5, dur=1.4, p=0.0):
    t = _t(dur)
    y = np.zeros_like(t)
    for ratio, amp, dec in ((1, 1, 1.1), (2.0, 0.45, 0.8), (2.76, 0.35, 0.55), (4.07, 0.2, 0.35), (5.4, 0.12, 0.25)):
        y += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t / dec)
    return pan(_fade(norm(y), 0.001, 0.08), p, p)


def chime(notes=("C6", "E6", "G6"), gap=0.07, p=0.0):
    parts = [bell(NOTE[n], 1.2, p + (i - 1) * 0.15) for i, n in enumerate(notes)]
    g = int(gap * SR)
    y = np.zeros((g * (len(parts) - 1) + len(parts[0]), 2))
    for i, s in enumerate(parts):
        y[i * g:i * g + len(s)] += s * (1 - 0.12 * i)
    return norm(y)


def blips(n=5, seed=25):
    rng = np.random.default_rng(seed)
    seq = ["C7", "G6", "E6", "A6", "D7", "C7", "G6"]
    one = int(0.026 * SR)
    gap = int(0.052 * SR)
    y = np.zeros((gap * n + one, 2))
    for i in range(n):
        f = NOTE[seq[(i + int(rng.integers(0, 3))) % len(seq)]]
        t = _t(0.026)
        s = sum(np.sin(2 * np.pi * f * k * t) / k for k in (1, 3, 5, 7)) * np.exp(-t / 0.012)
        y[i * gap:i * gap + one] += pan(_fade(s, 0.0005, 0.004), (i % 2) * 0.5 - 0.25)
    return norm(y)


def zap(seed=27):
    dur = 0.32
    t = _t(dur)
    fr = 180 + 2700 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    tone = np.sin(ph + 2.5 * np.sin(2 * np.pi * 90 * t)) * np.exp(-t / 0.06)
    rng = np.random.default_rng(seed)
    gate = (rng.random(int(dur * 400)) > 0.45).astype(float)
    gate = np.repeat(gate, int(SR / 400))[: len(t)]
    gate = np.pad(gate, (0, len(t) - len(gate)))
    crk = band_noise(dur, lambda u: 4200, 1.6, seed) * gate * np.exp(-t / 0.09)
    y = tone * 0.8 + crk * 0.6
    return pan(_fade(norm(y), 0.0005, 0.02), 0.15, 0.15)


def shimmer_mono(dur=1.0, seed=29):
    t = _t(dur)
    rng = np.random.default_rng(seed)
    y = np.zeros_like(t)
    for name in ("C6", "E6", "G6", "A6", "C7", "D7", "E6", "G6"):
        on = rng.random() * dur * 0.35
        f = NOTE[name] * (1 + 0.002 * rng.standard_normal())
        e = np.clip((t - on) / 0.06, 0, 1) * np.exp(-np.maximum(t - on, 0) / (dur * 0.45))
        y += np.sin(2 * np.pi * f * t + rng.random() * 6.28) * e * (0.6 + 0.4 * np.sin(2 * np.pi * (7 + 4 * rng.random()) * t))
    air = band_noise(dur, lambda u: 9000, 1.5, seed + 1) * sweep_env(len(t), 0.3) * 0.25
    return _fade(norm(y + air), 0.01, 0.05)


def shimmer(dur=1.0, p0=-0.6, p1=0.6, seed=29):
    return pan(shimmer_mono(dur, seed), p0, p1)


def flip(p=0.2, seed=31, up=True):
    dur = 0.26
    t = _t(dur)
    am = 0.55 + 0.45 * np.sin(2 * np.pi * 38 * t) ** 2
    f0, f1 = (1800, 5600) if up else (5600, 1800)
    y = band_noise(dur, lambda u: f0 * (f1 / f0) ** u, 1.2, seed, am) * sweep_env(len(t), 0.4)
    return pan(_fade(norm(y)), p - 0.2, p + 0.2)


def lights(seed=33):
    """Studio lights coming on: a heavy clunk, then mains hum swelling in and out."""
    b = sub_boom(0.5, 120, 55, 0.08)
    c = band_noise(0.06, lambda u: 420, 1.5, seed) * np.exp(-_t(0.06) / 0.012)
    dur = 1.4
    t = _t(dur)
    hum = (np.sin(2 * np.pi * 60 * t) + 0.5 * np.sin(2 * np.pi * 120 * t) + 0.25 * np.sin(2 * np.pi * 180 * t))
    hum *= np.clip(t / 0.25, 0, 1) * np.exp(-t / 0.5) * 0.35
    y = np.zeros(len(t))
    y[: len(b)] += b
    y[: len(c)] += c * 0.6
    y += hum
    return stereo(_fade(norm(y), 0.001, 0.05))


# ───────────────────────────── samples ─────────────────────────────

_cache = {}


def sample(path):
    path = str(path)
    if path not in _cache:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
            capture_output=True, check=True).stdout
        _cache[path] = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    return _cache[path]


# ───────────────────────────── mixer ─────────────────────────────

def _limit(x, thr=0.89, release=0.08):
    blk = 240
    n = len(x)
    nb = int(math.ceil(n / blk))
    pad = np.pad(np.max(np.abs(x), axis=1), (0, nb * blk - n))
    peaks = pad.reshape(nb, blk).max(axis=1)
    # look ahead one block
    peaks = np.maximum(peaks, np.concatenate([peaks[1:], peaks[-1:]]))
    g = np.minimum(1.0, thr / np.maximum(peaks, 1e-9))
    a = math.exp(-blk / (release * SR))
    s = np.empty(nb)
    cur = 1.0
    for i, gi in enumerate(g):
        cur = gi if gi < cur else gi + (cur - gi) * a
        s[i] = cur
    gs = np.interp(np.arange(n), np.arange(nb) * blk + blk / 2, s)
    return x * gs[:, None]


def render(cues, duration, out_path, sample_dir):
    sd = Path(sample_dir)
    keys = sorted((sd / "keyboard").glob("keypress-*.wav"))
    buf = np.zeros((int(math.ceil(duration * SR)) + SR, 2))

    def put(sig, t, db):
        i = int(round(t * SR))
        if i < 0:
            sig, i = sig[-i:], 0
        end = min(len(buf), i + len(sig))
        buf[i:end] += sig[: end - i] * (10 ** (db / 20))

    for n, c in enumerate(cues):
        k, t, db = c["kind"], c["t"], c.get("db", -12)
        seed = 101 + n
        if k == "key":
            put(sample(keys[c.get("i", n) % len(keys)]), t, db)
        elif k == "hud":  # keycap press: key + click + a little body
            put(sample(keys[(n * 3 + 1) % len(keys)]), t, db)
            put(sample(sd / "interface" / "click_003.ogg"), t, db - 5)
            put(thump(seed) * 0.5, t, db - 6)
        elif k == "mouse":
            put(sample(sd / "ui" / "mouseclick1.ogg"), t, db)
        elif k == "switch":
            put(sample(sd / "interface" / "switch_007.ogg"), t, db)
        elif k == "bellsample":
            put(sample(sd / "impact" / c["file"]), t, db)
        elif k == "whoosh":
            d = c.get("dur", 0.5)
            w = whoosh(d, c.get("f0", 400), c.get("f1", 4000), c.get("peak", 0.6), c.get("bw", 1.1),
                       c.get("p0", 0), c.get("p1", 0), seed)
            put(w, t - d * c.get("peak", 0.6), db)  # t = moment of passing
        elif k == "riser":
            d = c.get("dur", 1.4)
            put(riser(d, seed=seed), t - d, db)  # t = the hit it cuts into
        elif k == "swell":
            d = c.get("dur", 1.2)
            put(swell(d, seed), t - d, db)
        elif k == "impact":
            put(impact(c.get("size", 1.0), seed), t, db)
        elif k == "thump":
            put(thump(seed), t, db)
        elif k == "snap":
            put(snap(c.get("p", 0), seed, c.get("pitch", 2400)), t, db)
        elif k == "slice":
            d = c.get("dur", 0.24)
            put(slice_(c.get("p0", -0.2), c.get("p1", 0.5), seed, d), t - d + 0.06, db)  # t = the snap
        elif k == "ratchet":
            put(ratchet(c.get("n", 3), seed), t, db)
        elif k == "scribble":
            put(scribble(c["dur"], c.get("p", 0.4), seed), t, db)
        elif k == "pluck":
            put(pluck(NOTE[c["note"]], c.get("dur", 0.9), c.get("p", 0), seed), t, db)
        elif k == "chime":
            put(chime(tuple(c["notes"]), c.get("gap", 0.07), c.get("p", 0)), t, db)
        elif k == "blips":
            put(blips(c.get("n", 5), seed), t, db)
        elif k == "zap":
            put(zap(seed), t, db)
        elif k == "shimmer":
            put(shimmer(c.get("dur", 1.0), c.get("p0", -0.6), c.get("p1", 0.6), seed), t, db)
        elif k == "flip":
            put(flip(c.get("p", 0.2), seed, c.get("up", True)), t, db)
        elif k == "lights":
            put(lights(seed), t, db)
        else:
            raise ValueError(f"unknown cue kind {k}")

    y = _limit(buf[: int(math.ceil(duration * SR))])
    pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return y


if __name__ == "__main__":
    import sys

    cues = json.loads(Path(sys.argv[1]).read_text())
    render(cues["cues"], cues["duration"], sys.argv[2], sys.argv[3])
