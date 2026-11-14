"""Dataset assembly: per-song features, beat-phase features, per-chart step targets, song-level splits."""
from __future__ import annotations

import glob
import json
import random
from dataclasses import dataclass
import os
from pathlib import Path

import numpy as np

from features import FPS
from simfile import DIFFS, Timing

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))


@dataclass
class Song:
    key: str
    feats: np.ndarray  # (T, 192) float32, normalised
    phase: np.ndarray  # (T, 6) beat-phase sin/cos at 4th, 8th, 16th
    onset: np.ndarray  # (T,)
    meta: dict


def beat_phase(meta: dict, n: int) -> np.ndarray:
    tm = Timing(meta["offset"], [tuple(x) for x in meta["bpms"]], [tuple(x) for x in meta.get("stops", [])])
    beats = np.array([tm.time_to_beat(i / FPS) for i in range(n)])
    cols = []
    for k in (1, 2, 4):
        cols += [np.sin(2 * np.pi * beats * k), np.cos(2 * np.pi * beats * k)]
    return np.stack(cols, axis=1).astype(np.float32)


BANDS = os.environ.get("CHARTNET_BANDS", "1") == "1"
N_BANDS = 8


def band_rhythm(logmel: np.ndarray) -> np.ndarray:
    """Which layer of the music carries the rhythm. From the short-window log-mel (64 bands, bass to ~11 kHz):
    the onset strength in 8 bands (rise of energy, frame to frame), and each band's share of the onset energy over
    the surrounding 4 seconds: bass, drums and a high melody each light up their own bands. (T, 16)."""
    m = logmel[:, :64].astype(np.float32)
    rise = np.maximum(m[1:] - m[:-1], 0)
    rise = np.concatenate([rise[:1] * 0, rise])
    flux = rise.reshape(len(m), N_BANDS, 64 // N_BANDS).mean(2)
    k = 400
    c = np.cumsum(np.pad(flux, ((k // 2, k - k // 2), (0, 0))), axis=0)
    smooth = (c[k:] - c[:-k]) / k
    share = smooth / (smooth.sum(1, keepdims=True) + 1e-6)
    return np.concatenate([np.log1p(4 * flux), share], axis=1)


def load(cache: str, stats: tuple[np.ndarray, np.ndarray] | None = None, only: set[str] | None = None) -> list[Song]:
    """Songs with normalised features (kept as float16: a few thousand songs have to fit in memory).
    `only` loads just those keys (needs `stats`)."""
    songs = []
    for j in sorted(glob.glob(str(ROOT / cache / "*.json"))):
        if only is not None and Path(j).stem not in only:
            continue
        meta = json.loads(Path(j).read_text())
        z = np.load(j[:-5] + ".npz")
        f = z["feats"]
        if BANDS:
            f = np.concatenate([f, band_rhythm(f).astype(np.float16)], axis=1)
        songs.append(Song(meta["key"], f, beat_phase(meta, len(f)), z["onset"], meta))
    if stats is None:
        allf = np.concatenate([s.feats[::10] for s in songs]).astype(np.float32)
        stats = (allf.mean(0), allf.std(0) + 1e-5)
    for s in songs:
        s.feats = ((s.feats.astype(np.float32) - stats[0]) / stats[1]).astype(np.float16)
    return songs, stats


def diff_index(d: str) -> int:
    return DIFFS.index(d) if d in DIFFS else 3


def targets(chart: dict, n: int) -> np.ndarray:
    y = np.zeros(n, dtype=np.float32)
    for _, t, row in chart["rows"]:
        if any(c in "124" for c in row):  # taps, hold heads, roll heads (mines/tails ignored)
            i = int(round(t * FPS))
            if 0 <= i < n:
                y[i] = 1.0
    return y


def song_title(key: str) -> str:
    """The song's folder name without its pack, letters and digits only."""
    return "".join(ch for ch in key.split("__", 1)[-1].lower() if ch.isalnum())


def split(songs: list[Song], seed: int = 0) -> tuple[list[Song], list[Song], list[Song]]:
    """Train, validation and test songs. With `test_keys.json` in the work folder the test songs are exactly those
    (the 48 DDR/ITG songs every ChartNet version is scored on) plus `test2_keys.json` (held-out community songs);
    neither is ever trained on."""
    frozen = ROOT / "test_keys.json"
    if frozen.exists():
        test = set(json.loads(frozen.read_text()))
        t2 = ROOT / "test2_keys.json"
        test2 = set(json.loads(t2.read_text())) if t2.exists() else set()
        # the same song turns up in several packs (edit packs, re-releases): none of those copies is trained on either
        held_titles = {song_title(k) for k in test | test2}
        rest = sorted(s.key for s in songs if s.key not in test | test2 and song_title(s.key) not in held_titles)
        random.Random(seed).shuffle(rest)
        val = set(rest[: max(len(rest) // 20, 1)])
        return ([s for s in songs if s.key in set(rest) - val], [s for s in songs if s.key in val],
                [s for s in songs if s.key in test])
    keys = sorted(s.key for s in songs)
    random.Random(seed).shuffle(keys)
    n = len(keys)
    test = set(keys[: n // 10])
    val = set(keys[n // 10: n // 10 + n // 20])
    return ([s for s in songs if s.key not in test | val], [s for s in songs if s.key in val],
            [s for s in songs if s.key in test])
