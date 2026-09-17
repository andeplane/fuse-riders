import { test } from "node:test";
import assert from "node:assert/strict";
import { EffectTransitions, bombPose } from "../src/client/phaser/effects.js";
import { createGame, addPlayer, toSnapshot } from "../src/engine/game.js";
import type { ViewSnapshot } from "../src/client/snapshot-stream.js";
const frame = (): ViewSnapshot => {
  const game = createGame("visual-test");
  addPlayer(game, { id: "p", name: "P", slot: 0, color: "#22d3ee" });
  return { ...toSnapshot(game), tick: 10, round: 1 };
};
test("effects do not replay on repeated snapshots or across authority/match reset", () => {
  const effects = new EffectTransitions();
  const s = frame();
  const blast = {
    bombId: 1,
    circle: { x: 20, y: 30, radius: 40 },
    expiresAtTick: 18,
  };
  effects.accept(s, "epoch1:match1");
  assert.equal(
    effects.accept({ ...s, blasts: [blast] }, "epoch1:match1").explosions
      .length,
    1,
  );
  assert.equal(
    effects.accept({ ...s, blasts: [blast] }, "epoch1:match1").explosions
      .length,
    0,
  );
  assert.equal(
    effects.accept({ ...s, blasts: [blast] }, "epoch2:match1").explosions
      .length,
    0,
  );
  assert.equal(
    effects.accept({ ...s, round: 2, blasts: [blast] }, "epoch2:match1")
      .explosions.length,
    0,
  );
  effects.reset();
  assert.equal(
    effects.accept({ ...s, blasts: [blast] }, "epoch2:match1").explosions
      .length,
    0,
  );
});
test("scenery cleared from the board puffs once, and a fresh board is not all rubble", () => {
  const effects = new EffectTransitions();
  const s = frame();
  const standing = {
    ...s,
    obstacles: [
      {
        id: 1,
        kind: "rock" as const,
        x: 300,
        y: 200,
        halfWidth: 40,
        halfHeight: 30,
      },
      {
        id: 2,
        kind: "tree" as const,
        x: 800,
        y: 400,
        halfWidth: 20,
        halfHeight: 20,
      },
    ],
  };
  assert.deepEqual(
    effects.accept(standing, "room:a").rubble,
    [],
    "the board it first sees is standing, not destroyed",
  );
  const cleared = { ...standing, obstacles: [standing.obstacles[1]!] };
  assert.deepEqual(
    effects.accept(cleared, "room:a").rubble.map((o) => o.id),
    [1],
    "the rock that left the board puffs where it stood",
  );
  assert.deepEqual(
    effects.accept(cleared, "room:a").rubble,
    [],
    "and only once",
  );
  // A new round lays a new board: every piece of the old one is gone, and none of it is an explosion to draw.
  assert.deepEqual(
    effects.accept({ ...cleared, round: 2, obstacles: [] }, "room:a").rubble,
    [],
  );
  effects.accept(standing, "room:b");
  assert.deepEqual(
    effects.accept({ ...standing, obstacles: [] }, "room:c").rubble,
    [],
    "nor across a match reset",
  );
});
test("bomb flight sprite follows segmented path while damage radius stays at landing point", () => {
  const bomb = {
    id: 1,
    ownerId: "p",
    launchX: 0,
    launchY: 0,
    x: 100,
    y: 100,
    launchedTick: 0,
    landsAtTick: 10,
    explodeAtTick: 50,
    blastRange: 90,
    flightPath: [
      { x: 0, y: 0, angle: 0 },
      { x: 100, y: 0, angle: 0 },
      { x: 100, y: 100, angle: 0 },
    ],
  };
  assert.deepEqual(bombPose(bomb, 2.5), { x: 50, y: 0, flight: 0.25 });
  assert.deepEqual(bombPose(bomb, 7.5), { x: 100, y: 50, flight: 0.75 });
  assert.deepEqual(bombPose(bomb, 20), { x: 100, y: 100, flight: 1 });
  assert.equal(bomb.x, 100);
  assert.equal(bomb.blastRange, 90);
});
test("death transitions occur once and backward presentation resets cosmetic history", () => {
  const effects = new EffectTransitions();
  const s = frame();
  const live = { ...s, players: s.players.map((p) => ({ ...p, alive: true })) };
  effects.accept(live, "room:a");
  const dead = {
    ...s,
    players: s.players.map((p) => ({ ...p, alive: false })),
  };
  assert.equal(effects.accept(dead, "room:a").deaths.length, 1);
  assert.equal(effects.accept(dead, "room:a").deaths.length, 0);
  effects.accept(live, "room:a");
  assert.equal(effects.accept({ ...dead, tick: 0 }, "room:a").deaths.length, 0);
});
test("flight fallback clamps before launch and shells never use bomb arcs", () => {
  const bomb = {
    id: 1,
    ownerId: "p",
    launchX: 10,
    launchY: 20,
    x: 100,
    y: 100,
    launchedTick: 5,
    landsAtTick: 15,
    explodeAtTick: 50,
    blastRange: 90,
    flightPath: [],
  };
  assert.deepEqual(bombPose(bomb, 0), { x: 10, y: 20, flight: 0 });
  assert.deepEqual(bombPose(bomb, 10), { x: 55, y: 60, flight: 0.5 });
  assert.deepEqual(bombPose({ ...bomb, shell: { vx: 20, vy: 30 } }, 10), {
    x: 100,
    y: 100,
    flight: 0.5,
  });
});
