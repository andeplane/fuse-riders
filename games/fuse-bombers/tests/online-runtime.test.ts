import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import { FIRE, LEFT, UP, type TickEvent } from "../src/engine/index.js";
import { DEFAULT_SETTINGS, PLAY, PRESS } from "../src/online/game.js";
import { BombersRuntime } from "../src/online/runtime.js";

/** The runtime as a test reads it: its own log and the shared clock. */
class Probe extends BombersRuntime {
  log(): unknown[][] {
    return [...this.own().entries.values()].map((entry) => entry.slice(2));
  }
  clockTick(): number {
    return this.clock.tick();
  }
}

/** A solo room (this device and three bots) on an injected clock: `run(ms)` drives its 10 ms loop. */
function solo() {
  let now = 1_000,
    tokens = 0,
    loop: (() => void) | undefined;
  const events: TickEvent[] = [];
  const dependencies: RuntimeDependencies = {
    now: () => now,
    hidden: () => false,
    token: () => `token-${++tokens}`,
    generation: () => 1,
    schedule: (callback) => {
      loop = callback;
      return () => (loop = undefined);
    },
    onVisibilityChange: () => () => {},
  };
  const runtime = new Probe(
    "ROOM",
    DEFAULT_SETTINGS,
    {
      state: () => {},
      event: (event) => events.push(event),
      status: () => {},
      ready: () => {},
    },
    { dependencies },
  );
  runtime.start();
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 10) {
      now += 10;
      loop?.();
    }
  };
  return { runtime, events, run };
}

test("this device logs its held directions on change and each fire press as its own gesture, on its step", () => {
  const { runtime, events, run } = solo();
  const room = runtime.roomState()!,
    { matchId } = room;
  assert.equal(room.stage, "running");
  assert.deepEqual(room.ships, ["solo", "bot:1", "bot:2", "bot:3"]);
  const plays = () =>
    runtime
      .log()
      .filter((e) => e[0] === PLAY)
      .map((e) => e.slice(1));
  runtime.input(UP | FIRE);
  runtime.input(UP);
  assert.deepEqual(
    plays(),
    [[matchId, 1, UP]],
    "FIRE is not a held bit, and an unchanged hold logs nothing",
  );
  run(4_500); // the countdown (3 s) and the first reload (1.2 s)
  runtime.input(UP | LEFT);
  assert.deepEqual(plays().at(-1), [matchId, 1, UP | LEFT]);
  // Pressed 20 ms apart: 0.4 of a log tick, so the two land on different steps.
  const offsets: number[] = [];
  for (let i = 0; i < 2; i++) {
    offsets.push(Math.floor((runtime.clockTick() % 1) * 3));
    assert.ok(runtime.fire());
    run(20);
  }
  assert.notEqual(offsets[0], offsets[1]);
  const presses = runtime.log().filter((e) => e[0] === PRESS);
  assert.deepEqual(
    presses.map((e) => e.slice(3)),
    [
      [1, offsets[0]],
      [2, offsets[1]],
    ],
  );
  run(200);
  assert.equal(runtime.roomState()!.held.solo, UP | LEFT);
  assert.equal(
    events.filter((e) => e.type === "fired" && e.castleId === 0).length,
    1,
    "two presses inside one reload fire one volley",
  );
});

test("a device that flies nothing logs no controls", () => {
  const { runtime, run } = solo();
  run(100);
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  run(100);
  assert.equal(runtime.roomState()!.stage, "lobby");
  runtime.input(UP);
  assert.equal(runtime.fire(), false);
  assert.ok(runtime.log().every((e) => e[0] !== PLAY && e[0] !== PRESS));
});
