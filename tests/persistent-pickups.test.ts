import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import {
  addPlayer,
  createGame,
  startMatch,
  startNextRound,
  step,
  eliminatePlayer,
  toView,
  COUNTDOWN_TICKS,
  ROUND_DRAW_TICK,
  SLOT_COLORS,
  type GameState,
  type PickupType,
} from "../src/engine/game.js";
import { classicSettings } from "./fixtures/classic-settings.js";

function playing(): GameState {
  const game = createGame("persistent-pickups", classicSettings(), 42);
  for (let i = 0; i < 2; i++)
    addPlayer(game, {
      id: `p${i}`,
      name: `P${i}`,
      slot: i,
      color: SLOT_COLORS[i]!,
    });
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  for (const [i, player] of [...game.players.values()].entries()) {
    player.x = 500 + 700 * i;
    player.y = 700;
    player.angle = 0;
    player.trail = [];
  }
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return game;
}

function pickup(
  game: GameState,
  x: number,
  y: number,
  type: PickupType = "power",
): number {
  const id = game.nextPickupId++;
  game.pickups.push({ id, type, x, y, expiresAtTick: Number.MAX_SAFE_INTEGER });
  return id;
}

function bomb(
  game: GameState,
  x: number,
  y: number,
  radius: number,
  delay = 1,
): void {
  const id = game.nextBombId++;
  game.bombs.set(id, {
    id,
    ownerId: "p0",
    x,
    y,
    launchX: x,
    launchY: y,
    launchedTick: game.tick,
    placedTick: game.tick,
    landsAtTick: game.tick,
    explodeAtTick: game.tick + delay,
    blastRange: radius,
    flightPath: [{ x, y, angle: 0 }],
  });
}

test("spawned pickups survive the old timeout and late round, then reset with the round", () => {
  const game = playing();
  game.nextPickupSpawnTick = game.tick + 1;
  step(game, new Map());
  const spawned = game.pickups[0]!;
  assert.ok(spawned);
  assert.equal(spawned.expiresAtTick, Number.MAX_SAFE_INTEGER);
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  for (const elapsed of [301, ROUND_DRAW_TICK - 1]) {
    game.tick = game.roundStartedTick! + elapsed - 1;
    step(game, new Map());
    assert.ok(game.pickups.some((p) => p.id === spawned.id));
    assert.ok(toView(game).pickups.some((p) => p.id === spawned.id));
  }
  if (game.phase === "playing") {
    eliminatePlayer(game, "p1");
    step(game, new Map());
  }
  game.tick = game.phaseEndsAtTick!;
  startNextRound(game);
  assert.deepEqual(game.pickups, []);
});

test("blast destruction is strictly inside 60% of the actual radius, using center distance", () => {
  for (const radius of [50, 100, 250]) {
    const game = playing();
    const edge = radius * 0.6;
    pickup(game, 800, 400, "grip");
    pickup(game, 800 + edge - 0.01, 400, "star");
    const boundary = pickup(game, 800 + edge, 400, "extraBomb");
    const fringe = pickup(game, 800 + edge + 0.01, 400, "shell");
    const diagonal = pickup(game, 800 + radius * 0.5, 400 + radius * 0.5);
    const outside = pickup(game, 800 + radius + 1, 400);
    bomb(game, 800, 400, radius);
    const result = step(game, new Map());
    assert.deepEqual(
      toView(game).pickups.map((p) => p.id),
      [boundary, fringe, diagonal, outside],
    );
    assert.equal(
      result.events.filter((e) => e.type === "pickupCollected").length,
      0,
    );
    assert.equal(game.matchStats.get("p0")!.pickupsCollected, 0);
  }
});

test("chained bombs destroy pickups and replay identically from a checkpoint", () => {
  const game = playing();
  pickup(game, 800, 400);
  pickup(game, 930, 400, "beer");
  const survivor = pickup(game, 1000, 400);
  bomb(game, 800, 400, 150);
  bomb(game, 930, 400, 100, 100);
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  const result = step(game, new Map());
  assert.equal(result.events.filter((e) => e.type === "explosion").length, 2);
  assert.deepEqual(
    game.pickups.map((p) => p.id),
    [survivor],
  );
  assert.deepEqual(step(restored, new Map()), result);
  assert.equal(encodeGameState(restored), encodeGameState(game));
  assert.ok(decodeGameState(encodeGameState(game)));
  // The blast picture remains, but it does not burn later arrivals.
  const later = pickup(game, 930, 400);
  step(game, new Map());
  assert.ok(game.pickups.some((p) => p.id === later));
});

test("collection wins before a same-tick explosion and destruction frees a spawn slot", () => {
  const game = playing();
  pickup(game, 503, 700, "star");
  pickup(game, 540, 700);
  bomb(game, 503, 700, 100);
  const result = step(game, new Map());
  assert.equal(
    result.events.filter((e) => e.type === "pickupCollected").length,
    1,
  );
  assert.equal(game.players.get("p0")!.alive, true);
  assert.equal(game.matchStats.get("p0")!.pickupsCollected, 1);
  assert.deepEqual(game.pickups, []);
  game.nextPickupSpawnTick = game.tick + 1;
  step(game, new Map());
  assert.equal(game.pickups.length, 1);
});
