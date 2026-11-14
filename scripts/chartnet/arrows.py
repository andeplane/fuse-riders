"""ChartNet v2 arrows: which arrows (and freezes) each placed row gets, fully learned.

A causal transformer over the last 64 rows. Per row it sees the previous row's arrows, the gaps to the previous and
next row, the beat phase, the difficulty, the chart's density, the audio at that moment and where the feet are
(`feet.py`). Tokens are the 80 non-empty ways to put taps (1) and freeze heads (2) on four panels.

Generation samples from the model with a foot-flow penalty: crossovers, jacks, double steps, candles and hands cost
log-probability, scaled per difficulty, and a freeze's panel cannot be hit while it is held.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from data import DIFFS, diff_index, load, split
from features import FPS
from feet import N_FEAT, Feet
from steps import gap_class, phase_class, GAPS

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
DEV = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
WIN = 64
N_TOK = 81
START = 0  # token 0 (no arrows) doubles as "start of chart"
MIRRORS = [(0, 1, 2, 3), (3, 1, 2, 0), (0, 2, 1, 3), (3, 2, 1, 0)]


def tok_of(kinds: tuple[int, int, int, int]) -> int:
    return sum(k * 3 ** c for c, k in enumerate(kinds))


def kinds_of(tok: int) -> tuple[int, int, int, int]:
    return tuple((tok // 3 ** c) % 3 for c in range(4))  # type: ignore[return-value]


TOK_COLS = [[c for c in range(4) if kinds_of(t)[c]] for t in range(N_TOK)]


def chart_rows(rows, mirror=(0, 1, 2, 3)):
    """[(beat, time, row)] → [(beat, time, kinds, {col: tail_beat})] for rows with taps or freeze heads."""
    out = []
    open_heads: dict[int, int] = {}
    for b, t, r in rows:
        kinds = [0, 0, 0, 0]
        for c in range(4):
            ch = r[c]
            mc = mirror[c]
            if ch == "1":
                kinds[mc] = 1
            elif ch in "24":
                kinds[mc] = 2
            elif ch == "3" and mc in open_heads:
                idx = open_heads.pop(mc)
                out[idx][3][mc] = b
        if any(kinds):
            out.append((b, t, tuple(kinds), {}))
            for c in range(4):
                if kinds[c] == 2:
                    open_heads[c] = len(out) - 1
    for c, idx in open_heads.items():  # unterminated: one beat
        out[idx][3][c] = out[idx][0] + 1
    return out


def nps_of(rows) -> float:
    if len(rows) < 2:
        return 1.0
    return len(rows) / max(rows[-1][1] - rows[0][1], 1.0)


def encode(rows, n_frames: int, diff: int):
    """Arrays for one chart: tokens, conditioning ints, foot features, audio frame index."""
    feet = Feet()
    toks, cond, ff, fr = [], [], [], []
    for i, (b, t, kinds, holds) in enumerate(rows):
        prev = b - rows[i - 1][0] if i else 8.0
        nxt = rows[i + 1][0] - b if i + 1 < len(rows) else 8.0
        ff.append(feet.features(b))
        cond.append((gap_class(prev), gap_class(nxt), phase_class(b)))
        toks.append(tok_of(kinds))
        fr.append(min(max(int(round(t * FPS)), 0), n_frames - 1))
        feet.apply([c for c in range(4) if kinds[c]], {c: e for c, e in holds.items()}, b)
    return (np.array(toks), np.array(cond), np.array(ff, np.float32), np.array(fr), diff,
            math.log(nps_of(rows)))


class ArrowNet(nn.Module):
    def __init__(self, n_audio: int = 192, d: int = 192, layers: int = 4):
        super().__init__()
        self.tok = nn.Embedding(N_TOK, d)
        self.gp = nn.Embedding(len(GAPS), d)
        self.gn = nn.Embedding(len(GAPS), d)
        self.ph = nn.Embedding(4, d)
        self.df = nn.Embedding(len(DIFFS), d)
        self.pos = nn.Embedding(WIN, d)
        self.dens = nn.Linear(1, d)
        self.au = nn.Sequential(nn.Linear(n_audio, d), nn.GELU(), nn.Linear(d, d))
        self.ft = nn.Linear(N_FEAT, d)
        layer = nn.TransformerEncoderLayer(d, 4, 4 * d, dropout=0.1, batch_first=True, norm_first=True)
        self.tr = nn.TransformerEncoder(layer, layers)
        self.out = nn.Linear(d, N_TOK)

    def forward(self, prev, cond, feet, audio, diff, dens):
        n = prev.shape[1]
        h = (self.tok(prev) + self.gp(cond[..., 0]) + self.gn(cond[..., 1]) + self.ph(cond[..., 2])
             + self.df(diff)[:, None] + self.dens(dens[:, None])[:, None] + self.au(audio) + self.ft(feet)
             + self.pos(torch.arange(n, device=prev.device))[None])
        mask = nn.Transformer.generate_square_subsequent_mask(n, device=prev.device)
        return self.out(self.tr(h, mask=mask, is_causal=True))


def make(songs):
    ex = []
    for si, s in enumerate(songs):
        for c in s.meta["charts"]:
            for m in MIRRORS:
                rows = chart_rows(c["rows"], m)
                if len(rows) > 16:
                    ex.append((si,) + encode(rows, len(s.feats), diff_index(c["difficulty"])))
    return ex


def batch(songs, exs):
    P, T, C, F, A, D, N = [], [], [], [], [], [], []
    for si, tok, cond, ff, fr, d, dens in exs:
        st = random.randint(0, max(0, len(tok) - WIN))
        sl = slice(st, st + WIN)
        t = tok[sl]
        prev = np.r_[START if st == 0 else tok[st - 1], t[:-1]]
        pad = WIN - len(t)
        P.append(np.pad(prev, (0, pad)))
        T.append(np.pad(t, (0, pad), constant_values=-100))
        C.append(np.pad(cond[sl], ((0, pad), (0, 0))))
        F.append(np.pad(ff[sl], ((0, pad), (0, 0))))
        A.append(np.pad(songs[si].feats[fr[sl]], ((0, pad), (0, 0))))
        D.append(d)
        N.append(dens)
    f = lambda x, dt=torch.long: torch.tensor(np.stack(x), dtype=dt).to(DEV)  # noqa: E731
    return (f(P), f(T), f(C), f(F, torch.float32), f(A, torch.float32), torch.tensor(D).to(DEV),
            torch.tensor(N, dtype=torch.float32).to(DEV))


# ------------------------------------------------------------------ generation
# Penalties (in nats) per foot-flow event, per difficulty. Tuned on validation songs to land near human rates.
PENALTY = {
    "Beginner": {"crossover": 9, "jack": 9, "double": 4, "hand": 99, "held_hit": 99, "candle": 9},
    "Easy": {"crossover": 9, "jack": 6, "double": 3, "hand": 99, "held_hit": 99, "candle": 6},
    "Medium": {"crossover": 4, "jack": 2, "double": 2, "hand": 99, "held_hit": 99, "candle": 2},
    "Hard": {"crossover": 2.0, "jack": 0.4, "double": 1.5, "hand": 8, "held_hit": 99, "candle": 0.3},
    "Challenge": {"crossover": 2.0, "jack": 0.6, "double": 1.5, "hand": 5, "held_hit": 99, "candle": 0.3},
}
# Jumps: the model writes more of them than human charts do on Hard and Challenge; this cost brings them level.
JUMP_COST = {"Beginner": 0.0, "Easy": 0.0, "Medium": 0.0, "Hard": 0.65, "Challenge": 0.75}
if os.environ.get("CHARTNET_JUMP"):
    JUMP_COST["Hard"], JUMP_COST["Challenge"] = (float(x) for x in os.environ["CHARTNET_JUMP"].split(","))


REPEAT = float(os.environ.get("CHARTNET_REPEAT", "2.0"))
REPEAT_WINDOW = int(os.environ.get("CHARTNET_REPEAT_WINDOW", "64"))
# Variety by choice: every PHRASE rows, CANDIDATES continuations are sampled side by side and the one that scores best
# on (model likelihood after foot-flow costs) + VARIETY x (share of its four-row patterns the chart has not used yet)
# is kept. CANDIDATES=1 is plain sampling.
CANDIDATES = int(os.environ.get("CHARTNET_CANDIDATES", "6"))
PHRASE = int(os.environ.get("CHARTNET_PHRASE", "16"))
VARIETY = float(os.environ.get("CHARTNET_VARIETY", "1.0"))
# Freezes: a log-probability bonus for a freeze head where the next row leaves room for it (at least half a beat),
# or, negative, a cost on every freeze. Trained on the community packs the model holds more than DDR/ITG charts do.
FREEZE_BONUS = {"Beginner": 0.0, "Easy": 0.0, "Medium": 0.0, "Hard": -0.45, "Challenge": -0.45}
if os.environ.get("CHARTNET_FREEZE"):
    FREEZE_BONUS["Hard"], FREEZE_BONUS["Challenge"] = (float(x) for x in os.environ["CHARTNET_FREEZE"].split(","))


def hold_tails(rows_out):
    """Freeze tails: held until just before the row after next (the other foot takes the next one), 0.5–4 beats."""
    beats = [b for b, _ in rows_out]
    result = []
    for i, (b, kinds) in enumerate(rows_out):
        tails = {}
        for c in range(4):
            if kinds[c] != 2:
                continue
            r1 = beats[i + 1] if i + 1 < len(beats) else b + 2
            r2 = beats[i + 2] if i + 2 < len(beats) else b + 4
            tail = min(r2 - 0.25, b + 4)
            if r1 - b >= 1:
                tail = min(tail, r1 - 0.25)
            # never across a later step on the same panel
            nxt = next((bb for bb, kk in rows_out[i + 1:] if kk[c]), None)
            if nxt is not None:
                tail = min(tail, nxt - 0.25)
            tail = math.floor(tail * 4 + 1e-6) / 4
            if tail - b >= 0.5:
                tails[c] = tail
        result.append(tails)
    return result


class _Cand:
    """One candidate continuation: its own feet, tokens and model inputs."""

    def __init__(self, feet, toks, conds, ffs, auds, out):
        self.feet, self.toks, self.conds, self.ffs, self.auds, self.out = feet, toks, conds, ffs, auds, out
        self.score = 0.0

    def fork(self) -> "_Cand":
        return _Cand(self.feet.copy(), list(self.toks), list(self.conds), list(self.ffs), list(self.auds), list(self.out))


def _costs(feet: Feet, toks: list[int], b: float, nxt: float, last: bool, diff: str, pen) -> torch.Tensor:
    cost = torch.zeros(N_TOK)
    cost[0] = 1e9
    bonus = FREEZE_BONUS[diff] if nxt >= 0.5 - 1e-6 or FREEZE_BONUS[diff] < 0 else 0.0
    for t in range(1, N_TOK):
        cols = TOK_COLS[t]
        _, ev = feet.assign(cols, b)
        cost[t] = sum(pen[k] * v for k, v in ev.items()) + (JUMP_COST[diff] if len(cols) >= 2 else 0.0)
        if 2 in kinds_of(t):
            # a freeze needs the next row to be a single step for the other foot; none in the last row
            if len(cols) > 1 and diff != "Challenge" or last:
                cost[t] += 99
            else:
                cost[t] -= bonus
    # variety: completing a four-row pattern used in the last rows costs a little
    if REPEAT > 0 and len(toks) >= 3:
        recent = {tuple(toks[j:j + 4]) for j in range(max(0, len(toks) - REPEAT_WINDOW), len(toks) - 3)}
        last3 = tuple(toks[-3:])
        for t in range(1, N_TOK):
            if last3 + (t,) in recent:
                cost[t] += REPEAT
    return cost


@torch.no_grad()
def generate(model, song, beats, tm, diff: str, nps: float, temp: float = 1.0, seed: int = 0, penalty=None,
             candidates: int | None = None):
    """Arrows and freezes for placed `beats`: [(beat, time, row string)] including freeze tails."""
    model.eval()
    g = torch.Generator().manual_seed(seed)
    pen = penalty or PENALTY[diff]
    k_cand = max(1, candidates if candidates is not None else (CANDIDATES if diff in ("Hard", "Challenge") else 1))
    di1 = torch.tensor([diff_index(diff)]).to(DEV)
    dn1 = torch.tensor([math.log(max(nps, 0.3))], dtype=torch.float32).to(DEV)
    best = _Cand(Feet(), [], [], [], [], [])
    n = len(beats)
    for start in range(0, n, PHRASE):
        cands = [best.fork() for _ in range(k_cand)]
        shape = lambda toks: [tuple(TOK_COLS[t]) for t in toks]  # noqa: E731  (which panels, tap or freeze alike)
        done = shape(best.toks)
        seen = {tuple(done[j:j + 4]) for j in range(len(done) - 3)}
        for i in range(start, min(start + PHRASE, n)):
            b = beats[i]
            prev = b - beats[i - 1] if i else 8.0
            nxt = beats[i + 1] - b if i + 1 < n else 8.0
            fr = min(max(int(round(tm.beat_to_time(b) * FPS)), 0), len(song.feats) - 1)
            lo = max(0, i + 1 - WIN)
            for c in cands:
                c.conds.append((gap_class(prev), gap_class(nxt), phase_class(b)))
                c.ffs.append(c.feet.features(b))
                c.auds.append(song.feats[fr])
            x = lambda rows, dt=torch.long: torch.tensor(np.array(rows), dtype=dt).to(DEV)  # noqa: E731
            logits = model(x([([START] + c.toks)[lo:i + 1] for c in cands]), x([c.conds[lo:] for c in cands]),
                           x([c.ffs[lo:] for c in cands], torch.float32),
                           x([c.auds[lo:] for c in cands], torch.float32),
                           di1.expand(len(cands)), dn1.expand(len(cands)))
            logps = torch.log_softmax(logits[:, -1].float().cpu() / temp, -1)
            for c, logp in zip(cands, logps):
                score = logp - _costs(c.feet, c.toks, b, nxt, i + 1 >= n, diff, pen)
                tok = int(torch.multinomial(torch.softmax(score, -1), 1, generator=g))
                c.score += float(score[tok])
                c.toks.append(tok)
                kinds = kinds_of(tok)
                c.out.append((b, kinds))
                # freeze tails are only known once the next rows are; hold the panel for the next row meanwhile
                c.feet.apply(TOK_COLS[tok], {col: b + 0.75 for col in range(4) if kinds[col] == 2}, b)
        if k_cand == 1:
            best = cands[0]
            continue
        m = min(start + PHRASE, n) - start

        def total(c: _Cand) -> float:
            sh = shape(c.toks[max(0, start - 3):])
            grams = [tuple(sh[j:j + 4]) for j in range(len(sh) - 3)]
            fresh = len({gr for gr in grams if gr not in seen}) / max(len(grams), 1)
            return c.score / m + VARIETY * fresh

        best = max(cands, key=total)
    out = best.out
    tails = hold_tails(out)
    rows = []
    tail_rows: dict[float, list[int]] = {}
    for (b, kinds), tl in zip(out, tails):
        r = ["1" if k else "0" for k in kinds]
        for c, e in tl.items():
            r[c] = "2"
            tail_rows.setdefault(e, []).append(c)
        rows.append((b, "".join(r)))
    merged: dict[float, list[str]] = {b: list(r) for b, r in rows}
    for e, cs in tail_rows.items():
        row = merged.setdefault(e, ["0"] * 4)
        for c in cs:
            if row[c] == "0":
                row[c] = "3"
    return [(b, tm.beat_to_time(b), "".join(r)) for b, r in sorted(merged.items())]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=6000)
    ap.add_argument("--name", default="arrows")
    ap.add_argument("--d", type=int, default=192)
    ap.add_argument("--layers", type=int, default=4)
    a = ap.parse_args()
    songs, _ = load("cache")
    tr, va, te = split(songs)
    trx = make(tr)
    vax = [e for e in make(va)][::4]
    print(len(trx), "train sequences", flush=True)
    model = ArrowNet(songs[0].feats.shape[1], a.d, a.layers).to(DEV)
    opt = torch.optim.AdamW(model.parameters(), 5e-4, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=a.steps)
    best = float("inf")
    for step in range(a.steps):
        model.train()
        p, t, c, f, au, d, n = batch(tr, random.sample(trx, 64))
        loss = nn.functional.cross_entropy(model(p, c, f, au, d, n).reshape(-1, N_TOK), t.reshape(-1),
                                           ignore_index=-100)
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 500 == 0 or step == a.steps - 1:
            model.eval()
            with torch.no_grad():
                vl = []
                for i in range(0, len(vax), 64):
                    p, t, c, f, au, d, n = batch(va, vax[i:i + 64])
                    vl.append(nn.functional.cross_entropy(model(p, c, f, au, d, n).reshape(-1, N_TOK), t.reshape(-1),
                                                          ignore_index=-100).item())
            print(step, round(loss.item(), 3), "val", round(float(np.mean(vl)), 3),
                  "ppl", round(math.exp(np.mean(vl)), 2), flush=True)
            if float(np.mean(vl)) < best:  # keep the weights that do best on songs the model has not seen
                best = float(np.mean(vl))
                torch.save(model.state_dict(), ROOT / f"{a.name}.pt")


if __name__ == "__main__":
    main()
