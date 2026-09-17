import assert from "node:assert/strict";
import test from "node:test";
import { TrailDebris } from "../src/client/trail-debris.js";
import { createGame, addPlayer, toSnapshot } from "../src/shared/game.js";
import type { ViewSnapshot } from "../src/client/snapshot-stream.js";
import type { TrailSegment } from "../src/shared/protocol.js";

const segment: TrailSegment = {
  x1: 540,
  y1: 450,
  x2: 550,
  y2: 450,
  createdTick: 90,
  expiresAtTick: 200,
};
const blast = {
  bombId: 1,
  circle: { x: 500, y: 450, radius: 100 },
  expiresAtTick: 108,
};
function frame(
  tick: number,
  trail: TrailSegment[],
  blasts: ViewSnapshot["blasts"] = [],
): ViewSnapshot {
  const game = createGame("debris");
  addPlayer(game, { id: "rider", name: "Rider", slot: 0, color: "#22d3ee" });
  const snapshot = toSnapshot(game);
  return {
    ...snapshot,
    tick,
    round: 1,
    phase: "playing",
    blasts,
    players: snapshot.players.map((player) => ({ ...player, trail })),
  };
}
const fixedRandom = () => 0.7;

test("removed trail keeps its color and endpoints, then travels outward, spins, slows and expires", () => {
  const effect = new TrailDebris(240, fixedRandom);
  const before = frame(99, [segment]),
    after = frame(100, [], [blast]);
  const original = structuredClone([before, after]);
  assert.deepEqual(effect.update(before, 0, "match"), []);
  const start = effect.update(after, 50, "match");
  assert.equal(start.length, 1);
  assert.equal(start[0]!.color, "#22d3ee");
  assert.equal(start[0]!.x1, segment.x1);
  assert.equal(start[0]!.x2, segment.x2);
  const early = effect.update(after, 150, "match")[0]!;
  const later = effect.update(after, 250, "match")[0]!;
  const midpoint = (p: typeof early) => (p.x1 + p.x2) / 2;
  assert.ok(midpoint(early) > midpoint(start[0]!));
  assert.ok(
    midpoint(later) - midpoint(early) < midpoint(early) - midpoint(start[0]!),
    "drag decelerates",
  );
  assert.notEqual(early.y1, early.y2, "the fragment spins");
  assert.deepEqual(effect.update(after, 1000, "match"), []);
  assert.deepEqual(
    effect.update(after, 1100, "match"),
    [],
    "same blast never re-emits",
  );
  assert.deepEqual([before, after], original);
});

test("expiry, boundary trimming, surviving segments, speculative tips and departed riders emit nothing", () => {
  for (const scenario of [
    "expiry",
    "boundary",
    "retained",
    "partial",
    "speculative",
    "departed",
    "no-blast",
  ] as const) {
    const effect = new TrailDebris(240, fixedRandom);
    const old = {
      ...segment,
      ...(scenario === "expiry" ? { expiresAtTick: 100 } : {}),
      ...(scenario === "speculative" ? { createdTick: 100 } : {}),
    };
    effect.update(frame(99, [old]), 0, "match");
    const next = frame(
      100,
      scenario === "retained"
        ? [old]
        : scenario === "partial"
          ? [{ ...old, x1: 546 }]
          : [],
      scenario === "no-blast" ? [] : [blast],
    );
    if (scenario === "boundary") next.boundaryInset = 451;
    if (scenario === "departed") next.players = [];
    assert.deepEqual(effect.update(next, 50, "match"), [], scenario);
  }
});

test("overlapping explosions launch a segment once, and an existing blast does not explain later expiry", () => {
  const effect = new TrailDebris(240, fixedRandom);
  effect.update(frame(99, [segment]), 0, "match");
  assert.equal(
    effect.update(frame(100, [], [blast, { ...blast, bombId: 2 }]), 50, "match")
      .length,
    1,
  );
  const observed = new TrailDebris(240, fixedRandom);
  observed.update(frame(100, [segment], [blast]), 0, "match");
  assert.deepEqual(observed.update(frame(101, [], [blast]), 50, "match"), []);
});

test("round/scope changes, rewinds, lobby and explicit disposal flush cosmetic history", () => {
  for (const change of [
    "round",
    "scope",
    "tick",
    "clock",
    "lobby",
    "reset",
  ] as const) {
    const effect = new TrailDebris(240, fixedRandom);
    effect.update(frame(99, [segment]), 0, "match");
    assert.equal(effect.update(frame(100, [], [blast]), 50, "match").length, 1);
    const next = frame(change === "tick" ? 99 : 101, [], [blast]);
    if (change === "round") next.round++;
    if (change === "lobby") next.phase = "lobby";
    if (change === "reset") effect.reset();
    assert.deepEqual(
      effect.update(
        next,
        change === "clock" ? 0 : 100,
        change === "scope" ? "other" : "match",
      ),
      [],
      change,
    );
  }
});

test("dense removal is capped, skipped snapshots still emit, and random samples stay local", () => {
  const segments = Array.from({ length: 100 }, (_, i) => ({
    ...segment,
    createdTick: i,
  }));
  const effect = new TrailDebris(12, fixedRandom);
  effect.update(frame(99, segments), 0, "match");
  assert.equal(effect.update(frame(103, [], [blast]), 200, "match").length, 12);
  const other = new TrailDebris(12, () => 0.2);
  other.update(frame(99, segments), 0, "match");
  other.update(frame(103, [], [blast]), 200, "match");
  assert.notDeepEqual(
    other.update(frame(103, [], [blast]), 300, "match"),
    effect.update(frame(103, [], [blast]), 300, "match"),
  );
});

test("erosion emits no flying fragments even under a newly observed blast", () => {
  const effect = new TrailDebris(240, fixedRandom);
  const decaying = {
    ...segment,
    x2: 543,
    expiresAtTick: 95,
    detached: { id: 1, decayStartTick: 98 },
  };
  effect.update(frame(99, [decaying]), 0, "match");
  assert.deepEqual(effect.update(frame(100, [], [blast]), 50, "match"), []);
  const paused = {
    ...segment,
    expiresAtTick: 95,
    detached: { id: 1, decayStartTick: 110 },
  };
  effect.reset();
  effect.update(frame(99, [paused]), 0, "match");
  assert.equal(
    effect.update(frame(100, [], [blast]), 50, "match").length,
    1,
    "blasts still launch expired-age debris",
  );
});
