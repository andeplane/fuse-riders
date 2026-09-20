/**
 * The driving runtime itself: what a thumb on the wheel puts in the log, and what it does not.
 *
 * Everything else in this game is folded from those entries, so a bug here is a bug in every replica at once — a truck
 * that keeps turning after the key came up, or a press that never reaches the other phones. The mesh test drives this
 * same class through a race; these are the edges a race does not reliably reach.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { LEFT, NITRO } from "../src/game/index.js";
import { NEUTRAL_INPUT } from "../src/game/sim/input.js";
import { SETTINGS } from "./fixtures/fuseDrivers.js";
import {
  FuseDriversMesh,
  type TestFuseDriversRuntime,
} from "./fixtures/mesh.js";

/** The countdown is 90 simulation steps: three seconds of mesh clock. */
const COUNTDOWN_MS = 3200;

interface Wheel {
  readonly mesh: FuseDriversMesh;
  /** The device under test, seated and racing. */
  readonly me: TestFuseDriversRuntime;
}

/** One phone racing beside another, with nobody's hands on either wheel until a test puts them there. */
function wheel(): Wheel {
  const mesh = new FuseDriversMesh("a", SETTINGS);
  const host = mesh.join("a");
  assert.equal(host.command({ type: "join", name: "Ada" }), true);
  mesh.run(600);
  const me = mesh.join("b");
  assert.equal(me.command({ type: "join", name: "Bo" }), true);
  mesh.run(400);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  mesh.run(COUNTDOWN_MS);
  assert.equal(me.roomState()?.stage, "running", "the race is under way");
  assert.deepEqual(me.loggedControls(), [], "and nobody has steered yet");
  return { mesh, me };
}

test("the first controls a device logs are logged even when they are neutral", () => {
  const { me } = wheel();
  me.drive(NEUTRAL_INPUT);
  assert.deepEqual(
    me.loggedControls(),
    [0],
    "a fresh device has logged nothing, so it cannot assume the fold already reads it as neutral",
  );
});

test("holding the same keys logs once, however many frames restate them", () => {
  const { me, mesh } = wheel();
  me.drive({ ...NEUTRAL_INPUT, left: true });
  for (let frame = 0; frame < 30; frame++) {
    me.drive({ ...NEUTRAL_INPUT, left: true });
    mesh.run(50);
  }
  assert.deepEqual(
    me.loggedControls(),
    [LEFT],
    "silence in the log is what the fold reads as still holding",
  );
});

test("each change of the keys is one entry, and coming off them is a change too", () => {
  const { me } = wheel();
  me.drive({ ...NEUTRAL_INPUT, left: true });
  me.drive({ ...NEUTRAL_INPUT, left: true, nitro: true });
  me.drive(NEUTRAL_INPUT);
  assert.deepEqual(me.loggedControls(), [LEFT, LEFT | NITRO, 0]);
});

test("a hidden page releases the wheel, so a held turn does not drive the truck off on its own", () => {
  const { me } = wheel();
  me.drive({ ...NEUTRAL_INPUT, left: true });
  me.hidePage();
  assert.deepEqual(me.loggedControls(), [LEFT, 0], "the turn is let go");
  me.hidePage();
  assert.deepEqual(
    me.loggedControls(),
    [LEFT, 0],
    "and letting go of nothing writes nothing",
  );
});

test("a page hidden while holding nothing writes nothing at all", () => {
  const { me } = wheel();
  me.drive(NEUTRAL_INPUT);
  me.hidePage();
  assert.deepEqual(me.loggedControls(), [0]);
});

test("a seat logged absent forgets what it held, so its return states the controls again", () => {
  const { me } = wheel();
  me.drive({ ...NEUTRAL_INPUT, left: true });
  me.logAbsent();
  me.drive({ ...NEUTRAL_INPUT, left: true });
  assert.deepEqual(
    me.loggedControls(),
    [LEFT, LEFT],
    "the fold zeroes an absent seat's controls, so the same keys are news again",
  );
  me.logAbsent();
  me.logAbsent();
  assert.deepEqual(
    me.loggedControls(),
    [LEFT, LEFT],
    "and forgetting twice is not an entry",
  );
});

test("a fresh world states the controls again, because it carries none of this device's entries", () => {
  const { me } = wheel();
  me.drive({ ...NEUTRAL_INPUT, left: true });
  me.freshWorld();
  me.drive({ ...NEUTRAL_INPUT, left: true });
  assert.deepEqual(me.loggedControls(), [LEFT, LEFT]);
});

test("the runtime names this device and hands out the room its own replica folded", () => {
  const { me } = wheel();
  assert.equal(me.self, "b", "the id the room service admitted");
  const room = me.roomState();
  assert.equal(room?.seats.get("b")?.name, "Bo");
  assert.equal(room?.stage, "running");
});
