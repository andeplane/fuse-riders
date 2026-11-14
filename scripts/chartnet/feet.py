"""A small foot model for dance-single: which foot takes each row, and what that costs.

Used both as input features for the arrow model (where the feet are before each row) and as the foot-flow
constraint when generating (crossovers, jacks, double steps, hands, freezes).
"""
from __future__ import annotations

from dataclasses import dataclass, field

X = (0.0, 1.0, 1.0, 2.0)  # panel x positions: Left, Down, Up, Right
Y = (1.0, 0.0, 2.0, 1.0)
L, R = 0, 1


def cols_of(tok_cols: tuple[int, int, int, int]) -> list[int]:
    return [c for c in range(4) if tok_cols[c]]


@dataclass
class Feet:
    pos: list[int | None] = field(default_factory=lambda: [None, None])  # panel under each foot
    last_foot: int | None = None
    last_beat: float = -99.0
    last_cols: tuple[int, ...] = ()
    held: dict[int, float] = field(default_factory=dict)  # column -> tail beat
    col_beat: list[float] = field(default_factory=lambda: [-99.0] * 4)

    def copy(self) -> "Feet":
        f = Feet(list(self.pos), self.last_foot, self.last_beat, self.last_cols, dict(self.held), list(self.col_beat))
        return f

    def held_foot(self, beat: float) -> int | None:
        for c, end in self.held.items():
            if end > beat + 1e-6:
                for foot in (L, R):
                    if self.pos[foot] == c:
                        return foot
        return None

    def assign(self, cols: list[int], beat: float) -> tuple[list[int | None], dict[str, float]]:
        """Feet for `cols` at `beat` and the events this costs (not applied)."""
        gap = beat - self.last_beat
        ev = {"crossover": 0.0, "jack": 0.0, "double": 0.0, "hand": 0.0, "held_hit": 0.0, "candle": 0.0}
        for c in cols:
            if self.held.get(c, -1) > beat + 1e-6:
                ev["held_hit"] = 1.0
        held = self.held_foot(beat)
        if len(cols) >= 3 or (held is not None and len(cols) >= 2):
            ev["hand"] = 1.0
            return [None] * len(cols), ev
        if len(cols) == 2:
            left = min(cols, key=lambda c: (X[c], c))
            return [L if c == left else R for c in cols], ev
        c = cols[0]
        if held is not None:
            foot = 1 - held
        elif gap <= 1.0 + 1e-6 and self.last_foot is not None and len(self.last_cols) == 1:
            foot = 1 - self.last_foot  # alternate
            if self.last_cols[0] == c and gap <= 0.5 + 1e-6:
                ev["jack"] = 1.0
                foot = self.last_foot
            elif (foot == R and c == 0) or (foot == L and c == 3):
                # the alternating foot has to reach the far side's arrow: a crossover
                ev["crossover"] = 1.0
            if (self.pos[foot] in (1, 2) and c in (1, 2) and self.pos[foot] != c and gap <= 0.5 + 1e-6):
                ev["candle"] = 1.0
        else:  # after a pause or a jump: the natural foot
            foot = L if X[c] < 1 else R if X[c] > 1 else (1 - self.last_foot if self.last_foot is not None else L)
            other = self.pos[1 - foot]
            if other is not None and ((foot == L and X[c] > X[other]) or (foot == R and X[c] < X[other])):
                foot = 1 - foot
        return [foot], ev

    def apply(self, cols: list[int], holds: dict[int, float], beat: float) -> dict[str, float]:
        feet, ev = self.assign(cols, beat)
        for c, foot in zip(cols, feet):
            if foot is not None:
                self.pos[foot] = c
            self.col_beat[c] = beat
        if len(cols) == 1 and feet[0] is not None:
            self.last_foot = feet[0]
        elif len(cols) >= 2:
            self.last_foot = None
        self.last_beat = beat
        self.last_cols = tuple(cols)
        self.held = {c: e for c, e in self.held.items() if e > beat + 1e-6}
        self.held.update(holds)
        return ev

    def features(self, beat: float) -> list[float]:
        f: list[float] = []
        for foot in (L, R):
            onehot = [0.0] * 5
            onehot[4 if self.pos[foot] is None else self.pos[foot]] = 1.0
            f += onehot
        nxt = [0.0, 0.0, 0.0]
        nxt[2 if self.last_foot is None else 1 - self.last_foot] = 1.0
        f += nxt
        f += [1.0 if self.held.get(c, -1) > beat + 1e-6 else 0.0 for c in range(4)]
        f += [min(beat - b, 8.0) / 8.0 for b in self.col_beat]
        return f


N_FEAT = 5 + 5 + 3 + 4 + 4
