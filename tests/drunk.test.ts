import assert from "node:assert/strict";
import test from "node:test";
import {
  DRUNK_DURATION_TICKS,
  DRUNK_CYCLE_TICKS,
  DRUNK_MAX_HEADING_OFFSET,
  drunkHeadingOffset,
} from "../src/shared/drunk.js";
import {
  addPlayer,
  createGame,
  riderMotionStep,
  startMatch,
  step,
} from "../src/shared/game.js";

const delta = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

test("integrated sway remains within 15 degrees and leaves zero heading drift for many seeded effects", () => {
  assert.equal(DRUNK_DURATION_TICKS, 80);
  assert.equal(DRUNK_CYCLE_TICKS, 40);
  assert.equal(DRUNK_MAX_HEADING_OFFSET, Math.PI / 12);
  for (let seed = 0; seed < 100; seed += 1) {
    const id = `player-${seed % 5}`;
    const start = seed * 197;
    const until = start + 80;
    let accumulated = 0;
    let previous = 0;
    for (let tick = start; tick <= until + 2; tick += 1) {
      const offset = drunkHeadingOffset(seed, id, tick, start, until);
      assert.equal(offset, drunkHeadingOffset(seed, id, tick, start, until));
      accumulated += offset - previous;
      previous = offset;
      assert.ok(Math.abs(accumulated) <= Math.PI / 12 + 1e-12);
      assert.ok(Math.abs(accumulated - offset) < 1e-12);
    }
    assert.ok(Math.abs(accumulated) < 1e-12);
  }
});

test("two-second cycle preserves phase during refresh and smooth onset/expiry", () => {
  for (const tick of [11, 15, 20, 29]) {
    assert.ok(
      Math.abs(
        drunkHeadingOffset(42, "alice", tick, 0, 80) -
          drunkHeadingOffset(42, "alice", tick + 40, 0, 80),
      ) < 1e-12,
    );
    assert.equal(
      drunkHeadingOffset(42, "alice", tick, 0, 80),
      drunkHeadingOffset(42, "alice", tick, 0, 120),
    );
  }
  assert.ok(Math.abs(drunkHeadingOffset(42, "alice", 1, 0, 80)) < 0.01);
  assert.ok(Math.abs(drunkHeadingOffset(42, "alice", 79, 0, 80)) < 0.01);
  for (const tick of [-1, 0, 80, 81, NaN, Infinity])
    assert.equal(drunkHeadingOffset(42, "alice", tick, 0, 80), 0);
  assert.notEqual(
    drunkHeadingOffset(42, "alice", 20, 0, 80),
    drunkHeadingOffset(42, "bob", 20, 0, 80),
  );
});

test("engine adds bounded sway to ordinary steering and restores intended heading at expiry", () => {
  const game = createGame("bounded-drunk", 42);
  for (let slot = 0; slot < 2; slot += 1)
    addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: "#fff" });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  const player = game.players.get("p0")!;
  const other = game.players.get("p1")!;
  player.drunkStartedTick = game.tick;
  player.drunkUntilTick = game.tick + 80;
  let intended = player.angle;
  for (let tick = 1; tick <= 82; tick += 1) {
    // Keep geometry out of this heading invariant; wall reactions are covered separately.
    player.x = 700;
    player.y = 400;
    player.trail = [];
    other.x = 1200;
    other.y = 700;
    other.trail = [];
    other.angle = 0;
    const direction = tick % 3 === 0 ? 1 : -1;
    intended +=
      direction *
      riderMotionStep(player, game.tick + 1, game.roundStartedTick).turn;
    step(
      game,
      new Map([
        ["p0", { left: direction < 0, right: direction > 0, bomb: false }],
      ]),
    );
    assert.ok(Math.abs(delta(player.angle, intended)) <= Math.PI / 12 + 1e-10);
    if (tick >= 80) assert.ok(Math.abs(delta(player.angle, intended)) < 1e-10);
  }
});

test("late refresh stays bounded and leaves no residual at the extended deadline", () => {
  let accumulated = 0;
  let previous = 0;
  for (let tick = 0; tick <= 151; tick += 1) {
    const until = tick < 71 ? 80 : 151;
    const offset = drunkHeadingOffset(321, "refreshed", tick, 0, until);
    accumulated += offset - previous;
    previous = offset;
    assert.ok(Math.abs(accumulated) <= Math.PI / 12 + 1e-12);
  }
  assert.ok(Math.abs(accumulated) < 1e-12);
});
