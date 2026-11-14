import test from "node:test";
import assert from "node:assert/strict";
import { LEFT, stepsForTick } from "../src/game/index.js";
import { createSmoother, forward } from "../src/app/forward.js";
import {
  SETTINGS,
  addBot,
  drive,
  fold,
  runTo,
  started,
} from "./fixtures/fuseDrivers.js";
import { defined } from "./fixtures/defined.js";

/** Ada, Bo and a bot, well past the green light. */
function racing() {
  const room = started(SETTINGS, [addBot("bot:1", 2)]);
  runTo(room, room.tick + 120);
  assert.equal(room.race?.phase, "racing");
  return room;
}

test("a whole tick played forward is the tick the fold produces, bots included, and the room is left alone", () => {
  const room = racing();
  fold(room, { a: [drive({ left: true })] });
  const before = JSON.stringify([room.race, room.bots, room.controls]);
  const one = defined(forward(room, 1, "a", LEFT), "lead"),
    two = defined(forward(room, 2, "a", LEFT), "lead");
  assert.equal(
    JSON.stringify([room.race, room.bots, room.controls]),
    before,
    "the forward run never touches the room",
  );
  assert.equal(one.alpha, 1);
  fold(room);
  assert.deepEqual(one.race, room.race);
  fold(room);
  assert.deepEqual(two.race, room.race);
});

test("a turn of the wheel shows on the local truck at once, part of the way into the tick", () => {
  const room = racing();
  const slot = room.grid.indexOf("a"),
    heading = defined(room.race, "race").trucks[slot]!.heading;
  // A part of a tick that is less than one step is posed between the folded race and the step after it.
  const part = 0.5 / stepsForTick(room.tick + 1);
  const still = defined(forward(room, part, "a", 0), "lead"),
    turned = defined(forward(room, part, "a", LEFT), "lead");
  assert.equal(still.previous, room.race);
  assert.equal(still.alpha, 0.5);
  assert.equal(still.race.trucks[slot]!.heading, heading);
  assert.notEqual(turned.race.trucks[slot]!.heading, heading);
  // Another seat's truck is driven by what it logged, not by this device's hands.
  const other = room.grid.indexOf("b");
  assert.deepEqual(turned.race.trucks[other], still.race.trucks[other]);
  // Nothing held and nothing ahead is the folded race itself.
  assert.equal(defined(forward(room, 0, "a", 0), "lead").race, room.race);
});

test("the green light is shown when the room folds it, never on a guess", () => {
  const room = started();
  let checked = 0;
  while (room.race?.phase === "countdown") {
    const lead = defined(forward(room, 2, "a", 0), "lead");
    assert.equal(lead.race.phase, "countdown");
    checked++;
    fold(room);
  }
  assert.ok(checked > 10);
  assert.equal(room.race?.phase, "racing");
});

test("a correction to another truck is spread over a few frames", () => {
  const smoother = createSmoother(),
    pose = (x: number) => ({ x, y: 50, heading: 1 });
  const key = "m1:1";
  smoother.begin(key, 1, 10, [0, 0], 0);
  smoother.place(1, pose(500));
  smoother.begin(key, 1, 10, [0, 0], 16);
  smoother.place(1, pose(504));
  // A rollback puts the truck 40 px further on than the 4 px it was moving at.
  smoother.begin(key, 2, 10, [0, 0], 32);
  const jumped = smoother.place(1, pose(548));
  assert.ok(Math.abs(jumped.x - 508) < 0.01, "it carries on as drawn");
  assert.equal(jumped.heading, 1);
  let last = jumped;
  for (let ms = 48; ms < 600; ms += 16) {
    smoother.begin(key, 2, 10, [0, 0], ms);
    last = smoother.place(1, pose(548));
  }
  assert.equal(last.x, 548, "and ends where the room has it");
  // The same jump with no rollback and no change of controls is the picture's own.
  smoother.begin(key, 2, 10, [0, 0], 616);
  assert.equal(smoother.place(1, pose(588)).x, 588);
  // A new tick on which that driver's logged controls changed is a wrong guess too.
  smoother.begin(key, 2, 10, [0, 0], 632);
  smoother.place(1, pose(592));
  smoother.begin(key, 2, 11, [0, LEFT], 648);
  assert.ok(smoother.place(1, pose(560)).x > 590);
  // A respawn across the map is shown as it is.
  smoother.begin(key, 3, 11, [0, LEFT], 664);
  assert.equal(smoother.place(1, pose(1200)).x, 1200);
});
