import test from "node:test";
import assert from "node:assert/strict";
import { RoomRuntime } from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";

test("steering immediately after solo start and resume reaches the fold without a second edge", () => {
  let now = 0,
    hidden = false,
    loop = () => {},
    visibility = () => {};
  const runtime = new RoomRuntime(
    "SOLO",
    defaultRoomSettings(),
    {
      state: () => {},
      event: () => {},
      status: () => {},
      ready: () => {},
    },
    {
      dependencies: {
        now: () => now,
        hidden: () => hidden,
        token: () => "test",
        generation: () => 1,
        schedule: (callback) => {
          loop = callback;
          return () => {};
        },
        onVisibilityChange: (callback) => {
          visibility = callback;
          return () => {};
        },
      },
    },
  );
  const input = () =>
    runtime.command({
      type: "input",
      seq: 1,
      left: true,
      right: false,
      bomb: false,
    });
  const run = (ms: number) => {
    for (let i = 0; i < ms; i += 10) {
      now += 10;
      loop();
    }
  };
  runtime.start();
  assert.equal(input(), true);
  run(200);
  assert.deepEqual(runtime.heldControls("solo"), { left: true, right: false });
  hidden = true;
  visibility();
  run(5000);
  assert.deepEqual(runtime.heldControls("solo"), { left: false, right: false });
  hidden = false;
  visibility();
  assert.equal(input(), true);
  run(200);
  assert.deepEqual(runtime.heldControls("solo"), { left: true, right: false });
  runtime.stop();
});
