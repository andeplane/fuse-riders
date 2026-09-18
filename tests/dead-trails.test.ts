import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import { BotController } from "../src/engine/bot-controller.js";
import {
  COUNTDOWN_TICKS,
  SLOT_COLORS,
  TRAIL_LIFETIME_TICKS,
  addPlayer,
  createGame,
  eliminatePlayer,
  startMatch,
  startNextRound,
  step,
  type GameState,
  type InputIntent,
} from "../src/engine/game.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import { setArmed, setDeadlines, setEffect } from "./fixtures/rider-state.ts";

const neutral: InputIntent = { left: false, right: false, bomb: false };
function fixture() {
  const game = createGame("dead-trails", classicSettings(), 42);
  for (let slot = 0; slot < 4; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  const dead = game.players.get("p0")!,
    survivor = game.players.get("p1")!;
  Object.assign(dead, { x: 500, y: 450, angle: 0 });
  Object.assign(survivor, { x: 1100, y: 650, angle: 0 });
  Object.assign(game.players.get("p2")!, { x: 1100, y: 750, angle: 0 });
  Object.assign(game.players.get("p3")!, { x: 1300, y: 750, angle: 0 });
  for (const player of game.players.values()) player.trail = [];
  dead.trail = [
    {
      x1: 200,
      y1: 200,
      x2: 300,
      y2: 200,
      createdTick: 0,
      expiresAtTick: game.tick + 3,
    },
  ];
  return { game, dead, survivor };
}

function advanceWithSurvivors(game: GameState, ticks: number) {
  for (const player of game.players.values())
    if (player.alive) setEffect(player, "star", game.tick + ticks + 100);
  for (let i = 0; i < ticks; i++) {
    step(game, new Map());
    assert.equal(game.phase, "playing", "two survivors keep the round running");
  }
}

for (const cause of ["leave", "wall", "trail", "rider", "bomb"] as const) {
  test(`${cause} elimination pauses then erodes the remaining trail and clears it next round`, () => {
    const { game, dead, survivor } = fixture();
    if (cause === "leave") eliminatePlayer(game, dead.id);
    if (cause === "wall")
      Object.assign(dead, { x: game.boundaryInset + 1, angle: Math.PI });
    if (cause === "trail")
      survivor.trail = [
        {
          x1: 510,
          y1: 400,
          x2: 510,
          y2: 500,
          createdTick: game.tick,
          expiresAtTick: game.tick + 100,
        },
      ];
    if (cause === "rider")
      Object.assign(survivor, { x: 510, y: 450, angle: Math.PI });
    if (cause === "bomb") {
      game.bombs.set(1, {
        id: 1,
        ownerId: survivor.id,
        x: 500,
        y: 450,
        launchX: 500,
        launchY: 450,
        launchedTick: game.tick,
        landsAtTick: game.tick,
        explodeAtTick: game.tick + 1,
        blastRange: 90,
        flightPath: [{ x: 500, y: 450, angle: 0 }],
      });
      game.nextBombId = 2;
    }
    step(game, new Map());
    assert.equal(dead.alive, false);
    assert.ok(dead.trail.length > 0);
    if (cause === "trail" || cause === "rider")
      assert.equal(
        dead.trail.at(-1)!.x2,
        dead.x,
        "fatal contact segment is kept",
      );
    const trail = structuredClone(dead.trail),
      pose = { x: dead.x, y: dead.y, angle: dead.angle };
    advanceWithSurvivors(game, 10);
    assert.deepEqual(dead.trail, trail, "pause ignores original expiry");
    assert.deepEqual({ x: dead.x, y: dead.y, angle: dead.angle }, pose);
    const restored = decodeGameState(encodeGameState(game));
    assert.ok(restored, "decaying trails survive checkpoint validation");
    for (let i = 0; i < 10; i++)
      assert.deepEqual(
        step(restored, new Map()),
        step(game, new Map()),
        "restored replay agrees",
      );
    assert.equal(encodeGameState(restored), encodeGameState(game));
    advanceWithSurvivors(game, 80);
    assert.deepEqual(dead.trail, [], "both ends eventually meet");
    for (const player of game.players.values())
      if (player.alive && player.id !== "p2") eliminatePlayer(game, player.id);
    step(game, new Map());
    assert.equal(game.phase, "roundOver");
    while (game.tick < game.phaseEndsAtTick!) step(game, new Map());
    assert.deepEqual(dead.trail, [], "eroded trail stays gone");
    startNextRound(game);
    assert.deepEqual(dead.trail, []);
    assert.equal(dead.alive, true);
  });
}

test("a dead trail past its original expiry still kills crossing riders and is avoided by bots", () => {
  const { game, dead, survivor } = fixture();
  eliminatePlayer(game, dead.id);
  advanceWithSurvivors(game, 10);
  Object.assign(survivor, {
    x: 250,
    y: 160,
    angle: Math.PI / 2,
    trail: [],
  });
  setEffect(survivor, "star", 0);
  const input = new BotController({ random: () => 0.25 }).input(
    game,
    survivor.id,
  );
  assert.ok(input.left || input.right, "bots see the persistent obstacle");
  survivor.y = 193;
  const result = step(game, new Map());
  assert.equal(survivor.alive, false);
  assert.ok(
    result.events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === survivor.id &&
        event.cause === "trail",
    ),
  );
});

test("explosions can still destroy a dead trail after its original expiry", () => {
  const { game, dead, survivor } = fixture();
  eliminatePlayer(game, dead.id);
  advanceWithSurvivors(game, 10);
  assert.ok(
    game.tick > dead.trail[0]!.expiresAtTick,
    "the trail has outlived its original expiry",
  );
  assert.ok(dead.trail.length > 0, "and is still on the board");
  // A landed bomb whose fuse runs out on the next step, right on top of the dead trail.
  game.bombs.set(1, {
    id: 1,
    ownerId: survivor.id,
    x: 250,
    y: 200,
    launchX: 250,
    launchY: 200,
    launchedTick: game.tick,
    landsAtTick: game.tick,
    explodeAtTick: game.tick + 1,
    blastRange: 90,
    flightPath: [{ x: 250, y: 200, angle: 0 }],
  });
  game.nextBombId = 2;
  step(game, new Map());
  assert.equal(game.bombs.size, 0, "the bomb went off");
  assert.deepEqual(dead.trail, []);
});

test("round results freeze remaining decay and round reset clears the pieces", () => {
  const { game, dead } = fixture();
  eliminatePlayer(game, dead.id);
  for (const player of game.players.values())
    if (player.id !== "p2") eliminatePlayer(game, player.id);
  step(game, new Map());
  const final = structuredClone(dead.trail);
  assert.equal(game.phase, "roundOver");
  while (game.tick < game.phaseEndsAtTick!) step(game, new Map());
  assert.deepEqual(dead.trail, final);
  startNextRound(game);
  assert.deepEqual(dead.trail, []);
  assert.equal(game.nextTrailPieceId, 1);
});

test("riders can pass through space eroded before this tick collision check", () => {
  const { game, dead, survivor } = fixture();
  dead.trail = [
    {
      x1: 200,
      y1: 200,
      x2: 500,
      y2: 200,
      createdTick: 0,
      expiresAtTick: game.tick + 3,
    },
  ];
  eliminatePlayer(game, dead.id);
  advanceWithSurvivors(game, 80);
  assert.equal(dead.trail[0]!.x1, 237.5);
  Object.assign(survivor, {
    x: 220,
    y: 193,
    angle: Math.PI / 2,
    trail: [],
  });
  setEffect(survivor, "star", 0);
  step(game, new Map());
  assert.equal(survivor.alive, true);
});

for (const weapon of ["bomb", "gun"] as const) {
  test(`${weapon} cuts detach older history, preserve active suffix and allow full boosted regrowth`, () => {
    const { game, dead: rider, survivor } = fixture();
    rider.trail = Array.from({ length: 20 }, (_, i) => ({
      x1: 200 + i * 15,
      y1: 200,
      x2: 215 + i * 15,
      y2: 200,
      createdTick: game.tick - 20 + i,
      expiresAtTick: game.tick + 20 + i,
    }));
    rider.powerPickups = 4;
    let inputs = new Map<string, InputIntent>();
    if (weapon === "gun") {
      Object.assign(survivor, {
        x: 350,
        y: 160,
        angle: Math.PI / 2,
        trail: [],
      });
      setArmed(survivor, "gun", true);
      inputs = new Map([
        [
          survivor.id,
          {
            ...neutral,
            bombCommands: [{ action: "press" }, { action: "release" }],
          },
        ],
      ]);
    } else {
      game.bombs.set(1, {
        id: 1,
        ownerId: survivor.id,
        x: 350,
        y: 200,
        launchX: 350,
        launchY: 200,
        launchedTick: game.tick,
        landsAtTick: game.tick,
        explodeAtTick: game.tick + 1,
        blastRange: 25,
        flightPath: [{ x: 350, y: 200, angle: 0 }],
      });
      game.nextBombId = 2;
    }
    step(game, inputs);
    assert.equal(rider.alive, true);
    assert.ok(rider.trail[0]!.detached, "older cut-off piece decays");
    assert.equal(
      rider.trail.at(-1)!.detached,
      undefined,
      "newest tail remains active",
    );
    const start = rider.trail[0]!.detached!.decayStartTick;
    setDeadlines(rider, "nitro", [game.tick + 60]);
    advanceWithSurvivors(game, 330);
    assert.equal(
      rider.trail.length,
      320,
      "full Power-adjusted moving trail returns",
    );
    assert.ok(rider.trail.every((s) => !s.detached));
    assert.equal(start < game.tick, true);
  });
}
