import { test } from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createGame, toView } from "../src/engine/game.js";
import type { TrailSegment } from "../src/shared/protocol.js";
import {
  TrailHistoryCache,
  trailPaths,
  trailTip,
} from "../src/render/phaser/trails.js";

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
    ...toView(game).players[0]!,
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
    "farther than one stride",
  );
  // The view says how far the rider goes on the next tick (7.5 units as a round opens): the tip follows up to it and no further.
  assert.equal(player.speed, 7.5);
  assert.deepEqual(trailTip({ ...player, x: 27.4 }, 10.5, "playing").at(-1), {
    x: 27.4,
    y: 10,
  });
  assert.deepEqual(trailTip({ ...player, x: 27.6 }, 10.5, "playing"), original);
  // Whatever changes the pace is already in that number. The renderer does not know what a Nitro is.
  const fast = { ...player, speed: 30 };
  assert.deepEqual(trailTip({ ...fast, x: 49.9 }, 10.5, "playing").at(-1), {
    x: 49.9,
    y: 10,
  });
  assert.deepEqual(trailTip({ ...fast, x: 50.2 }, 10.5, "playing"), original);
  assert.deepEqual(
    trailTip({ ...fast, nitroUntilTicks: [20, 20], x: 50.2 }, 10.5, "playing"),
    original,
    "rule fields are not read: only the published speed bounds the tip",
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
    detached: { id: 1, decayStartTick: 30 },
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
    { ...segment(2, 10, 0, 20, 0), detached: { id: 2, decayStartTick: 30 } },
  ];
  assert.equal(trailPaths(crossing).length, 2);
});

test("a Snail that ends on the next tick no longer clips the tip: the cap is the step the simulation will take", () => {
  const game = createGame("trail-tip-snail", 42);
  addPlayer(game, { id: "p", name: "Player", slot: 0, color: "#22d3ee" });
  const state = game.players.get("p")!;
  state.snailUntilTicks = [game.tick + 1];
  const player = {
    ...toView(game).players[0]!,
    alive: true,
    y: 10,
    portalCooldownUntilTick: 0,
    trail: [segment(game.tick, 10, 0, 20, 10)],
  };
  // The Snail still counts on the drawing tick and is spent on the next, which moves a whole 7.5 units. The bound the
  // renderer used to build from constants read the drawing tick (3.75 x 1.5 ramp = 5.6) and dropped the tip at 7.
  assert.equal(player.speed, 7.5);
  assert.deepEqual(
    trailTip({ ...player, x: 27 }, game.tick + 0.9, "playing").at(-1),
    { x: 27, y: 10 },
  );
});
