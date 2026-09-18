import assert from "node:assert/strict";
import test from "node:test";
import {
  GunImpacts,
  gunImpactFrame,
} from "../src/client/phaser/gun-impacts.js";
import { visualFixture } from "../src/client/phaser/benchmark-fixture.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import type { ViewSnapshot } from "../src/client/snapshot-stream.js";
import {
  addPlayer,
  createGame,
  startMatch,
  step,
  toSnapshot,
  COUNTDOWN_TICKS,
  SLOT_COLORS,
} from "../src/engine/game.js";

function scene(kind: "trail" | "head" | "wall", wrap = false) {
  const game = createGame("gun-art", 42);
  for (let i = 0; i < 4; i++)
    addPlayer(game, {
      id: `p${i}`,
      name: `Rider ${i}`,
      slot: i,
      color: SLOT_COLORS[i]!,
    });
  if (wrap) game.settings = { ...defaultRoomSettings(), map: "wrap" };
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  game.obstacles = [];
  game.nextPickupSpawnTick = game.tick + 1000;
  const players = [...game.players.values()];
  for (const [i, p] of players.entries())
    Object.assign(p, { x: 300 + i * 250, y: 700, angle: 0, trail: [] });
  Object.assign(players[0]!, { x: 200, y: 450, gunArmed: true });
  if (kind === "head") Object.assign(players[1]!, { x: 800, y: 450, angle: 0 });
  if (kind === "trail")
    players[1]!.trail = [
      {
        x1: 700,
        x2: 700,
        y1: 300,
        y2: 600,
        createdTick: game.tick,
        expiresAtTick: game.tick + 100,
      },
    ];
  if (wrap) {
    Object.assign(players[0]!, {
      x: kind === "trail" ? 1598 : 1596,
      y: 100,
      angle: Math.PI / 2,
    });
    if (kind === "head")
      Object.assign(players[1]!, { x: 2, y: 500, angle: Math.PI / 2 });
    if (kind === "trail")
      players[1]!.trail = [
        {
          x1: 2,
          x2: 2,
          y1: 300,
          y2: 600,
          createdTick: game.tick,
          expiresAtTick: game.tick + 100,
        },
      ];
  }
  const snapshot = (): ViewSnapshot => ({
    ...toSnapshot(game),
    tick: game.tick,
    round: game.round,
  });
  const before = snapshot();
  step(
    game,
    new Map([
      [
        "p0",
        {
          left: false,
          right: false,
          bomb: true,
          bombCommands: [{ action: "press" }],
        },
      ],
    ]),
  );
  return { before, after: snapshot() };
}

for (const [target, kind] of [
  ["trail", "trail"],
  ["head", "lethal"],
  ["wall", "solid"],
] as const)
  test(`actual Gun ${target} shot supplies ${kind} feedback exactly once`, () => {
    const { before, after } = scene(target);
    const tracker = new GunImpacts();
    assert.equal(tracker.accept(before, "m").fresh.length, 0);
    const result = tracker.accept(after, "m");
    assert.equal(result.fresh.length, 1);
    const hit = result.fresh[0]!;
    assert.equal(hit.kind, kind);
    if (kind === "trail") assert.equal(hit.ends.length, 2);
    assert.equal(tracker.accept(after, "m").fresh.length, 0);
    const frame = gunImpactFrame(hit, hit.born + 1);
    assert.ok(frame.fragments.every((p) => Number.isFinite(p.x) && p.size > 0));
    assert.equal(gunImpactFrame(hit, hit.born + 8).alpha, 0);
    assert.deepEqual(gunImpactFrame(hit, hit.born + 1), frame);
    assert.equal(
      tracker.accept({ ...after, tick: after.tick + 8, bombs: [] }, "m").active
        .length,
      0,
    );
  });

test("fresh connections, rollback, new scopes and lobby clear impact history", () => {
  const { before, after } = scene("trail");
  const tracker = new GunImpacts();
  assert.equal(tracker.accept(after, "m").fresh.length, 0);
  tracker.accept(before, "m");
  assert.equal(tracker.accept(after, "m").active.length, 1);
  assert.equal(tracker.accept(before, "m").active.length, 0);
  tracker.accept(after, "m");
  assert.equal(tracker.accept(after, "other").active.length, 0);
  tracker.reset();
  tracker.accept(before, "m");
  tracker.accept(after, "m");
  assert.equal(
    tracker.accept({ ...after, phase: "lobby" }, "m").active.length,
    0,
  );
});

test("range endpoints, old tracers, expired tails and ordinary shells produce no Gun hit", () => {
  const { before, after } = scene("wall");
  const bomb = after.bombs[0]!;
  for (const replacement of [
    { ...bomb, x: 900, y: 300 },
    { ...bomb, launchedTick: before.tick - 1 },
    { ...bomb, explodeAtTick: after.tick },
    { ...bomb, shell: { vx: 1, vy: 0 } },
  ]) {
    const tracker = new GunImpacts();
    tracker.accept(before, "m");
    assert.equal(
      tracker.accept({ ...after, bombs: [replacement] }, "m").fresh.length,
      0,
    );
  }
});

test("obstacle contact produces sparks and bursts stay bounded under dense volleys", () => {
  const fixture = visualFixture(100);
  const before = { ...fixture, bombs: [], players: [], obstacles: [] };
  const bombs = Array.from({ length: 100 }, (_, id) => ({
    ...fixture.bombs[0]!,
    id,
    x: 498,
    y: 450,
    launchedTick: 101,
    explodeAtTick: 104,
    shell: { gun: true, vx: 1, vy: 0 },
  }));
  const tracker = new GunImpacts();
  tracker.accept(before, "m");
  const after: ViewSnapshot = {
    ...before,
    tick: 101,
    bombs,
    obstacles: [
      { id: 1, kind: "crate", x: 520, y: 450, halfWidth: 20, halfHeight: 20 },
    ],
  };
  const result = tracker.accept(after, "m");
  assert.equal(result.active.length, 64);
  assert.ok(result.fresh.every((hit) => hit.kind === "solid"));
  assert.equal(tracker.accept(after, "m").fresh.length, 0);
});

for (const target of ["head", "trail"] as const)
  test(`wrap-edge ${target} hits keep their impact feedback`, () => {
    const { before, after } = scene(target, true);
    const tracker = new GunImpacts();
    tracker.accept(before, "m");
    const hits = tracker.accept(after, "m").fresh;
    if (target === "head")
      assert.equal(
        after.players[1]!.alive,
        false,
        "engine eliminated the far-side rider",
      );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, target === "head" ? "lethal" : "trail");
    if (target === "trail")
      assert.ok(hits[0]!.ends.every((end) => end.x === 2));
    assert.equal(
      gunImpactFrame(hits[0]!, hits[0]!.born - 0.5).alpha,
      0,
      "never display a future impact",
    );
    assert.equal(gunImpactFrame(hits[0]!, hits[0]!.born - 0.5).core, 0);
  });
