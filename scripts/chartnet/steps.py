"""Step selection: which arrows each placed row gets. An autoregressive GRU over rows, conditioned on rhythm
(gap to previous/next row in beats, beat-phase class), difficulty and the audio at that moment.

Tokens are 4-bit masks of the columns pressed (L, D, U, R), 1..15. Holds are added afterwards by rule.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from data import DIFFS, diff_index, load, split
from features import FPS

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
DEV = torch.device("cpu")
GAPS = [1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 1.5, 2, 3, 4]  # beats
MIRRORS = [(0, 1, 2, 3), (3, 1, 2, 0), (0, 2, 1, 3), (3, 2, 1, 0)]  # identity, LR swap, UD swap, both


def gap_class(g: float) -> int:
    return int(np.argmin([abs(math.log2(max(g, 1e-3) / x)) for x in GAPS]))


def phase_class(beat: float) -> int:
    f = beat % 1
    for i, (q, tol) in enumerate(((0, 0.02), (0.5, 0.02), (0.25, 0.02), (0.75, 0.02))):
        if abs(f - q) < tol or abs(f - q - 1) < tol:
            return min(i, 2)
    return 3  # triplets etc.


def mask_of(row: str, mirror=(0, 1, 2, 3)) -> int:
    m = 0
    for c in range(4):
        if row[c] in "124":
            m |= 1 << mirror[c]
    return m


def sequence(chart_rows, feats: np.ndarray, mirror=(0, 1, 2, 3)):
    """chart_rows: [(beat, time, row)] → tokens, conditioning arrays."""
    rows = [(b, t, r) for b, t, r in chart_rows if mask_of(r)]
    toks, cond_i, audio = [], [], []
    for i, (b, t, r) in enumerate(rows):
        prev = b - rows[i - 1][0] if i else 8.0
        nxt = rows[i + 1][0] - b if i + 1 < len(rows) else 8.0
        toks.append(mask_of(r, mirror))
        cond_i.append((gap_class(prev), gap_class(nxt), phase_class(b)))
        f = int(round(t * FPS))
        audio.append(feats[min(max(f, 0), len(feats) - 1)])
    return np.array(toks), np.array(cond_i), np.array(audio, dtype=np.float32)


class StepNet(nn.Module):
    def __init__(self, n_audio: int, h: int = 256):
        super().__init__()
        self.tok = nn.Embedding(17, 64)  # 16 = start
        self.gp = nn.Embedding(len(GAPS), 32)
        self.gn = nn.Embedding(len(GAPS), 32)
        self.ph = nn.Embedding(4, 16)
        self.df = nn.Embedding(len(DIFFS), 16)
        self.au = nn.Sequential(nn.Linear(n_audio, 64), nn.GELU())
        self.rnn = nn.GRU(64 + 32 + 32 + 16 + 16 + 64, h, num_layers=2, batch_first=True, dropout=0.2)
        self.out = nn.Linear(h, 16)

    def step_in(self, prev_tok, cond, audio, diff):
        return torch.cat([self.tok(prev_tok), self.gp(cond[..., 0]), self.gn(cond[..., 1]), self.ph(cond[..., 2]),
                          self.df(diff)[:, None, :].expand(-1, prev_tok.shape[1], -1), self.au(audio)], -1)

    def forward(self, prev_tok, cond, audio, diff, h0=None):
        y, h = self.rnn(self.step_in(prev_tok, cond, audio, diff), h0)
        return self.out(y), h


def make_examples(songs):
    ex = []
    for s in songs:
        for c in s.meta["charts"]:
            for m in MIRRORS:
                tok, cond, au = sequence(c["rows"], s.feats, m)
                if len(tok) > 16:
                    ex.append((tok, cond, au, diff_index(c["difficulty"])))
    return ex


def batch(exs, L=256):
    P, T, C, A, D = [], [], [], [], []
    for tok, cond, au, d in exs:
        st = random.randint(0, max(0, len(tok) - L))
        t, c, a = tok[st:st + L], cond[st:st + L], au[st:st + L]
        prev = np.r_[16 if st == 0 else tok[st - 1], t[:-1]]
        pad = L - len(t)
        P.append(np.pad(prev, (0, pad), constant_values=16))
        T.append(np.pad(t, (0, pad), constant_values=-100))
        C.append(np.pad(c, ((0, pad), (0, 0))))
        A.append(np.pad(a, ((0, pad), (0, 0))))
        D.append(d)
    f = lambda x, dt=torch.long: torch.tensor(np.stack(x), dtype=dt)  # noqa: E731
    return f(P), f(T), f(C), f(A, torch.float32), torch.tensor(D)


@torch.no_grad()
def nll(model, exs):
    model.eval()
    tot = n = 0.0
    for i in range(0, len(exs), 32):
        p, t, c, a, d = batch(exs[i:i + 32], 4096)
        logits, _ = model(p, c, a, d)
        tot += nn.functional.cross_entropy(logits.reshape(-1, 16), t.reshape(-1),
                                           ignore_index=-100, reduction="sum").item()
        n += (t >= 0).sum().item()
    return tot / n


def unigram_bigram_nll(train, test):
    """Baseline: bigram over tokens per difficulty (add-one)."""
    cnt = np.ones((len(DIFFS), 17, 16))
    for tok, _, _, d in train:
        prev = np.r_[16, tok[:-1]]
        np.add.at(cnt, (d, prev, tok), 1)
    prob = cnt / cnt.sum(-1, keepdims=True)
    tot = n = 0
    for tok, _, _, d in test:
        prev = np.r_[16, tok[:-1]]
        tot -= np.log(prob[d, prev, tok]).sum()
        n += len(tok)
    return tot / n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=3000)
    a = ap.parse_args()
    torch.set_num_threads(6)
    songs, _ = load("cache")
    tr, va, te = split(songs)
    trx, tex = make_examples(tr), [e for e in make_examples(te)][::4]  # test: identity mirror only
    print(len(trx), "train sequences", flush=True)
    model = StepNet(songs[0].feats.shape[1]).to(DEV)
    opt = torch.optim.AdamW(model.parameters(), 2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=a.steps)
    for step in range(a.steps):
        model.train()
        p, t, c, au, d = batch(random.sample(trx, 32))
        logits, _ = model(p, c, au, d)
        loss = nn.functional.cross_entropy(logits.reshape(-1, 16), t.reshape(-1), ignore_index=-100)
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 500 == 0:
            print(step, round(loss.item(), 3), flush=True)
    torch.save(model.state_dict(), ROOT / "steps.pt")
    res = {"gru_nll": nll(model, tex), "bigram_nll": unigram_bigram_nll(trx, tex)}
    res["gru_ppl"], res["bigram_ppl"] = math.exp(res["gru_nll"]), math.exp(res["bigram_nll"])
    print(json.dumps(res), flush=True)
    (ROOT / "steps_results.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
