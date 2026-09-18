import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlayer,
  createGame,
  startMatch,
  step,
  INK_DURATION_TICKS,
  toSnapshot,
  eliminatePlayer,
  startNextRound,
} from "../src/engine/game.js";
import { classicSettings } from "./fixtures/classic-settings.js";

function playing() {
  const game = createGame("ink", classicSettings(), 42);
  for (let slot = 0; slot < 4; slot += 1)
    addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: "#fff" });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  // An open board: these riders are parked on a line and expected to keep driving straight.
  game.obstacles = [];
  for (const player of game.players.values())
    Object.assign(player, {
      x: 300 + player.slot * 250,
      y: 450,
      angle: 0,
      trail: [],
    });
  return game;
}

test("Ink affects only other living riders, refreshes three seconds and snapshots without changing steering", () => {
  const game = playing();
  const control = playing();
  const collector = game.players.get("p0")!;
  collector.inkUntilTick = game.tick + 8;
  game.players.get("p3")!.alive = false;
  control.players.get("p3")!.alive = false;
  game.pickups.push({
    id: 1,
    type: "ink",
    x: collector.x + 3,
    y: collector.y,
    expiresAtTick: game.tick + 100,
  });
  const inputs = new Map([["p1", { left: true, right: false, bomb: false }]]);
  const priorDeadline = collector.inkUntilTick;
  step(game, inputs);
  step(control, inputs);
  assert.equal(INK_DURATION_TICKS, 60);
  assert.equal(
    collector.inkUntilTick,
    priorDeadline,
    "own pickup does not cure an existing effect",
  );
  assert.equal(game.players.get("p3")!.inkUntilTick, 0);
  for (const id of ["p1", "p2"]) {
    const player = game.players.get(id)!;
    const ordinary = control.players.get(id)!;
    assert.equal(player.inkUntilTick, game.tick + 60);
    assert.deepEqual(
      [player.x, player.y, player.angle, player.alive],
      [ordinary.x, ordinary.y, ordinary.angle, ordinary.alive],
    );
    assert.equal(
      toSnapshot(game).players.find((entry) => entry.id === id)!.inkUntilTick,
      player.inkUntilTick,
    );
  }
  assert.equal(game.matchStats.get("p0")!.inkPickups, 1);
  game.pickups.push({
    id: 2,
    type: "ink",
    x: collector.x + 3,
    y: collector.y,
    expiresAtTick: game.tick + 100,
  });
  step(game, new Map());
  assert.equal(
    game.players.get("p1")!.inkUntilTick,
    game.tick + 60,
    "refresh never stacks duration",
  );
  const deadline = game.players.get("p1")!.inkUntilTick;
  while (game.tick < deadline) step(game, new Map());
  assert.equal(
    game.players.get("p1")!.inkUntilTick > game.tick,
    false,
    "deadline is exclusive",
  );
});

test("Ink clears at the next round", () => {
  const game = playing();
  game.players.get("p0")!.inkUntilTick = game.tick + 60;
  for (const id of ["p1", "p2", "p3"]) eliminatePlayer(game, id);
  step(game, new Map());
  game.tick = game.phaseEndsAtTick!;
  startNextRound(game);
  assert.ok(
    toSnapshot(game).players.every((player) => player.inkUntilTick === 0),
  );
});
