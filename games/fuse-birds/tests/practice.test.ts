import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  createMatch,
  decodeState,
  encodeState,
  getView,
  hashState,
  PRACTICE_RULES,
  RULES,
  UNIT,
} from "../src/engine/index.js";
import { PracticeRuntime } from "../src/app/practice.js";
import type { WorldView } from "../src/engine/view.js";

test("one-player practice keeps a stationary launcher active through repeated shots and idle time", () => {
  const match = createMatch("practice", 123, [{ id: "solo", name: "YOU" }]);
  advance(match);
  assert.equal(match.rules, PRACTICE_RULES);
  assert.equal(match.phase, "aiming");
  assert.equal(match.players.length, 1);
  assert.equal(match.players[0]!.x, 768 * UNIT);
  const position = { x: match.players[0]!.x, y: match.players[0]!.y };
  assert.equal(getView(match).progress, 1);
  for (let i = 0; i < 1200; i++) advance(match);
  assert.equal(match.turn, 1, "practice never times out");
  assert.equal(getView(match).timeLeft, 0);
  assert.ok(
    decodeState(encodeState(match)),
    "checkpoint remains valid past the battle deadline",
  );
  for (let shot = 0; shot < 20; shot++) {
    const player = match.players[0]!;
    const turn: number = match.turn;
    advance(match, [
      {
        actor: player.id,
        round: match.round,
        turn,
        ordinal: player.ordinal + 1,
        type: "launch",
        weapon: shot < 3 ? "scatter" : "pebble",
        vx: 0,
        vy: 1024,
      },
    ]);
    for (let ticks = 0; ticks < 400 && match.turn === turn; ticks++)
      advance(match);
    assert.equal(match.turn, turn + 1);
    assert.equal(match.phase, "aiming");
    assert.equal(player.hp, 100, "self hits do not end practice");
    assert.deepEqual({ x: player.x, y: player.y }, position);
  }
  assert.ok(match.terrain.version > 0);
  assert.equal(match.players[0]!.ammo, 0);
  assert.equal(match.water, 705);
  assert.equal(match.winner, null);
  const restored = decodeState(encodeState(match))!;
  advance(match);
  advance(restored);
  assert.equal(hashState(restored), hashState(match));
});

test("practice and multiplayer checkpoint identities cannot be interchanged", () => {
  const practice = createMatch("practice", 1, [{ id: "solo", name: "YOU" }]);
  assert.equal(
    decodeState({ ...encodeState(practice), rules: RULES }),
    undefined,
  );
  const battle = createMatch("battle", 1, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  assert.equal(
    decodeState({ ...encodeState(battle), rules: PRACTICE_RULES }),
    undefined,
  );
});

test("local practice queues one input, pauses hidden time, resets ammo/map and stops idempotently", () => {
  let step = () => {},
    active = true,
    cancelled = 0,
    latest: WorldView | null = null;
  const runtime = new PracticeRuntime(
    {
      ready: (id) => assert.equal(id, "solo"),
      status: () => {},
      event: () => {},
      state: (frame) => {
        latest = frame.world;
        assert.equal(frame.seats.length, 1);
        assert.equal(frame.seats[0]!.bot, false);
      },
    },
    {
      name: "YOU",
      seed: 123,
      active: () => active,
      schedule: (tick) => {
        step = tick;
        return () => {
          cancelled++;
        };
      },
    },
  );
  const view = (): WorldView => {
    assert.ok(latest);
    return latest;
  };
  runtime.start();
  runtime.start();
  step();
  assert.equal(view().phase, "aiming");
  const tick = view().tick;
  active = false;
  step();
  assert.equal(view().tick, tick);
  active = true;
  const shot = { type: "launch", weapon: "scatter", vx: 0, vy: 1024 } as const;
  assert.equal(runtime.play(shot), true);
  assert.equal(runtime.play(shot), false);
  step();
  assert.equal(view().players[0]!.ammo, 2);
  const round = view().round;
  assert.equal(runtime.command({ type: "action", action: "rematch" }), true);
  step();
  assert.equal(view().round, round + 1);
  assert.equal(view().players[0]!.ammo, 3);
  runtime.stop();
  runtime.stop();
  const stoppedTick = view().tick;
  step();
  assert.equal(view().tick, stoppedTick);
  assert.equal(cancelled, 1);
  assert.equal(runtime.play(shot), false);
});
