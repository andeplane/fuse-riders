"""Where a song moves at 24th speed: beats whose six 1/6-beat positions all carry an onset, and whose 16th
off-beats are no stronger than the 24th ones (so it is not a straight 16th passage)."""
from __future__ import annotations

import numpy as np

from features import FPS

LAG = 3  # spectral flux peaks ~30 ms after the onset


def _local_norm(o: np.ndarray, win: int = 400) -> np.ndarray:
    pad = np.pad(o, win // 2, mode="edge")
    med = np.array([np.median(pad[i:i + win]) for i in range(0, len(o), 25)])
    med = np.repeat(med, 25)[: len(o)]
    return o / (med + 1e-6)


def burst_beats(onset: np.ndarray, tm, first: float, last: float, strength: float = 2.0) -> list[int]:
    o = _local_norm(onset)
    n = len(o)

    def at(beat: float) -> float:
        f = int(round(tm.beat_to_time(beat) * FPS)) + LAG
        return float(o[max(f - 1, 0):min(f + 2, n)].max()) if 0 <= f < n else 0.0

    out = []
    for k in range(int(np.ceil(first)), int(last)):
        six = [at(k + j / 6) for j in range(6)]
        sixteenth_off = [at(k + 0.25), at(k + 0.75)]
        between = [six[1], six[2], six[4], six[5]]  # the 24th positions that are not 8ths
        if min(six) >= strength and np.mean(between) >= 1.2 * np.mean(sixteenth_off):
            out.append(k)
    return out
