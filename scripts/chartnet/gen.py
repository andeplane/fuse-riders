"""Generate charts with the learned models and compare them with human and rule-based charts.

  python gen.py eval   – held-out pack songs: step-placement F1 and pattern statistics (human vs learned vs rule-based)
  python gen.py fuse   – the 20 Fuse songs: write chartnet/<id>.ssc and pattern statistics vs the current rule charts
"""
from __future__ import annotations

import json
import math
import zlib
import sys
from fractions import Fraction
import os
from pathlib import Path

import numpy as np
import torch

from data import beat_phase, load, split
from features import FPS
from onset import OnsetNet, f1, peaks, predict
from simfile import DIFFS, Timing
from steps import StepNet, gap_class, phase_class

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
SP = ROOT  # rule-baseline.ts writes rulegen/out.json here
FUSE_DIFFS = ["Easy", "Medium", "Hard", "Challenge"]
TARGET_NPS = {"Easy": 1.5, "Medium": 2.3, "Hard": 3.2, "Challenge": 4.7}
MIN_GAP = {"Beginner": 0.4, "Easy": 0.3, "Medium": 0.16, "Hard": 0.095, "Challenge": 0.07}  # seconds, as the rule generator
SNAP = {"Beginner": [1], "Easy": [2], "Medium": [2], "Hard": [4, 3], "Challenge": [4, 3]}  # subdivisions per beat


def timing(meta) -> Timing:
    return Timing(meta["offset"], [tuple(x) for x in meta["bpms"]], [tuple(x) for x in meta.get("stops", [])])


def only_24th(b: float) -> bool:
    """A beat position on the 24th grid that is neither an 8th, a 12th nor a 16th: k + 1/6 or k + 5/6."""
    six = b * 6
    return abs(six - round(six)) < 1e-6 and round(six) % 6 in (1, 5)


def keep_24th_runs(beats: list[float], need: int = 5) -> list[float]:
    """24ths only as bursts: a 1/6 or 5/6 step stays when its beat carries at least `need` of its six 24ths."""
    have = set(round(b * 6) for b in beats if abs(b * 6 - round(b * 6)) < 1e-6)
    out = []
    for b in beats:
        if only_24th(b):
            k = math.floor(b + 1e-6)
            if sum((k * 6 + j) in have for j in range(6)) < need:
                continue
        out.append(b)
    return out


def place(prob: np.ndarray, tm: Timing, diff: str, thr: float, n_target: int | None = None, swing: bool = False,
          snap24: bool = False, forced: list[float] | None = None):
    """Peaks of the step probability → snapped beats (respecting the difficulty's grid and minimum gap).
    `snap24` lets steps land on the 24th grid too; isolated ones are dropped again (`keep_24th_runs`).
    `forced` beats (review notes, `guidance.py`) go in first; the model fills the chart around them."""
    cand = peaks(prob, thr if n_target is None else 0.0)
    cand = cand[np.argsort(-prob[cand])]
    chosen: dict[float, float] = {}
    times: list[float] = []
    for b in forced or []:
        t = tm.beat_to_time(b)
        if b >= 0 and not any(abs(t - u) < MIN_GAP[diff] for u in times):
            chosen[b] = 1.0
            times.append(t)
    for f in cand:
        b = tm.time_to_beat(f / FPS)
        subs = SNAP[diff] + ([3] if swing and diff in ("Medium", "Hard", "Challenge") else []) + ([6] if snap24 else [])
        best = min((round(b * s) / s for s in subs), key=lambda x: abs(x - b))
        if abs(best - b) > 0.2 or best in chosen or best < 0:
            continue
        t = tm.beat_to_time(best)
        if any(abs(t - u) < MIN_GAP[diff] for u in times):
            continue
        chosen[best] = prob[f]
        times.append(t)
        if n_target is not None and len(chosen) >= n_target:
            break
    return keep_24th_runs(sorted(chosen)) if snap24 else sorted(chosen)


@torch.no_grad()
def choose_steps(model: StepNet, beats, tm: Timing, feats, diff: str, temp=float(__import__("os").environ.get("TEMP_STEPS", "1.0")), seed=0):
    g = torch.Generator().manual_seed(seed)
    rows, h, prev = [], None, 16
    allowed = torch.tensor([bin(m).count("1") <= 2 for m in range(16)])
    allowed[0] = False
    di = torch.tensor([DIFFS.index(diff)])
    for i, b in enumerate(beats):
        pg = b - beats[i - 1] if i else 8.0
        ng = beats[i + 1] - b if i + 1 < len(beats) else 8.0
        cond = torch.tensor([[[gap_class(pg), gap_class(ng), phase_class(b)]]])
        fr = min(max(int(round(tm.beat_to_time(b) * FPS)), 0), len(feats) - 1)
        au = torch.tensor(feats[fr][None, None], dtype=torch.float32)
        logits, h = model(torch.tensor([[prev]]), cond, au, di, h)
        logits = logits[0, 0] / temp
        logits[~allowed] = -1e9
        tok = int(torch.multinomial(torch.softmax(logits, -1), 1, generator=g))
        rows.append((b, tm.beat_to_time(b), "".join("1" if tok >> c & 1 else "0" for c in range(4))))
        prev = tok
    return rows


# ---------------------------------------------------------------- pattern statistics
def stats(rows) -> dict:
    rows = [(b, t, r) for b, t, r in rows if any(c in "124" for c in r)]
    if len(rows) < 2:
        return {}
    cols = lambda r: [c for c in range(4) if r[c] in "124"]  # noqa: E731
    dur = rows[-1][1] - rows[0][1]
    jumps = sum(len(cols(r)) >= 2 for _, _, r in rows)
    jack = cross = candle = singles = 0
    foot = None  # 0 left, 1 right
    last_col = None
    toks = []
    run = best_run = 0
    for i, (b, t, r) in enumerate(rows):
        cs = cols(r)
        toks.append(r)
        gap = b - rows[i - 1][0] if i else 9
        run = run + 1 if gap <= 0.25 + 1e-6 else 1
        best_run = max(best_run, run)
        if len(cs) != 1:
            foot, last_col = None, None
            continue
        c = cs[0]
        singles += 1
        if gap > 1.0 + 1e-6:
            foot = None
        if last_col == c and gap <= 0.5 + 1e-6:
            jack += 1
        # foot assignment: L arrow → left foot, R → right foot, U/D → alternate
        nf = 0 if c == 0 else 1 if c == 3 else (1 - foot if foot is not None else (0 if last_col == 3 else 1))
        if foot is not None and nf == foot and c in (0, 3) and last_col != c and gap <= 0.5 + 1e-6:
            # the alternating foot would have to take this arrow: crossover (or a double-step)
            cross += 1
            nf = 1 - foot
        if last_col is not None and {last_col, c} == {1, 2} and gap <= 0.5 + 1e-6:
            candle += 1
        foot, last_col = nf, c
    col_use = np.array([sum(r[c] in "124" for _, _, r in rows) for c in range(4)], float)
    col_use /= col_use.sum()
    grams = [tuple(toks[i:i + 4]) for i in range(len(toks) - 3)]
    return {
        "nps": round(len(rows) / max(dur, 1), 2),
        "jump_share": round(jumps / len(rows), 3),
        "jack_share": round(jack / max(singles, 1), 3),
        "crossover_share": round(cross / max(singles, 1), 3),
        "candle_share": round(candle / max(singles, 1), 3),
        "column_entropy": round(float(-(col_use * np.log2(col_use + 1e-9)).sum()), 3),
        "distinct_4grams": round(len(set(grams)) / max(len(grams), 1), 3),
        "longest_16th_run": best_run,
    }


def mean_stats(lst):
    keys = sorted({k for s in lst for k in s})
    return {k: round(float(np.mean([s[k] for s in lst if k in s])), 3) for k in keys}


# ---------------------------------------------------------------- playability fix-ups
LEAD_IN = 1.0  # seconds before the first step


def playable(rows, tm):
    """Drop steps in the first second, and end a freeze before any row that would need a third arrow or its panel.
    A freeze left shorter than half a beat becomes a tap. `rows` are (beat, time, "0123"), tails included."""
    rows = [(b, t, r) for b, t, r in rows if t >= LEAD_IN or not any(c in "124" for c in r)]
    grid = {b: list(r) for b, _, r in rows}
    beats = sorted(grid)
    for b in beats:
        for c in range(4):
            if grid[b][c] != "2":
                continue
            tail = next((x for x in beats if x > b and grid[x][c] == "3"), None)
            if tail is None:
                grid[b][c] = "1"
                continue
            def held_elsewhere(x: float) -> int:  # other freezes still down at beat x
                n = 0
                for d in range(4):
                    if d == c:
                        continue
                    head = max((y for y in beats if y < x and grid[y][d] == "2"), default=None)
                    if head is None:
                        continue
                    end = next((y for y in beats if y > head and grid[y][d] == "3"), None)
                    if end is not None and end >= x:
                        n += 1
                return n

            stop = next((x for x in beats if b < x <= tail and (
                grid[x][c] in "124" or sum(ch in "124" for ch in grid[x]) + held_elsewhere(x) >= 2)), None)
            if stop is None:
                continue
            grid[tail][c] = "0"
            new_tail = math.floor((stop - 0.25) * 4 + 1e-6) / 4
            if new_tail - b < 0.5:
                grid[b][c] = "1"
            else:
                grid.setdefault(new_tail, ["0"] * 4)[c] = "3"
                if new_tail not in beats:
                    beats = sorted(grid)
    # orphan tails (a head dropped with the lead-in) go too
    open_cols: set[int] = set()
    for b in sorted(grid):
        for c in range(4):
            if grid[b][c] == "2":
                open_cols.add(c)
            elif grid[b][c] == "3":
                if c in open_cols:
                    open_cols.discard(c)
                else:
                    grid[b][c] = "0"
    return [(b, tm.beat_to_time(b), "".join(r)) for b, r in sorted(grid.items()) if "".join(r) != "0000"]


def fixup(paths):
    """Apply `playable` to the charts of finished .ssc files in place."""
    from simfile import parse
    for p in paths:
        text = Path(p).read_text()
        sim = parse(text)
        blocks = text.split("#NOTES:\n")
        out = [blocks[0]]
        for chart, block in zip(sim.charts, blocks[1:]):
            rest = block[block.index("\n;"):]
            rows = playable([(b, sim.timing.beat_to_time(b), r) for b, r in chart.rows], sim.timing)
            out.append(notes_text(rows) + rest)
        Path(p).write_text("#NOTES:\n".join(out))


# ---------------------------------------------------------------- ssc output
def measure_text(rows_in_measure: dict[Fraction, str]) -> str:
    for n in (4, 8, 12, 16, 24, 32, 48, 64, 192):
        if all((pos * n).denominator == 1 for pos in rows_in_measure):
            break
    lines = ["0000"] * n
    for pos, r in rows_in_measure.items():
        lines[int(pos * n)] = r
    return "\n".join(lines)


def notes_text(rows) -> str:
    measures: dict[int, dict[Fraction, str]] = {}
    for b, _, r in rows:
        fb = Fraction(b).limit_denominator(48)
        m = int(fb // 4)
        measures.setdefault(m, {})[(fb - 4 * m) / 4] = r
    last = max(measures) if measures else 0
    return "\n,\n".join(measure_text(measures.get(m, {})) for m in range(last + 1))


def ssc(head: str, charts) -> str:
    out = [head.rstrip() + "\n"]
    for diff, meter, rows in charts:
        out.append(f"\n#NOTEDATA:;\n#STEPSTYPE:dance-single;\n#DESCRIPTION:ChartNet;\n#DIFFICULTY:{diff};\n"
                   f"#METER:{meter};\n#CREDIT:ChartNet;\n#NOTES:\n{notes_text(rows)}\n;\n")
    return "".join(out)


# ---------------------------------------------------------------- main
def models():
    st = np.load(ROOT / "feat_stats.npz")
    om = OnsetNet(192, True).to("mps")
    om.load_state_dict(torch.load(ROOT / "onset_phase.pt"))
    sm = StepNet(192)
    sm.load_state_dict(torch.load(ROOT / "steps.pt"))
    sm.eval()
    thr = json.loads((ROOT / "onset_phase_results.json").read_text())["learned"]["thr"]
    return (st["mean"], st["std"]), om, sm, thr


def eval_packs():
    stats_, om, sm, thr = models()
    songs, _ = load("cache", stats_)
    _, _, te = split(songs)
    rule = json.loads((SP / "rulegen" / "out.json").read_text())
    hyb_path = SP / "rulegen" / "out_hybrid.json"
    hybrid = json.loads(hyb_path.read_text()) if hyb_path.exists() else {}
    res = {d: {"human": [], "learned": [], "learned_rulegrid": [], "rule": [], "hybrid": []} for d in DIFFS}
    f1s = {d: {k: [0, 0, 0] for k in ("learned", "learned_rulegrid", "rule", "hybrid")} for d in DIFFS}
    tol = 2
    for s in te:
        r = rule.get(s.key)
        for c in s.meta["charts"]:
            d = c["difficulty"]
            if d not in DIFFS:
                continue
            true = np.array([int(round(t * FPS)) for _, t, row in c["rows"] if any(x in "124" for x in row)])
            res[d]["human"].append(stats(c["rows"]))
            variants = [("learned", s.meta, s.phase)]
            if r:
                variants.append(("learned_rulegrid", r, beat_phase(r, len(s.feats))))
            for name, grid, phase in variants:
                s_phase, s.phase = s.phase, phase
                prob = predict(om, s, d)
                s.phase = s_phase
                tm = timing(grid)
                beats = place(prob, tm, d, thr)
                rows = choose_steps(sm, beats, tm, s.feats, d)
                res[d][name].append(stats(rows))
                a, b, cc = f1(np.array([int(round(t * FPS)) for _, t, _ in rows]), true, tol)
                f1s[d][name] = [x + y for x, y in zip(f1s[d][name], (a, b, cc))]
            for name, src in (("rule", r), ("hybrid", hybrid.get(s.key))):
                if not src:
                    continue
                rd = "Easy" if d == "Beginner" else d
                rc = next((x for x in src["charts"] if x["difficulty"] == rd), None)
                if rc:
                    res[d][name].append(stats(rc["rows"]))
                    pred = np.array([int(round(t * FPS)) for _, t, row in rc["rows"] if any(x in "124" for x in row)])
                    a, b, cc = f1(pred, true, tol)
                    f1s[d][name] = [x + y for x, y in zip(f1s[d][name], (a, b, cc))]
    out = {}
    for d in DIFFS:
        out[d] = {"stats": {k: mean_stats(v) for k, v in res[d].items() if v}, "f1": {}}
        for k, (tp, npred, ntrue) in f1s[d].items():
            if ntrue:
                p, rr = tp / max(npred, 1), tp / ntrue
                out[d]["f1"][k] = {"f1": round(2 * p * rr / max(p + rr, 1e-9), 3), "precision": round(p, 3), "recall": round(rr, 3)}
    (ROOT / "eval_results.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def fuse():
    stats_, om, sm, thr = models()
    songs, _ = load("cache_fuse", stats_)
    outdir = ROOT / "out_fuse"
    outdir.mkdir(exist_ok=True)
    meters = {"Easy": 3, "Medium": 6, "Hard": 9, "Challenge": 11}
    agg = {d: {"rule": [], "learned": []} for d in FUSE_DIFFS}
    for s in songs:
        tm = timing(s.meta)
        swing = any(abs((b * 3) - round(b * 3)) < 1e-3 and abs(b * 2 - round(b * 2)) > 1e-3
                    for c in s.meta["charts"] for b, _, _ in c["rows"])
        charts = []
        for d in FUSE_DIFFS:
            prob = predict(om, s, d)
            # Density from the packs' median notes per second for the difficulty (reference-patterns.json); the model
            # decides where the steps go. Its own calibrated threshold drifts on Fuse's (synthetic) music.
            n_target = int(TARGET_NPS[d] * 0.9 * len(s.feats) / FPS)
            beats = place(prob, tm, d, thr, n_target=n_target, swing=swing)
            rows = choose_steps(sm, beats, tm, s.feats, d, seed=zlib.crc32((s.key + d).encode()))
            charts.append((d, meters[d], rows))
            agg[d]["learned"].append(stats(rows))
            rc = next((x for x in s.meta["charts"] if x["difficulty"] == d), None)
            if rc:
                agg[d]["rule"].append(stats(rc["rows"]))
        (outdir / f"{s.key}.ssc").write_text(ssc(s.meta["ssc_head"], charts))
        print(s.key, [(d, len(r)) for d, _, r in charts], flush=True)
    out = {d: {k: mean_stats(v) for k, v in agg[d].items()} for d in FUSE_DIFFS}
    (ROOT / "fuse_results.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def placement():
    """Learned rhythm only, as beats per difficulty, for scripts/chartnet/hybrid.ts (the rule generator's arrows)."""
    stats_, om, _, thr = models()
    songs, _ = load("cache_fuse", stats_)
    out = {}
    for s in songs:
        tm = timing(s.meta)
        swing = any(abs((b * 3) - round(b * 3)) < 1e-3 and abs(b * 2 - round(b * 2)) > 1e-3
                    for c in s.meta["charts"] for b, _, _ in c["rows"])
        out[s.key] = {}
        for d in FUSE_DIFFS:
            prob = predict(om, s, d)
            n_target = int(TARGET_NPS[d] * 0.9 * len(s.feats) / FPS)
            out[s.key][d] = [round(b, 4) for b in place(prob, tm, d, thr, n_target=n_target, swing=swing)]
        print(s.key, {d: len(v) for d, v in out[s.key].items()}, flush=True)
    Path(sys.argv[2]).write_text(json.dumps(out, sort_keys=True) + "\n")


def placement_eval():
    """Learned rhythm for the held-out pack songs on the rule generator's own beat grid (rulegen/out.json)."""
    stats_, om, _, thr = models()
    songs, _ = load("cache", stats_)
    _, _, te = split(songs)
    rule = json.loads((SP / "rulegen" / "out.json").read_text())
    out = {}
    for s in te:
        r = rule.get(s.key)
        if not r:
            continue
        s.phase = beat_phase(r, len(s.feats))
        out[s.key] = {d: [round(b, 4) for b in place(predict(om, s, d), timing(r), d, thr)] for d in FUSE_DIFFS}
    (SP / "rulegen" / "placement.json").write_text(json.dumps(out))


if __name__ == "__main__":
    if sys.argv[1] == "fixup":
        fixup(sys.argv[2:])
    else:
        {"eval": eval_packs, "fuse": fuse, "placement": placement, "placement-eval": placement_eval}[sys.argv[1]]()
