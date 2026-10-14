import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import { JOBHUB, WALK, type FuseLaneView } from "../src/game/index.js";
import { FuseLaneRuntime } from "../src/app/runtime.js";
import { FAST } from "./fixtures/lane.js";

/** A solo room on an injected clock: `run(ms)` advances it in 10 ms loop steps. */
function soloRoom() {
  // The clock starts well after zero, as a page's does.
  let now = 1000,
    loop: (() => void) | undefined;
  const frames: FuseLaneView[] = [];
  const dependencies: RuntimeDependencies = {
    now: () => now,
    hidden: () => false,
    token: () => "token",
    generation: () => 1,
    schedule: (callback) => {
      loop = callback;
      return () => (loop = undefined);
    },
    onVisibilityChange: () => () => {},
  };
  const runtime = new FuseLaneRuntime(
    "SOLO",
    FAST,
    {
      state: (frame) => frames.push(frame),
      event: () => {},
      status: () => {},
      ready: () => {},
    },
    { dependencies },
  );
  const run = (ms: number) => {
    for (const end = now + ms; now < end;) {
      now += 10;
      loop?.();
    }
  };
  return { runtime, run, frames };
}

test("the room runtime plays only in a running match, for a seat that is here", () => {
  const { runtime, run } = soloRoom();
  assert.equal(runtime.roomState(), undefined);
  assert.equal(runtime.play([WALK, 1, JOBHUB]), false, "no room yet");
  assert.equal(runtime.setGoals([10, 20, 30, 40]), false);
  runtime.start();
  assert.equal(runtime.self, "solo");
  const room = runtime.roomState()!;
  assert.equal(room.stage, "running");
  assert.ok(room.players.solo, "the solo player is seated with an AI");
  assert.equal(
    runtime.setGoals([10, 20, 30, 40]),
    false,
    "goals are picked in the lobby",
  );
  run(100);
  assert.equal(runtime.play([WALK, room.week, JOBHUB]), true);
  run(200);
  assert.equal(runtime.roomState()!.players.solo!.dest, JOBHUB);
  runtime.stop();
});

test("in the lobby a seat picks four valid goals; play waits for the match", () => {
  const { runtime, run } = soloRoom();
  runtime.start();
  run(100);
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  run(200);
  const room = runtime.roomState()!;
  assert.equal(room.stage, "lobby");
  assert.equal(runtime.play([WALK, room.week, JOBHUB]), false);
  assert.equal(runtime.setGoals([10, 20, 30]), false, "four goals");
  assert.equal(runtime.setGoals([10, 20, 30, 45]), false, "steps of ten");
  assert.equal(runtime.setGoals([10, 20, 30, 40]), true);
  run(200);
  assert.deepEqual(runtime.roomState()!.goals.solo, [10, 20, 30, 40]);
  runtime.stop();
});
