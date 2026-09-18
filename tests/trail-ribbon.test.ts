import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  toSnapshot,
  TRAIL_WIDTH,
} from "../src/engine/game.js";
import {
  trailRibbon as buildRibbon,
  TrailRibbonCache,
} from "../src/client/phaser/trail-ribbon.js";
import type { TrailSegment } from "../src/shared/protocol.js";
import type { ViewSnapshot } from "../src/client/snapshot-stream.js";

import { completeTrailStrokes } from "../src/client/phaser/trails.js";
const trailRibbon = (path: Parameters<typeof buildRibbon>[0]) =>
  buildRibbon(path, TRAIL_WIDTH / 2);
const update = (cache: TrailRibbonCache, state: ViewSnapshot) =>
  cache.update(completeTrailStrokes(state.players, state.tick, state.phase));

const segment = (x1: number, x2: number, tick: number): TrailSegment => ({
  x1,
  y1: 100,
  x2,
  y2: 100,
  createdTick: tick,
  expiresAtTick: 200,
});
function snapshot(): ViewSnapshot {
  const game = createGame("ribbon", 42);
  addPlayer(game, { id: "p", name: "Player", slot: 0, color: "#22d3ee" });
  const state = toSnapshot(game);
  return {
    ...state,
    round: 1,
    tick: 20,
    phase: "playing",
    players: [
      {
        ...state.players[0]!,
        alive: true,
        x: 120,
        y: 100,
        portalCooldownUntilTick: 0,
        trail: [segment(100, 110, 19), segment(110, 120, 20)],
      },
    ],
  };
}

test("ribbon has round caps beyond both endpoints and no cap at an interior join", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ];
  const original = structuredClone(path);
  const vertices = trailRibbon(path);
  assert(vertices.some((v) => v.x < 0));
  assert(vertices.some((v) => v.x > 20));
  assert(!vertices.some((v) => v.x === 10 && v.nx === 0 && v.ny === 0));
  // Triangles on both sides share exactly the same join, including lighting normals.
  assert.deepEqual(vertices[2], vertices[6]);
  assert.deepEqual(vertices[4], vertices[7]);
  assert.deepEqual(path, original);
});

test("zero-length points and a reversal produce bounded, finite geometry", () => {
  assert.deepEqual(trailRibbon([]), []);
  assert.deepEqual(
    trailRibbon([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]),
    [],
  );
  const vertices = trailRibbon([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert(vertices.length > 0);
  for (const vertex of vertices) {
    assert(Object.values(vertex).every(Number.isFinite));
    assert(Math.abs(vertex.x) < 22 && Math.abs(vertex.y) < 12);
  }
});

test("ribbon cache reuses equivalent snapshots but follows fractional tips without moving established vertices", () => {
  const cache = new TrailRibbonCache(TRAIL_WIDTH);
  const state = snapshot();
  const original = structuredClone(state);
  const first = update(cache, state);
  assert.equal(update(cache, structuredClone(state)), first);
  state.players[0]!.x = 124;
  state.players[0]!.y = 103;
  const next = update(cache, state);
  assert.notEqual(next, first);
  // The new tip turns at (120,100); replacing the segment endpoint would lose that cross section.
  const vertices = next[0]!.vertices;
  assert(
    vertices.some((v, i) =>
      vertices.some(
        (other, j) =>
          j !== i &&
          Math.abs((v.x + other.x) / 2 - 120) < 1e-6 &&
          Math.abs((v.y + other.y) / 2 - 100) < 1e-6,
      ),
    ),
  );
  assert.deepEqual(state.players[0]!.trail, original.players[0]!.trail);
  assert(
    Math.max(...vertices.map((v) => v.x)) >
      Math.max(...first[0]!.vertices.map((v) => v.x)),
  );
  state.phase = "roundOver";
  assert.deepEqual(
    update(cache, state),
    first,
    "no speculative extension outside play",
  );
});

test("holes and teleports never get a connecting triangle, and removal clears cached ribbons", () => {
  const state = snapshot();
  state.players[0]!.trail = [
    segment(100, 110, 16),
    segment(140, 150, 18),
    segment(200, 210, 19),
  ];
  const cache = new TrailRibbonCache(TRAIL_WIDTH);
  const ribbons = update(cache, state);
  const vertices = ribbons[0]!.vertices;
  for (let i = 0; i < vertices.length; i += 3) {
    const xs = vertices.slice(i, i + 3).map((v) => v.x);
    assert(
      Math.max(...xs) - Math.min(...xs) < 22,
      "triangle bridges a removed segment or teleport",
    );
  }
  state.players[0]!.trail = [];
  assert.deepEqual(update(cache, state), []);
  state.players = [];
  assert.deepEqual(update(cache, state), []);
});

test("death, detachment, erosion and rider color are reflected without mutating snapshots", () => {
  const state = snapshot();
  state.players[0]!.trail[0]!.detached = { id: 1, decayStartTick: 80 };
  const original = structuredClone(state);
  const cache = new TrailRibbonCache(TRAIL_WIDTH);
  const first = update(cache, state);
  assert(first.every((r) => r.color === 0x22d3ee));
  assert.deepEqual(state, original);
  state.players[0]!.alive = false;
  const dead = update(cache, state);
  assert.equal(dead[0]!.color, first[0]!.color);
  assert.notEqual(dead[1]!.color, first[1]!.color);
  state.players[0]!.trail[0]!.x1 += 3;
  const eroded = update(cache, state);
  assert(
    Math.min(...eroded[0]!.vertices.map((v) => v.x)) >
      Math.min(...dead[0]!.vertices.map((v) => v.x)),
  );
  state.players[0]!.color = "invalid";
  assert(update(cache, state).every((r) => r.color === 0xffffff));
});
