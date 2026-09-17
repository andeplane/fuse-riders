import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BotController } from "../src/shared/bot-controller.js";
import {
  applyTick,
  createRoomState,
  hashRoomState,
  type RoomState,
  type StreamEntries,
} from "../src/shared/apply-tick.js";
import {
  defaultRoomSettings,
  roomPickup,
} from "../src/shared/room-settings.js";
import {
  PICKUP_TYPES,
  SLOT_COLORS,
  addPlayer,
  createGame,
  startMatch,
  step,
  type GameState,
} from "../src/shared/game.js";
import type { Obstacle } from "../src/shared/arena-map.js";
import type { Recording } from "./fixtures/replay-log.js";

test("every weighted pickup interval is independent of object insertion order", () => {
  const weights = Object.fromEntries(
    PICKUP_TYPES.map((type, index) => [type, index + 1]),
  );
  const reversed = Object.fromEntries(Object.entries(weights).reverse());
  for (let sample = 0; sample < 1000; sample++)
    assert.equal(
      roomPickup(sample / 1000, weights),
      roomPickup(sample / 1000, reversed),
    );
});

/**
 * Maps, Sets and weight objects lose their insertion order in the canonical hash and in a checkpoint, so they are
 * simply reversed. Obstacles and pickups are arrays, whose order the hash does keep; both are generated in id order,
 * so they are reversed before the tick and put back in id order after it. Reading either in array order would then
 * show up as a different outcome. Blasts, portal pairs, gravity fields, trails, shots and moments are sequences: their
 * order is the order things happened in, which is state in its own right rather than an accident of construction.
 */
function permute(state: RoomState): void {
  state.game.obstacles = [...state.game.obstacles].reverse();
  state.game.pickups = [...state.game.pickups].reverse();
  state.game.players = new Map([...state.game.players].reverse());
  state.game.bombs = new Map([...state.game.bombs].reverse());
  state.game.matchStats = new Map([...state.game.matchStats].reverse());
  state.folds = new Map([...state.folds].reverse());
  state.bots = new Set([...state.bots].reverse());
  state.settings.weights = Object.fromEntries(
    Object.entries(state.settings.weights).reverse(),
  );
  if (state.game.settings)
    state.game.settings.weights = Object.fromEntries(
      Object.entries(state.game.settings.weights).reverse(),
    );
}

test("the whole mechanic replay survives reversed map and settings insertion order at every tick", () => {
  const recording: Recording = JSON.parse(
    readFileSync(
      new URL("./fixtures/mechanics-recording.json", import.meta.url),
      "utf8",
    ),
  );
  const golden: { hashes: string[] } = JSON.parse(
    readFileSync(
      new URL("./fixtures/golden-hashes.json", import.meta.url),
      "utf8",
    ),
  );
  const state = createRoomState(recording.matchId, defaultRoomSettings());
  const bots = new BotController();
  let bombTicks = 0,
    obstacleTicks = 0,
    pickupTicks = 0;
  for (let tick = 1; tick <= recording.ticks; tick++) {
    const streams = new Map<string, StreamEntries>(
      Object.entries(recording.entries)
        .reverse()
        .map(([member, entries]) => [
          member,
          {
            generation: 1,
            entries: entries.filter((entry) => entry[1] === tick),
          },
        ]),
    );
    for (const list of [state.game.obstacles, state.game.pickups])
      assert.deepEqual(
        list.map((item) => item.id),
        list.map((item) => item.id).sort((a, b) => a - b),
        "the engine keeps obstacles and pickups in id order",
      );
    if (state.game.phase === "playing") {
      if (state.game.obstacles.length > 1) obstacleTicks++;
      if (state.game.pickups.length > 1) pickupTicks++;
    }
    permute(state);
    applyTick(state, recording.creator, streams, bots);
    state.game.obstacles.sort((a, b) => a.id - b.id);
    state.game.pickups.sort((a, b) => a.id - b.id);
    if (state.game.bombs.size > 1) bombTicks++;
    assert.equal(
      hashRoomState(state),
      golden.hashes[tick - 1],
      `insertion order changed tick ${tick}`,
    );
  }
  assert.ok(bombTicks > 0, "the workload exercises concurrent bombs");
  assert.ok(obstacleTicks > 0, "the workload plays among several obstacles");
  assert.ok(pickupTicks > 0, "the workload plays among several pickups");
});

/** A started round with two riders facing along one lane, and the scenery the test lays across it. */
function lane(obstacles: Obstacle[]): GameState {
  const game = createGame("order", 11);
  for (let slot = 0; slot < 2; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  game.obstacles = obstacles;
  for (const player of game.players.values())
    Object.assign(player, {
      x: 301.7,
      y: 449.3 + player.slot * 300,
      angle: 0.013,
      trail: [],
    });
  return game;
}

test("a gun ray stops at the same point whichever order the scenery in its line is stored in", () => {
  // The contact bisection starts from the contact found before it, so visiting the far rock first used to move the
  // low bits of where the near rock stopped the bullet.
  const rocks: Obstacle[] = [
    { id: 1, kind: "rock", x: 703.1, y: 450, halfWidth: 41.3, halfHeight: 200 },
    {
      id: 2,
      kind: "rock",
      x: 1103.7,
      y: 450,
      halfWidth: 39.9,
      halfHeight: 200,
    },
  ];
  const tracers = [rocks, [...rocks].reverse()].map((obstacles) => {
    const game = lane(obstacles);
    game.players.get("p0")!.gunArmed = true;
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
    const tracer = [...game.bombs.values()].find((bomb) => bomb.shell?.gun)!;
    return { x: tracer.x, y: tracer.y };
  });
  assert.ok(tracers[0]!.x > 600 && tracers[0]!.x < 703.1 - 41.3 + 1e-6);
  assert.deepEqual(tracers[1], tracers[0]);
});
