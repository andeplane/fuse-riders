"""Review notes from the chart lab as guidance: where Anders marks a time span and a frequency band ("this piano
solo should be a stream run"), the steps there follow that band's onsets.

The lab saves `notes.json` (see `games/fusemania/src/lab/notes.ts`): per note a song id, a time span in seconds and
beats, and a frequency band in Hz. `forced_beats` turns each note into the grid positions inside the span where that
band has an onset; `gen.place` puts those first and fills the rest of the chart around them.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import librosa
import numpy as np

from features import FPS, N_MELS

NOTES = Path(os.environ.get("CHARTNET_NOTES",
                            Path.home() / "projects/personal/fuse-riders/artifacts/chart-lab-notes/notes.json"))
LAG = 3  # the rise in a mel band peaks ~30 ms after the onset
MEL_HZ = librosa.mel_frequencies(n_mels=N_MELS + 2, fmin=27.5, fmax=11000)[1:-1]


def notes_for(song: str) -> list[dict]:
    if not NOTES.exists():
        return []
    notes = json.loads(NOTES.read_text()).get("notes", [])
    return [n for n in notes if n.get("song") == song and n.get("lowHz") is not None and n.get("highHz") is not None]


def band_flux(logmel: np.ndarray, low_hz: float, high_hz: float) -> np.ndarray:
    """Onset strength of one frequency band: the summed frame-to-frame rise of its mel bins (short window)."""
    bins = np.where((MEL_HZ >= low_hz) & (MEL_HZ <= high_hz))[0]
    if len(bins) == 0:
        bins = np.array([int(np.argmin(np.abs(MEL_HZ - (low_hz + high_hz) / 2)))])
    m = logmel[:, bins].astype(np.float32)
    return np.r_[0.0, np.maximum(m[1:] - m[:-1], 0).sum(1)]


def forced_beats(song: str, logmel: np.ndarray, tm, subdivisions: list[int], strength: float = 0.3) -> list[float]:
    """Grid positions (1/sub beats) inside each note's span where the note's band has an onset at least
    `strength` times the span's strongest."""
    out: set[float] = set()
    n = len(logmel)
    for note in notes_for(song):
        flux = band_flux(logmel, note["lowHz"], note["highHz"])
        b0, b1 = tm.time_to_beat(note["start"]), tm.time_to_beat(note["end"])
        cands: dict[float, float] = {}
        for sub in subdivisions:
            for k in range(int(np.ceil(b0 * sub - 1e-6)), int(np.floor(b1 * sub + 1e-6)) + 1):
                f = int(round(tm.beat_to_time(k / sub) * FPS)) + LAG
                if 0 <= f < n:
                    cands[k / sub] = float(flux[max(f - 1, 0):f + 2].max())
        if not cands:
            continue
        top = max(cands.values())
        out |= {b for b, v in cands.items() if v >= strength * top and top > 0}
    return sorted(out)
