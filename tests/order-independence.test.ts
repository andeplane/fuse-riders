import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BotController } from "../src/engine/bot-controller.js";
import {
  applyTick,
  createRoomState,
  hashRoomState,
  type RoomState,
} from "../src/engine/apply-tick.js";
import {
  defaultRoomSettings,
  roomPickup,
} from "../src/engine/room-settings.js";
import {
  PICKUP_TYPES,
  SLOT_COLORS,
  addPlayer,
  createGame,
  startMatch,
  step,
  type GameState,
} from "../src/engine/game.js";
import type { Obstacle } from "../src/engine/arena-map.js";
import { streamReader, type Recording } from "./fixtures/replay-log.js";
import { classicSettings } from "./fixtures/classic-settings.js";

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

/** Keys in descending order: never the order the engine builds anything in, and the same however often it is applied. */
const descending = <K extends string | number>(a: K, b: K): number =>
  typeof a === "number" && typeof b === "number"
    ? b - a
    : String(a) < String(b)
      ? 1
      : -1;
const backwardsMap = <K extends string | number, V>(
  map: Map<K, V>,
): Map<K, V> => new Map([...map].sort(([a], [b]) => descending(a, b)));
const backwardsKeys = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => descending(a, b)),
  ) as T;

/**
 * Maps, Sets and id-keyed objects lose their insertion order in the canonical hash and in a checkpoint, so before
 * every tick each is rebuilt in descending key order: the seats, the bombs, the match statistics and the per-rival
 * tallies inside them, the session leaderboard, the round's participants, the folds, the bots and both copies of the
 * pickup weights. Rebuilt, not reversed: a Map the engine leaves alone would be back in its own order every second
 * tick if it were only turned over. Obstacles and pickups are arrays, whose order the hash does keep; both are
 * generated in id order, so they are reversed before the tick and put back in id order after it. Reading either in
 * array order would then show up as a different outcome. Blasts, portal pairs, gravity fields, trails, shots, moments,
 * placements and rating standings are sequences: their order is the order things happened in or were ranked in,
 * which is state in its own right rather than an accident of construction.
 */
function permute(state: RoomState): void {
  state.game.obstacles = [...state.game.obstacles].reverse();
  state.game.pickups = [...state.game.pickups].reverse();
  state.game.players = backwardsMap(state.game.players);
  state.game.bombs = backwardsMap(state.game.bombs);
  state.game.matchStats = backwardsMap(state.game.matchStats);
  for (const entry of state.game.matchStats.values())
    if (entry.combat) {
      entry.combat.victims = backwardsKeys(entry.combat.victims);
      entry.combat.killers = backwardsKeys(entry.combat.killers);
    }
  state.game.leaderboard = backwardsMap(state.game.leaderboard);
  state.game.roundParticipants = backwardsMap(state.game.roundParticipants);
  state.folds = backwardsMap(state.folds);
  state.bots = new Set([...state.bots].sort(descending));
  state.settings.weights = backwardsKeys(state.settings.weights);
  if (state.game.settings)
    state.game.settings.weights = backwardsKeys(state.game.settings.weights);
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
  const streams = streamReader(recording.entries, (members) =>
    [...members].reverse(),
  );
  let bombTicks = 0,
    obstacleTicks = 0,
    pickupTicks = 0,
    tiedRounds = 0;
  for (let tick = 1; tick <= recording.ticks; tick++) {
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
    const events = applyTick(state, recording.creator, streams(tick), bots);
    if (
      events.some((event) => event.type === "roundEnded") &&
      new Set(state.game.roundPlacements.map(({ place }) => place)).size <
        state.game.roundPlacements.length
    )
      tiedRounds++;
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
  assert.ok(
    tiedRounds > 0,
    "the workload ranks riders that share a place, whose order in the placements is the seats' and not a Map's",
  );
});

/** A started round with two riders facing along one lane, and the scenery the test lays across it. */
function lane(obstacles: Obstacle[]): GameState {
  const game = createGame("order", classicSettings(), 11);
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

test("a rider dies at the same point against scenery whichever order the obstacles in its step are stored in", () => {
  // Two rocks abreast of the lane, the second a few units further on, both inside one step of the rider. Each contact
  // bisection starts from the contact found before it, so visiting the far rock first used to move the low bits of
  // where the near one stopped the rider.
  const rocks: Obstacle[] = [
    {
      id: 1,
      kind: "rock",
      x: 351.3,
      y: 350.1,
      halfWidth: 41.3,
      halfHeight: 100,
    },
    {
      id: 2,
      kind: "rock",
      x: 352.9,
      y: 550.3,
      halfWidth: 41.3,
      halfHeight: 100,
    },
  ];
  const wrecks = [rocks, [...rocks].reverse()].map((obstacles) => {
    const game = lane(obstacles);
    const result = step(game, new Map());
    assert.ok(
      result.events.some(
        (event) =>
          event.type === "playerEliminated" &&
          event.playerId === "p0" &&
          event.cause === "wall",
      ),
      "the rider crashes into the scenery",
    );
    const { x, y } = game.players.get("p0")!;
    return { x, y };
  });
  assert.ok(wrecks[0]!.x > 301.7 && wrecks[0]!.x < 351.3 - 41.3);
  assert.deepEqual(wrecks[1], wrecks[0]);
});

test("a shield turns a rider away from the same obstacle whichever order two it reaches at once are stored in", () => {
  // Two trees mirrored about the lane are reached at exactly the same instant, and their faces lean opposite ways.
  // The contact loop keeps the last obstacle to match the earliest contact, which is the higher id and not whichever
  // happens to be stored last.
  const trees: Obstacle[] = [
    { id: 1, kind: "tree", x: 340, y: 430, halfWidth: 30, halfHeight: 30 },
    { id: 2, kind: "tree", x: 340, y: 470, halfWidth: 30, halfHeight: 30 },
  ];
  const headings = [trees, [...trees].reverse()].map((obstacles) => {
    const game = lane(obstacles);
    Object.assign(game.players.get("p0")!, {
      x: 312,
      y: 450,
      angle: 0,
      shielded: true,
    });
    step(game, new Map());
    const rider = game.players.get("p0")!;
    assert.ok(rider.alive && !rider.shielded, "the shield absorbs the crash");
    return rider.angle;
  });
  assert.notEqual(headings[0], 0, "the rider is turned away");
  assert.equal(headings[1], headings[0]);
});

test("a shell against two pieces of scenery at once reflects the same way whichever order they are stored in", () => {
  // A shell that starts its tick touching both a rock's face and a crate's corner meets both at time zero. The first
  // contact wins a tie and its reflection takes the shell off the other, so the order the walls are read in decides
  // which way it goes.
  const scenery: Obstacle[] = [
    { id: 1, kind: "rock", x: 700, y: 500, halfWidth: 100, halfHeight: 100 },
    { id: 2, kind: "crate", x: 570, y: 540, halfWidth: 20, halfHeight: 20 },
  ];
  const shells = [scenery, [...scenery].reverse()].map((obstacles) => {
    const game = lane(obstacles);
    game.bombs.set(1, {
      id: 1,
      ownerId: "p0",
      launchX: 500,
      launchY: 500,
      x: 588,
      y: 506,
      launchedTick: game.tick - 5,
      placedTick: game.tick - 5,
      landsAtTick: Number.MAX_SAFE_INTEGER,
      explodeAtTick: Number.MAX_SAFE_INTEGER,
      blastRange: 0,
      flightPath: [],
      shell: { vx: 440, vy: 90 },
    });
    step(game, new Map());
    const shell = game.bombs.get(1)!;
    return { x: shell.x, y: shell.y, ...shell.shell };
  });
  assert.ok((shells[0]!.bounces ?? 0) > 0, "the shell bounces off the scenery");
  assert.deepEqual(shells[1], shells[0]);
});

test("riders that share a place are listed in seat order whichever order the round's participants are stored in", () => {
  // Both riders cross the boundary on the same tick. `rankRound` lists tied riders in the order it is given, and
  // the placements — and the rating standings frozen from them — are state every replica compares.
  const placements = [false, true].map((reversed) => {
    const game = lane([]);
    for (const player of game.players.values())
      Object.assign(player, { x: game.width - 24, angle: 0 });
    if (reversed)
      game.roundParticipants = new Map([...game.roundParticipants].reverse());
    const { events } = step(game, new Map());
    assert.deepEqual(
      events.filter((event) => event.type === "roundEnded"),
      [{ type: "roundEnded" }],
      "both die on one tick and the round is drawn",
    );
    return {
      placements: game.roundPlacements,
      standings: game.decidedRound?.rating?.standings,
    };
  });
  assert.deepEqual(
    placements[0]!.placements.map(({ playerId, place }) => [playerId, place]),
    [
      ["p0", 1],
      ["p1", 1],
    ],
  );
  assert.deepEqual(placements[1], placements[0]);
});
