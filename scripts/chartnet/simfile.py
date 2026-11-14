"""Minimal .sm/.ssc parser: timing (offset, BPMs, stops) and dance-single charts as (beat, row) lists."""
from __future__ import annotations

import re
from bisect import bisect_right
from dataclasses import dataclass, field

DIFFS = ["Beginner", "Easy", "Medium", "Hard", "Challenge"]
_DIFF_ALIASES = {
    "beginner": "Beginner", "easy": "Easy", "basic": "Easy", "light": "Easy",
    "medium": "Medium", "another": "Medium", "trick": "Medium", "standard": "Medium",
    "hard": "Hard", "maniac": "Hard", "ssr": "Hard", "heavy": "Hard",
    "challenge": "Challenge", "smaniac": "Challenge", "expert": "Challenge", "oni": "Challenge",
}


def _pairs(s: str) -> list[tuple[float, float]]:
    out = []
    for part in s.split(","):
        part = part.strip()
        if "=" in part:
            a, b = part.split("=")[:2]
            try:
                out.append((float(a), float(b)))
            except ValueError:
                pass
    return sorted(out)


@dataclass
class Timing:
    offset: float
    bpms: list[tuple[float, float]]
    stops: list[tuple[float, float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Precompute segment start times.
        self._seg_beats = [b for b, _ in self.bpms]
        self._seg_times = []
        t = -self.offset
        for i, (b, bpm) in enumerate(self.bpms):
            if i > 0:
                pb, pbpm = self.bpms[i - 1]
                t += (b - pb) * 60.0 / pbpm
            self._seg_times.append(t)

    def beat_to_time(self, beat: float) -> float:
        i = max(0, bisect_right(self._seg_beats, beat) - 1)
        b0, bpm = self.bpms[i]
        t = self._seg_times[i] + (beat - b0) * 60.0 / bpm
        for sb, dur in self.stops:
            if sb < beat:
                t += dur
        return t

    def time_to_beat(self, t: float) -> float:
        # Ignores stops (fine for beat-phase features); exact enough for these packs.
        i = max(0, bisect_right(self._seg_times, t) - 1)
        b0, bpm = self.bpms[i]
        return b0 + (t - self._seg_times[i]) * bpm / 60.0


@dataclass
class Chart:
    difficulty: str
    meter: int
    rows: list[tuple[float, str]]  # (beat, "0100") for rows that contain anything


@dataclass
class Simfile:
    title: str
    music: str
    timing: Timing
    charts: list[Chart]
    tags: dict[str, str]


def _tags(text: str) -> list[tuple[str, str]]:
    text = re.sub(r"//[^\n]*", "", text)
    return [(m.group(1).upper(), m.group(2)) for m in re.finditer(r"#([A-Za-z0-9]+):([^;]*);?", text, re.S)]


def _parse_notes(data: str) -> list[tuple[float, str]]:
    rows: list[tuple[float, str]] = []
    measures = [m for m in data.strip().split(",")]
    for mi, m in enumerate(measures):
        lines = [ln.strip() for ln in m.strip().splitlines() if ln.strip()]
        lines = [ln for ln in lines if re.fullmatch(r"[0-9MLFKmlfk]{4}", ln)]
        n = len(lines)
        for ri, ln in enumerate(lines):
            if ln != "0000":
                rows.append((mi * 4 + 4.0 * ri / n, ln.upper()))
    return rows


def _norm_diff(d: str) -> str:
    return _DIFF_ALIASES.get(d.strip().lower(), d.strip().title())


def parse(text: str) -> Simfile:
    tags = _tags(text)
    head: dict[str, str] = {}
    charts: list[Chart] = []
    cur: dict[str, str] | None = None
    for k, v in tags:
        if k == "NOTEDATA":
            cur = {}
            continue
        if k == "NOTES" and cur is None:  # .sm style
            parts = v.split(":")
            if len(parts) >= 6 and parts[0].strip() == "dance-single":
                try:
                    meter = int(parts[3].strip())
                except ValueError:
                    meter = 0
                charts.append(Chart(_norm_diff(parts[2]), meter, _parse_notes(parts[5])))
            continue
        if cur is not None:
            cur[k] = v
            if k in ("NOTES", "NOTES2"):
                if cur.get("STEPSTYPE", "").strip() == "dance-single":
                    try:
                        meter = int(cur.get("METER", "0").strip())
                    except ValueError:
                        meter = 0
                    charts.append(Chart(_norm_diff(cur.get("DIFFICULTY", "")), meter, _parse_notes(v)))
                cur = None
            continue
        head.setdefault(k, v)
    bpms = _pairs(head.get("BPMS", "0=120")) or [(0.0, 120.0)]
    stops = _pairs(head.get("STOPS", "") or head.get("FREEZES", ""))
    try:
        offset = float(head.get("OFFSET", "0").strip() or 0)
    except ValueError:
        offset = 0.0
    return Simfile(head.get("TITLE", "").strip(), head.get("MUSIC", "").strip(), Timing(offset, bpms, stops), charts, head)
