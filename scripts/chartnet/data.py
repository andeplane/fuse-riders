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


def load(cache: str, stats: tuple[np.ndarray, np.ndarray] | None = None) -> list[Song]:
    songs = []
    for j in sorted(glob.glob(str(ROOT / cache / "*.json"))):
        meta = json.loads(Path(j).read_text())
        z = np.load(j[:-5] + ".npz")
        f = z["feats"].astype(np.float32)
        songs.append(Song(meta["key"], f, beat_phase(meta, len(f)), z["onset"], meta))
    if stats is None:
        allf = np.concatenate([s.feats[::10] for s in songs])
        stats = (allf.mean(0), allf.std(0) + 1e-5)
    for s in songs:
        s.feats = (s.feats - stats[0]) / stats[1]
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


def split(songs: list[Song], seed: int = 0) -> tuple[list[Song], list[Song], list[Song]]:
    keys = sorted(s.key for s in songs)
    random.Random(seed).shuffle(keys)
    n = len(keys)
    test = set(keys[: n // 10])
    val = set(keys[n // 10: n // 10 + n // 20])
    return ([s for s in songs if s.key not in test | val], [s for s in songs if s.key in val],
            [s for s in songs if s.key in test])
