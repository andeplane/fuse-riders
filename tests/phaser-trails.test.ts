import { test } from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createGame, toSnapshot } from "../src/engine/game.js";
import type { TrailSegment } from "../src/shared/protocol.js";
import {
  TrailHistoryCache,
  completeTrailStrokes,
  trailColor,
  trailPaths,
  trailTip,
} from "../src/client/phaser/trails.js";

const segment = (
  tick: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): TrailSegment => ({
  x1,
  y1,
  x2,
  y2,
  createdTick: tick,
  expiresAtTick: tick + 160,
});
const rider = () => {
  const game = createGame("trail-test", 42);
  addPlayer(game, { id: "p", name: "Player", slot: 0, color: "#22d3ee" });
  return {
    ...toSnapshot(game).players[0]!,
    alive: true,
    x: 25,
    y: 10,
    portalCooldownUntilTick: 0,
    trail: [segment(9, 0, 0, 10, 0), segment(10, 10, 0, 20, 10)],
  };
};

test("a continuous bend is one stroke with the exact supplied vertices", () => {
  const trail = [
    segment(1, 0, 0, 10, 0),
    segment(2, 10, 0, 20, 10),
    segment(3, 20, 10, 20, 20),
  ];
  assert.deepEqual(trailPaths(trail), [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
    ],
  ]);
});

test("portal jumps, deleted ticks and clipped segments remain separate strokes", () => {
  const trail = [
    segment(1, 0, 0, 10, 0),
    segment(2, 100, 0, 110, 0),
    segment(4, 110, 0, 120, 0),
    segment(5, 125, 0, 130, 0),
  ];
  assert.deepEqual(
    trailPaths(trail),
    trail.map((t) => [
      { x: t.x1, y: t.y1 },
      { x: t.x2, y: t.y2 },
    ]),
  );
  assert.deepEqual(trailPaths([]), []);
});

test("history survives fractional motion, a changing predicted tip and equivalent deserialized snapshots", () => {
  const cache = new TrailHistoryCache(),
    player = rider();
  const initial = cache.update([player], "epoch:match:round1");
  const moved = {
    ...player,
    x: 27,
    trail: [structuredClone(player.trail[0]!), { ...player.trail[1]!, x2: 27 }],
  };
  const next = cache.update([moved], "epoch:match:round1");
  assert.equal(initial.changed, true);
  assert.equal(next.changed, false);
  assert.equal(next.strokes, initial.strokes);
  assert.equal(
    cache.update([structuredClone(moved)], "epoch:match:round1").changed,
    false,
  );
  assert.deepEqual(
    player,
    rider(),
    "presentation must not mutate supplied state",
  );
});

test("history refreshes for trail holes, clipping, expiry, death, identity, scope and reset", () => {
  const player = rider();
  player.trail.push(segment(11, 20, 10, 25, 10));
  for (const changed of [
    { ...player, trail: player.trail.slice(1) },
    { ...player, trail: [player.trail[0]!, player.trail[2]!] },
    {
      ...player,
      trail: [{ ...player.trail[0]!, x2: 9 }, ...player.trail.slice(1)],
    },
    { ...player, alive: false },
    { ...player, id: "replacement" },
    { ...player, color: "#ff0000" },
  ]) {
    const cache = new TrailHistoryCache();
    cache.update([player], "match:1");
    assert.equal(cache.update([changed], "match:1").changed, true);
  }
  const cache = new TrailHistoryCache();
  cache.update([player], "match:1");
  assert.equal(cache.update([player], "match:2").changed, true);
  assert.deepEqual(cache.update([], "match:2").strokes, []);
  cache.update([player], "match:2");
  cache.reset();
  assert.equal(cache.update([player], "match:2").changed, true);
});

test("a fresh trail follows the interpolated head by at most one simulation step", () => {
  const player = rider();
  assert.deepEqual(trailTip(player, 10.5, "playing"), [
    { x: 10, y: 0 },
    { x: 20, y: 10 },
    { x: 25, y: 10 },
  ]);
  assert.deepEqual(trailTip({ ...player, x: 27.5 }, 10.9, "playing").at(-1), {
    x: 27.5,
    y: 10,
  });
  const predicted = {
    ...player,
    trail: [...player.trail, segment(10, 20, 10, 25, 10)],
  };
  assert.deepEqual(trailTip(predicted, 10.5, "playing"), [
    { x: 20, y: 10 },
    { x: 25, y: 10 },
  ]);
});

test("head interpolation never extends a stale, destroyed, teleported or dead trail", () => {
  const player = rider(),
    original = [
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ];
  assert.deepEqual(trailTip(player, 11.5, "playing"), original);
  assert.deepEqual(trailTip(player, 9.5, "playing"), original);
  assert.deepEqual(trailTip(player, 10.5, "roundOver"), original);
  assert.deepEqual(
    trailTip({ ...player, alive: false }, 10.5, "playing"),
    original,
  );
  assert.deepEqual(
    trailTip({ ...player, x: 60 }, 10.5, "playing"),
    original,
    "farther than a fully ramped stride",
  );
  // A plain rider's longest stride is 7.5 × 1.5 ramp = 11.25 units: the tip follows up to it and no further.
  assert.deepEqual(trailTip({ ...player, x: 31.2 }, 10.5, "playing").at(-1), {
    x: 31.2,
    y: 10,
  });
  assert.deepEqual(trailTip({ ...player, x: 31.4 }, 10.5, "playing"), original);
  // The cap follows the rider's own speed pickups on the tick the segment was drawn: 45 units on two Nitros.
  const nitro = { ...player, nitroUntilTicks: [20, 20] };
  assert.deepEqual(trailTip({ ...nitro, x: 64.9 }, 10.5, "playing").at(-1), {
    x: 64.9,
    y: 10,
  });
  assert.deepEqual(trailTip({ ...nitro, x: 65.2 }, 10.5, "playing"), original);
  assert.deepEqual(
    trailTip({ ...player, nitroUntilTicks: [10], x: 40.3 }, 10.5, "playing"),
    original,
    "a Nitro spent on the drawing tick does not stretch the cap",
  );
  assert.deepEqual(
    trailTip({ ...player, portalCooldownUntilTick: 25 }, 10.5, "playing"),
    original,
  );
  assert.deepEqual(trailTip({ ...player, trail: [] }, 10.5, "playing"), []);
  assert.equal(
    trailTip({ ...player, trail: player.trail.slice(0, -1) }, 10.5, "playing")
      .length,
    2,
  );
});

test("detached living pieces use dead-trail styling and refresh either shrinking endpoint", () => {
  const cache = new TrailHistoryCache(),
    player = rider();
  player.trail = player.trail.map((s) => ({
    ...s,
    detached: { id: 1, decayStartTick: 70 },
  }));
  const first = cache.update([player], "match:1");
  assert.equal(first.strokes[0]!.alive, false);
  assert.deepEqual(trailTip(player, 10.5, "playing").at(-1), { x: 20, y: 10 });
  const shrunk = {
    ...player,
    trail: [
      { ...player.trail[0]!, x1: 3.75 },
      { ...player.trail[1]!, x2: 17 },
    ],
  };
  assert.equal(cache.update([shrunk], "match:1").changed, true);
  assert.equal(trailTip(shrunk, 11, "playing").at(-1)!.x, 17);
  const active = rider();
  assert.equal(cache.update([active], "match:1").strokes[0]!.alive, true);
  const crossing = [
    segment(1, 0, 0, 10, 0),
    { ...segment(2, 10, 0, 20, 0), detached: { id: 2, decayStartTick: 70 } },
  ];
  assert.equal(trailPaths(crossing).length, 2);
});

test("pieces desaturate independently from snapshot time, preserving geometry and rider identity", () => {
  const player = rider();
  player.trail = [
    { ...segment(1, 0, 0, 10, 0), detached: { id: 1, decayStartTick: 70 } },
    { ...segment(2, 10, 0, 20, 0), detached: { id: 2, decayStartTick: 100 } },
    segment(3, 20, 0, 30, 0),
  ];
  const original = structuredClone(player);
  const fresh = completeTrailStrokes([player], 10, "playing");
  const middle = completeTrailStrokes([player], 40, "playing");
  const gray = completeTrailStrokes([player], 70, "playing");
  assert.equal(fresh[0]!.color, player.color);
  const channels = (color: string) =>
    [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  const chroma = (color: string) =>
    Math.max(...channels(color)) - Math.min(...channels(color));
  assert(chroma(middle[0]!.color) > 0);
  assert(chroma(middle[0]!.color) < chroma(fresh[0]!.color));
  assert.equal(chroma(gray[0]!.color), 0);
  assert.equal(
    middle[1]!.color,
    player.color,
    "newer piece starts at full color",
  );
  assert(gray.every((stroke, i) => i !== 2 || stroke.color === player.color));
  assert.deepEqual(
    gray.map((stroke) => stroke.paths),
    fresh.map((stroke) => stroke.paths),
  );
  assert.deepEqual(
    completeTrailStrokes([player], 10, "playing"),
    fresh,
    "rollback restores saturation",
  );
  assert.deepEqual(player, original);
  assert.equal(
    trailColor(player.color, false, player.trail[0]!, 70),
    gray[0]!.color,
    "death does not restart an older piece's fade",
  );
});

test("Canvas history refreshes color with stationary geometry, settles at gray and restores on rollback", () => {
  const cache = new TrailHistoryCache();
  const player = rider();
  player.trail = player.trail.map((segment) => ({
    ...segment,
    detached: { id: 1, decayStartTick: 70 },
  }));
  const first = cache.update([player], "match:1", 10);
  const middle = cache.update([player], "match:1", 40.5);
  assert(middle.changed);
  assert.notEqual(middle.strokes[0]!.color, first.strokes[0]!.color);
  assert.equal(
    middle.strokes[0]!.color,
    completeTrailStrokes([player], 40.5, "playing")[0]!.color,
  );
  assert.deepEqual(middle.strokes[0]!.paths, first.strokes[0]!.paths);
  cache.update([player], "match:1", 70);
  assert.equal(cache.update([player], "match:1", 80).changed, false);
  assert.deepEqual(
    cache.update([player], "match:1", 10).strokes,
    first.strokes,
  );
  player.trail[0] = {
    ...player.trail[0]!,
    detached: { id: 1, decayStartTick: 0 },
  };
  assert.equal(
    cache.update([player], "match:1", 10).changed,
    true,
    "corrected schedule invalidates cached color",
  );
});
