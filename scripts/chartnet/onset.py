"""Step-placement model (where do steps go?) in the spirit of Dance Dance Convolution, trained on MPS.

Input per frame: 3x64 log-mel, optional beat-phase (6), difficulty one-hot (5). Conv front end over time, BiGRU, per-frame logit.
"""
from __future__ import annotations

import argparse
import json
import random
import time
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from data import DIFFS, diff_index, load, split, targets
from features import FPS

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
DEV = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")


class Res(nn.Module):
    def __init__(self, h: int, dil: int):
        super().__init__()
        self.c = nn.Sequential(nn.Conv1d(h, h, 3, padding=dil, dilation=dil), nn.GELU(), nn.BatchNorm1d(h),
                               nn.Conv1d(h, h, 1), nn.Dropout(0.1))

    def forward(self, x):
        return x + self.c(x)


class OnsetNet(nn.Module):
    """Conv front end over (time) on log-mel, then a dilated residual stack (~+-1.3 s context)."""

    def __init__(self, n_in: int, use_phase: bool, h: int = 160, use_density: bool = False, wide: bool = False):
        super().__init__()
        self.use_phase = use_phase
        self.use_density = use_density
        extra = (6 if use_phase else 0) + len(DIFFS) + (1 if use_density else 0)
        self.front = nn.Sequential(nn.Conv1d(n_in, h, 7, padding=3), nn.GELU(), nn.BatchNorm1d(h))
        self.mix = nn.Conv1d(h + extra, h, 1)
        # `wide` looks about +-5 s around each moment instead of +-1.3 s: enough to hear which phrase a step is in
        dils = (1, 2, 4, 8, 16, 32, 64, 128, 256, 1, 2, 4, 8) if wide else (1, 2, 4, 8, 16, 32, 64, 1, 2, 4)
        self.body = nn.Sequential(*[Res(h, d) for d in dils])
        self.head = nn.Conv1d(h, 1, 1)

    def forward(self, x: torch.Tensor, phase: torch.Tensor, diff: torch.Tensor,
                density: torch.Tensor | None = None) -> torch.Tensor:
        z = self.front(x.transpose(1, 2))
        d = torch.nn.functional.one_hot(diff, len(DIFFS)).float()[:, :, None].expand(-1, -1, z.shape[2])
        parts = [z, d] + ([phase.transpose(1, 2)] if self.use_phase else [])
        if self.use_density:  # the chart's steps per second, log-scaled: asks for a sparser or busier chart
            assert density is not None
            parts.append(torch.log(density)[:, None, None].expand(-1, 1, z.shape[2]))
        return self.head(self.body(self.mix(torch.cat(parts, 1)))).squeeze(1)


def examples(songs):
    return [(s, c) for s in songs for c in s.meta["charts"]]


_STEP_FRAMES: dict[int, tuple[np.ndarray, float]] = {}


def step_frames(c) -> tuple[np.ndarray, float]:
    """A chart's step frames and density, computed once (training samples each chart many times)."""
    hit = _STEP_FRAMES.get(id(c))
    if hit is None:
        fr = np.array(sorted({int(round(t * FPS)) for _, t, r in c["rows"] if any(x in "124" for x in r)}), dtype=np.int64)
        hit = _STEP_FRAMES[id(c)] = (fr, chart_nps(c))
    return hit


def chart_nps(c) -> float:
    ts = [t for _, t, r in c["rows"] if any(x in "124" for x in r)]
    return len(ts) / max(ts[-1] - ts[0], 1.0) if len(ts) > 1 else 1.0


def batch(exs, L: int):
    xs, ps, ds, ys, ns = [], [], [], [], []
    for s, c in exs:
        n = len(s.feats)
        st = random.randint(0, max(0, n - L))
        fr, nps = step_frames(c)
        y = np.zeros(L, np.float32)
        y[fr[(fr >= st) & (fr < min(st + L, n))] - st] = 1.0
        pad = L - len(s.feats[st:st + L])
        f = np.pad(s.feats[st:st + L], ((0, pad), (0, 0)))
        xs.append(f)
        ps.append(np.pad(s.phase[st:st + L], ((0, pad), (0, 0))))
        ys.append(y)
        ds.append(diff_index(c["difficulty"]))
        ns.append(nps)
    t = lambda a: torch.tensor(np.stack(a).astype(np.float32)).to(DEV)  # noqa: E731
    return t(xs), t(ps), torch.tensor(ds).to(DEV), t(ys), torch.tensor(ns, dtype=torch.float32).to(DEV)


@torch.no_grad()
def predict(model: OnsetNet, song, difficulty: str, nps: float | None = None) -> np.ndarray:
    model.eval()
    x = torch.tensor(song.feats.astype(np.float32))[None].to(DEV)
    p = torch.tensor(song.phase)[None].to(DEV)
    d = torch.tensor([diff_index(difficulty)]).to(DEV)
    n = torch.tensor([nps or 3.0], dtype=torch.float32).to(DEV)
    return torch.sigmoid(model(x, p, d, n))[0].cpu().numpy()


def peaks(prob: np.ndarray, thr: float) -> np.ndarray:
    l = np.r_[-1, prob[:-1]]
    r = np.r_[prob[1:], -1]
    return np.where((prob >= thr) & (prob > l) & (prob >= r))[0]


def f1(pred: np.ndarray, true: np.ndarray, tol: int = 2) -> tuple[int, int, int]:
    """Greedy one-to-one matching within +-tol frames. Returns (tp, n_pred, n_true)."""
    true = np.sort(true)
    used = np.zeros(len(true), bool)
    tp = 0
    for p in np.sort(pred):
        i = np.searchsorted(true, p - tol)
        while i < len(true) and true[i] <= p + tol:
            if not used[i]:
                used[i] = True
                tp += 1
                break
            i += 1
    return tp, len(pred), len(true)


def score(curves, thr):
    tp = npred = ntrue = 0
    for prob, true in curves:
        a, b, c = f1(peaks(prob, thr), true)
        tp, npred, ntrue = tp + a, npred + b, ntrue + c
    p, r = tp / max(npred, 1), tp / max(ntrue, 1)
    return 2 * p * r / max(p + r, 1e-9), p, r


def score_topn(curves):
    """F1 when the generator is told how many steps to place (as a chart generator is, via target density)."""
    tp = n = 0
    for prob, true in curves:
        cand = peaks(prob, 0.0)
        pick = cand[np.argsort(-prob[cand])[: len(true)]]
        a, b, c = f1(pick, true)
        tp, n = tp + a, n + c
    return tp / max(n, 1)


def grid_mask(song, sub: int = 2) -> np.ndarray:
    """1 at frames nearest each 1/sub beat of the song's beat grid."""
    from simfile import Timing
    from features import FPS
    m = song.meta
    tm = Timing(m["offset"], [tuple(x) for x in m["bpms"]], [tuple(x) for x in m["stops"]])
    n = len(song.feats)
    end = tm.time_to_beat(n / FPS)
    mask = np.zeros(n, np.float32)
    for k in range(int(end * sub) + 1):
        i = int(round(tm.beat_to_time(k / sub) * FPS))
        if 0 <= i < n:
            mask[i] = 1
    return mask


def best_threshold(curves, grid=np.r_[np.linspace(0.005, 0.1, 20), np.linspace(0.12, 0.9, 40)]):
    return max(((score(curves, t)[0], t) for t in grid))[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", type=int, default=1)
    ap.add_argument("--steps", type=int, default=4000)
    ap.add_argument("--name", default="onset")
    ap.add_argument("--density", type=int, default=0)
    ap.add_argument("--wide", type=int, default=0)
    ap.add_argument("--len", type=int, default=800)
    a = ap.parse_args()
    songs, stats = load("cache")
    np.savez(ROOT / f"feat_stats_{songs[0].feats.shape[1]}.npz", mean=stats[0], std=stats[1])
    (ROOT / f"{a.name}.json").write_text(json.dumps({"n_in": int(songs[0].feats.shape[1]), "wide": bool(a.wide)}))
    tr, va, te = split(songs)
    print(len(tr), len(va), len(te), "songs", DEV, flush=True)
    model = OnsetNet(songs[0].feats.shape[1], bool(a.phase), use_density=bool(a.density), wide=bool(a.wide)).to(DEV)
    opt = torch.optim.AdamW(model.parameters(), 1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 2e-3, total_steps=a.steps)
    lossf = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(4.0, device=DEV))
    trex = examples(tr)
    t0 = time.time()
    for step in range(a.steps):
        model.train()
        x, p, d, y, n = batch(random.sample(trex, 32), a.len)
        loss = lossf(model(x, p, d, n), y)
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 500 == 0 or step == a.steps - 1:
            print(f"step {step} loss {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
    torch.save(model.state_dict(), ROOT / f"{a.name}.pt")

    def curves(ss, fn):
        return [(fn(s, c), np.where(targets(c, len(s.feats)) > 0)[0]) for s in ss for c in s.meta["charts"]]

    res = {}
    learned = lambda s, c: predict(model, s, c["difficulty"], chart_nps(c))  # noqa: E731
    def flux(s, c):
        o = np.r_[s.onset[3:], np.zeros(3)]  # flux peaks ~30 ms after the charted onset; correct the lag
        return o / (o.max() + 1e-9)

    def flux_grid(s, c):  # rule-style baseline: strongest flux on the song's 8th-note grid
        o = flux(s, c)
        sm = np.maximum.reduce([np.r_[o[1:], 0], o, np.r_[0, o[:-1]]])
        return sm * grid_mask(s, 2) + 1e-6 * grid_mask(s, 2)

    for name, fn in (("learned", learned), ("flux", flux), ("flux_grid", flux_grid)):
        thr = best_threshold(curves(va, fn))
        res[name] = {"thr": thr}
        # overall and per difficulty on test songs; flux uses a per-difficulty tuned threshold too (fairer)
        for diff in [None] + DIFFS:
            sel = lambda c: diff is None or c["difficulty"] == diff  # noqa: E731
            cv = [(fn(s, c), np.where(targets(c, len(s.feats)) > 0)[0]) for s in te for c in s.meta["charts"] if sel(c)]
            if not cv:
                continue
            t = thr
            if diff is not None:
                vcv = [(fn(s, c), np.where(targets(c, len(s.feats)) > 0)[0]) for s in va for c in s.meta["charts"] if sel(c)]
                t = best_threshold(vcv) if vcv else thr
            f, p, r = score(cv, t)
            res[name][diff or "all"] = {"f1": round(f, 3), "precision": round(p, 3), "recall": round(r, 3),
                                        "f1_at_true_count": round(score_topn(cv), 3), "charts": len(cv)}
        print(name, json.dumps(res[name]), flush=True)
    (ROOT / f"{a.name}_results.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
