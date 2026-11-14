"""ChartNet v2: density-conditioned placement + learned arrows with foot-flow limits.

  python gen2.py eval [Hard,Challenge]  – held-out pack songs: human vs v2 vs hybrid vs rule-based
  python gen2.py fuse                   – the 20 Fuse songs → $CHARTNET_WORK/out_fuse2/<id>.ssc
"""
from __future__ import annotations

import json
import os
import sys
import zlib
from pathlib import Path

import numpy as np
import torch

from arrows import ArrowNet, generate
import data
from data import load, split
from features import FPS
from bursts import burst_beats
from guidance import forced_beats
from feet import Feet
from gen import FUSE_DIFFS, mean_stats, place, ssc, stats, timing
from onset import OnsetNet, chart_nps, f1, predict
from simfile import DIFFS

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
# What the Fuse charts aim at, in steps per second: about the packs' 75th–90th percentile, busier than the medians.
FUSE_NPS = {"Easy": 1.8, "Medium": 2.8, "Hard": 4.3, "Challenge": 7.0}
# Placement: peaks above the density model's validation threshold (it is told the density it should reach), or with
# PLACE_THR=0 the strongest peaks up to the target count.
THR = float(os.environ.get("PLACE_THR", "0"))
_COVERS_FILE = Path(__file__).resolve().parents[2] / "games/fusemania/charts/covers-challenge.json"
COVERS = {k: v for k, v in json.loads(_COVERS_FILE.read_text()).items() if k != "about"} if _COVERS_FILE.exists() else {}
METERS = {"Easy": 3, "Medium": 6, "Hard": 9, "Challenge": 13}
# 24th bursts on Challenge: "learned" lets the placement model put steps on the 24th grid (kept only as runs),
# "rule" is the onset test in bursts.py, "both" and "off" as they say.
BURSTS = os.environ.get("CHARTNET_BURSTS", "both")
WEIGHTS = (os.environ.get("CHARTNET_ONSET", "onset_v3"), os.environ.get("CHARTNET_ARROWS", "arrows_v3"))


def window_variety(toks: list[str], win: int = 64) -> float:
    """Share of distinct four-row patterns inside each window of `win` rows, averaged. Unlike the whole-chart share
    it does not fall just because a chart has more rows."""
    if len(toks) < 8:
        return 1.0
    vals = []
    for st in range(0, max(len(toks) - win, 0) + 1, win // 2):
        w = toks[st:st + win]
        grams = [tuple(w[i:i + 4]) for i in range(len(w) - 3)]
        vals.append(len(set(grams)) / max(len(grams), 1))
    return float(np.mean(vals))


def crossovers_best_parity(rows) -> float:
    """Crossover share of single steps when the player picks the better starting foot for every run of steps
    (a run ends at a jump or a pause over one beat). Within a run the feet alternate; a jack keeps the foot."""
    runs: list[list[tuple[float, int]]] = []
    cur: list[tuple[float, int]] = []
    last_b = -99.0
    singles = 0
    for b, _, r in rows:
        cols = [c for c in range(4) if r[c] in "124"]
        if not cols:
            continue
        if len(cols) != 1 or b - last_b > 1.0 + 1e-6:
            if cur:
                runs.append(cur)
            cur = []
        if len(cols) == 1:
            cur.append((b, cols[0]))
            singles += 1
        last_b = b
    if cur:
        runs.append(cur)
    total = 0
    for run in runs:
        best = None
        for start in (0, 1):
            foot, prev, n = start, None, 0
            for b, c in run:
                if prev is not None and prev != c:
                    foot = 1 - foot
                if (c == 0 and foot == 1) or (c == 3 and foot == 0):
                    n += 1
                prev = c
            best = n if best is None else min(best, n)
        total += best or 0
    return round(total / max(singles, 1), 3)


def stats2(rows) -> dict:
    s = stats(rows)
    steps = [r for _, _, r in rows if any(c in "124" for c in r)]
    if not steps:
        return s
    s["hold_share"] = round(sum(any(c in "24" for c in r) for r in steps) / len(steps), 3)
    s["hand_share"] = round(sum(sum(c in "124" for c in r) >= 3 for r in steps) / len(steps), 3)
    beats = [b for b, _, r in rows if any(c in "124" for c in r)]
    feet, ev_sum, singles = Feet(), {"crossover": 0.0, "jack": 0.0, "candle": 0.0}, 0
    for b, _, r in rows:
        cols = [c for c in range(4) if r[c] in "124"]
        if not cols:
            continue
        singles += len(cols) == 1
        ev = feet.apply(cols, {}, b)
        for k in ev_sum:
            ev_sum[k] += ev[k]
    for k, v in ev_sum.items():
        s[f"feet_{k}"] = round(v / max(singles, 1), 3)
    s["crossover_best_parity"] = crossovers_best_parity(rows)
    s["stream16_share"] = round(sum(1 for a, b in zip(beats, beats[1:]) if b - a <= 0.25 + 1e-6) / max(len(beats) - 1, 1), 3)
    s["stream24_share"] = round(sum(1 for a, b in zip(beats, beats[1:]) if b - a <= 1 / 6 + 1e-6) / max(len(beats) - 1, 1), 4)
    s["variety_w64"] = round(window_variety([r for _, _, r in rows if any(c in "124" for c in r)]), 3)
    times = np.array([t for _, t, r in rows if any(c in "124" for c in r)])
    s["peak_nps_2s"] = round(max(int(np.searchsorted(times, t + 2.0) - i) for i, t in enumerate(times)) / 2, 2)
    return s


def with_bursts(beats: list[float], burst: list[int]) -> tuple[list[float], int]:
    """Each burst beat k becomes six 24ths (k, k + 1/6, ...); whatever was placed inside it gives way."""
    if not burst:
        return beats, 0
    keep = [b for b in beats if not any(k <= b < k + 1 for k in burst)]
    added = [k + j / 6 for k in burst for j in range(6)]
    return sorted(set(keep) | set(added)), len(burst)


def placement_model():
    cfg_path = ROOT / f"{WEIGHTS[0]}.json"
    cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {"n_in": 192, "wide": False}
    data.BANDS = cfg["n_in"] > 192  # the features the weights were trained on
    st = np.load(ROOT / cfg.get("stats", "feat_stats.npz"))  # the normalisation the weights were trained with
    om = OnsetNet(cfg["n_in"], True, use_density=True, wide=cfg["wide"]).to("mps")
    om.load_state_dict(torch.load(ROOT / f"{WEIGHTS[0]}.pt", map_location="cpu"))
    return (st["mean"], st["std"]), om, cfg


def place_eval(keys_file="test_keys.json"):
    """Step-timing F1 of the placement model alone on held-out songs, told each human chart's density and count."""
    stats_, om, _ = placement_model()
    te, _ = load("cache", stats_, only=set(json.loads((ROOT / keys_file).read_text())))
    tot: dict = {}
    streams: dict = {}
    for s in te:
        tm = timing(s.meta)
        for c in s.meta["charts"]:
            d = c["difficulty"]
            true = np.array([int(round(t * FPS)) for _, t, r in c["rows"] if any(x in "124" for x in r)])
            beats = place(predict(om, s, d, chart_nps(c)), tm, d, 0.0, n_target=len(true),
                          snap24=d == "Challenge" and BURSTS in ("learned", "both"))
            got = f1(np.array([int(round(tm.beat_to_time(b) * FPS)) for b in beats]), true)
            for name, bs in (("gen", beats), ("human", sorted(b for b, _, r in c["rows"] if any(x in "124" for x in r)))):
                run = best = 1
                for x, y in zip(bs, bs[1:]):
                    run = run + 1 if y - x <= 0.25 + 1e-6 else 1
                    best = max(best, run)
                st = streams.setdefault((d, name), [0, 0, 0, 0])
                st[0] += sum(1 for x, y in zip(bs, bs[1:]) if y - x <= 0.25 + 1e-6)
                st[1] += max(len(bs) - 1, 1)
                st[2] += best
                st[3] += 1
            for k in (d, "all"):
                t = tot.setdefault(k, [0, 0, 0])
                t[:] = [x + y for x, y in zip(t, got)]
    out = {}
    for k, (tp, npred, ntrue) in tot.items():
        p, r = tp / max(npred, 1), tp / max(ntrue, 1)
        out[k] = round(2 * p * r / max(p + r, 1e-9), 3)
    print(WEIGHTS[0], keys_file, " ".join(f"{k}={out[k]}" for k in ["all"] + [d for d in DIFFS if d in out]))
    for d in ("Hard", "Challenge"):
        print("  ", d, " ".join(f"{n}: 16th-stream share {streams[d, n][0] / streams[d, n][1]:.3f}, longest run "
                                f"{streams[d, n][2] / streams[d, n][3]:.1f};" for n in ("gen", "human") if (d, n) in streams))
    return out


def models():
    stats_, om, cfg = placement_model()
    sd = torch.load(ROOT / f"{WEIGHTS[1]}.pt", map_location="cpu")
    n_audio = sd["au.0.weight"].shape[1]
    am = ArrowNet(n_audio, sd["tok.weight"].shape[1],
                  len({k.split(".")[2] for k in sd if k.startswith("tr.layers.")})).to("mps")
    am.load_state_dict(sd)
    if n_audio != cfg["n_in"]:  # arrows with the band channels, placement without: load them, placement skips them
        assert n_audio > cfg["n_in"], "the arrow model needs the placement model's features"
        data.BANDS = True
        st = np.load(ROOT / os.environ.get("CHARTNET_ARROW_STATS", "feat_stats_v3_208.npz"))
        stats_ = (st["mean"], st["std"])
    return stats_, om, am


def eval_packs(only=None, keys_file="test_keys.json", out_name="eval2_results.json"):
    stats_, om, am = models()
    te, _ = load("cache", stats_, only=set(json.loads((ROOT / keys_file).read_text())))
    rd = ROOT / "rulegen"
    rule = json.loads((rd / "out.json").read_text())
    hyb = json.loads((rd / "out_hybrid.json").read_text())
    res: dict = {}
    f1s: dict = {}
    for s in te:
        tm = timing(s.meta)
        for c in s.meta["charts"]:
            d = c["difficulty"]
            if only and d not in only:
                continue
            true_rows = [(b, t, r) for b, t, r in c["rows"]]
            nps = chart_nps(c)
            true = np.array([int(round(t * FPS)) for _, t, r in true_rows if any(x in "124" for x in r)])
            prob = predict(om, s, d, nps)
            beats = place(prob, tm, d, THR, n_target=None if THR > 0 else len(true),
                          snap24=d == "Challenge" and BURSTS in ("learned", "both"))
            rows = generate(am, s, beats, tm, d, nps, seed=zlib.crc32((s.key + d).encode()))
            r = res.setdefault(d, {"human": [], "v2": [], "hybrid": [], "rule": []})
            r["human"].append(stats2(true_rows))
            r["v2"].append(stats2(rows))
            a, b_, cc = f1(np.array([int(round(t * FPS)) for _, t, row in rows if any(x in "124" for x in row)]), true)
            f = f1s.setdefault(d, {}).setdefault("v2", [0, 0, 0])
            f[:] = [x + y for x, y in zip(f, (a, b_, cc))]
            for name, src in (("rule", rule.get(s.key)), ("hybrid", hyb.get(s.key))):
                if not src:
                    continue
                rc = next((x for x in src["charts"] if x["difficulty"] == ("Easy" if d == "Beginner" else d)), None)
                if rc:
                    r[name].append(stats2([(b, t, row) for b, t, row in rc["rows"]]))
    out = {}
    for d in DIFFS:
        if d not in res:
            continue
        out[d] = {"stats": {k: mean_stats(v) for k, v in res[d].items() if v}}
        tp, npred, ntrue = f1s[d]["v2"]
        p, rr = tp / max(npred, 1), tp / max(ntrue, 1)
        out[d]["v2_f1_at_human_density"] = round(2 * p * rr / max(p + rr, 1e-9), 3)
    (ROOT / out_name).write_text(json.dumps(out, indent=1))
    for d, v in out.items():
        print(d, "F1", v["v2_f1_at_human_density"])
        for k, st in v["stats"].items():
            print("   ", k.ljust(7), " ".join(f"{a[:7]}={b}" for a, b in st.items()))


def fuse():
    stats_, om, am = models()
    only = set(os.environ["CHARTNET_SONGS"].split(",")) if os.environ.get("CHARTNET_SONGS") else None
    songs, _ = load("cache_fuse", stats_, only=only)
    outdir = ROOT / os.environ.get("CHARTNET_OUT", "out_fuse2")
    outdir.mkdir(exist_ok=True)
    agg: dict = {}
    bursts_: dict = {}
    guided: dict = {}
    placement = {}
    only = set(sys.argv[2:])  # song ids, or every song
    for s in songs:
        if only and s.key not in only:
            continue
        tm = timing(s.meta)
        swing = any(abs((b * 3) - round(b * 3)) < 1e-3 and abs(b * 2 - round(b * 2)) > 1e-3
                    for c in s.meta["charts"] for b, _, _ in c["rows"])
        charts = []
        placement[s.key] = {}
        raw = np.load(ROOT / "cache_fuse" / f"{s.key}.npz")["feats"]  # unnormalised log-mel, for the review notes
        # A cover's Challenge aims at its original's hardest chart (charts/covers-challenge.json); the easier
        # charts stay below it.
        target = dict(FUSE_NPS)
        meters = dict(METERS)
        if s.key in COVERS:
            top = COVERS[s.key]["nps"]
            target["Challenge"] = top
            target["Hard"] = max(min(target["Hard"], 0.8 * top), 3.3)  # never thinner than a Hard may be
            target["Medium"] = min(target["Medium"], 0.6 * top)
            target["Easy"] = min(target["Easy"], 0.4 * top)
            meters["Challenge"] = min(15, max(11, COVERS[s.key]["meter"]))  # the game's Challenge runs 11 to 15
        for d in FUSE_DIFFS:
            prob = predict(om, s, d, target[d])
            n_target = None if THR > 0 else int(target[d] * 0.9 * len(s.feats) / FPS)
            # review notes from the chart lab: Medium follows the marked band on 8ths, Hard and Challenge on 16ths
            forced = [] if d == "Easy" else forced_beats(s.key, raw, tm, [2] if d == "Medium" else [4])
            guided[s.key] = max(guided.get(s.key, 0), len(forced))
            beats = place(prob, tm, d, THR, n_target=n_target, swing=swing,
                          snap24=d == "Challenge" and BURSTS in ("learned", "both"), forced=forced)
            if d == "Challenge" and BURSTS in ("rule", "both"):  # where the music itself moves at 24th speed
                beats, n_burst = with_bursts(beats, burst_beats(s.onset, tm, beats[0], beats[-1]))
                bursts_[s.key] = n_burst
            if d == "Challenge" and BURSTS == "learned":
                bursts_[s.key] = len({int(b) for b in beats if abs(b * 6 - round(b * 6)) < 1e-6 and round(b * 6) % 6 in (1, 5)})
            rows = generate(am, s, beats, tm, d, target[d], seed=zlib.crc32((s.key + d).encode()))
            charts.append((d, meters[d], rows))
            agg.setdefault(d, []).append(stats2(rows))
        (outdir / f"{s.key}.ssc").write_text(ssc(s.meta["ssc_head"], charts))
        print(s.key, [(d, len(r)) for d, _, r in charts], flush=True)
    summary = {d: mean_stats(v) for d, v in agg.items()}
    print("24th bursts (beats) per song:", bursts_)
    print("steps placed from review notes:", {k: v for k, v in guided.items() if v})
    (ROOT / "fuse2_results.json").write_text(json.dumps(summary, indent=1))
    for d, st in summary.items():
        print(d.ljust(9), " ".join(f"{a[:7]}={b}" for a, b in st.items()))


if __name__ == "__main__":
    if sys.argv[1] == "eval":
        eval_packs(sys.argv[2].split(",") if len(sys.argv) > 2 else None)
    elif sys.argv[1] == "place-eval":
        place_eval(sys.argv[2] if len(sys.argv) > 2 else "test_keys.json")
    elif sys.argv[1] == "eval2":  # the held-out community songs (stream and stamina packs)
        eval_packs(sys.argv[2].split(",") if len(sys.argv) > 2 else None, "test2_keys.json", "eval2_community.json")
    else:
        fuse()
