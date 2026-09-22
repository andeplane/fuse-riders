import assert from "node:assert/strict";
import { test } from "node:test";
import { JOIN, PRESENCE, ACTION, type StreamEntries } from "fuse-netcode";
import {
  CONTROLS,
  DEFAULT_SETTINGS,
  LEFT,
  NITRO,
  createRoom,
  foldTick,
  isFuseDriversEntry,
  packControls,
  stepsForTick,
  trackNames,
  unpackControls,
  type FuseDriversEntry,
  type FuseDriversRoom,
} from "../src/game/rules.js";
import { NEUTRAL_INPUT } from "../src/game/sim/input.js";
import { defined } from "./fixtures/defined.js";

/** One member's entries for a tick, as the netcode hands them to the fold. */
const stream = (
  entries: FuseDriversEntry[],
  generation = 1,
): StreamEntries<FuseDriversEntry> => ({ generation, entries });

function roomWithDriver(): {
  room: FuseDriversRoom;
  fold: (streams?: Record<string, StreamEntries<FuseDriversEntry>>) => void;
} {
  const room = createRoom("m1", DEFAULT_SETTINGS);
  const fold = (
    streams: Record<string, StreamEntries<FuseDriversEntry>> = {},
  ) => void foldTick(room, "a", new Map(Object.entries(streams)));
  fold({ a: stream([[1, 1, JOIN, "a", "Ada", 0, "robot", 1]]) });
  fold({ a: stream([[2, 2, PRESENCE, "a", true, 1]]) });
  return { room, fold };
}

test("controls pack into a bitmask and come back unchanged", () => {
  assert.equal(packControls(NEUTRAL_INPUT), 0);
  const held = { ...NEUTRAL_INPUT, left: true, nitro: true };
  assert.equal(packControls(held), LEFT | NITRO);
  assert.deepEqual(unpackControls(packControls(held)), held);
  for (let bits = 0; bits < 64; bits++)
    assert.equal(packControls(unpackControls(bits)), bits);
});

test("an entry is refused unless it is a known kind with bits in range", () => {
  assert.ok(isFuseDriversEntry([1, 1, CONTROLS, LEFT | NITRO]));
  assert.ok(isFuseDriversEntry([1, 1, CONTROLS, 0]));
  assert.ok(!isFuseDriversEntry([1, 1, CONTROLS, 64]), "an unknown bit");
  assert.ok(!isFuseDriversEntry([0, 1, CONTROLS, 0]), "seq starts at one");
  assert.ok(!isFuseDriversEntry([1, 0, CONTROLS, 0]), "tick starts at one");
  assert.ok(!isFuseDriversEntry([1, 1, CONTROLS]), "no bits");
  assert.ok(!isFuseDriversEntry([1, 1, 99, 0]), "an unknown kind");
});

test("three steps per two log ticks is exactly the race's 30 Hz", () => {
  let steps = 0;
  for (let tick = 1; tick <= 20; tick++) steps += stepsForTick(tick);
  assert.equal(steps, 30, "twenty log ticks is one second");
});

test("starting a match seeds a race, grids every seat and runs it", () => {
  const { room, fold } = roomWithDriver();
  fold({ a: stream([[3, 3, ACTION, "start", "m2"]]) });
  assert.equal(room.stage, "running");
  const race = defined(room.race, "race");
  assert.equal(room.grid.length, 1);
  assert.equal(defined(room.grid[0]), "a");
  assert.equal(race.trackName, defined(trackNames()[0]));
  const before = race.tick;
  fold();
  assert.equal(
    defined(room.race, "race").tick,
    before + stepsForTick(room.tick),
  );
});

test("a seat keeps driving on its last logged controls until it changes them", () => {
  const { room, fold } = roomWithDriver();
  fold({ a: stream([[3, 3, ACTION, "start", "m2"]]) });
  fold({ a: stream([[4, 4, CONTROLS, LEFT]]) });
  assert.equal(room.controls.a, LEFT);
  fold();
  assert.equal(room.controls.a, LEFT, "silence is not a release");
  fold({ a: stream([[5, 6, CONTROLS, 0]]) });
  assert.equal(room.controls.a, 0);
});

test("a seat that drops off is released rather than left holding a turn", () => {
  const { room, fold } = roomWithDriver();
  fold({ a: stream([[3, 3, ACTION, "start", "m2"]]) });
  fold({ a: stream([[4, 4, CONTROLS, LEFT]]) });
  assert.equal(room.controls.a, LEFT);
  defined(room.seats.get("a"), "seat").connected = false;
  fold();
  assert.equal(room.controls.a, 0);
});

test("the same log folds to the same race on two peers", () => {
  const play = (): FuseDriversRoom => {
    const room = createRoom("m1", DEFAULT_SETTINGS);
    const fold = (
      streams: Record<string, StreamEntries<FuseDriversEntry>> = {},
    ) => void foldTick(room, "a", new Map(Object.entries(streams)));
    fold({ a: stream([[1, 1, JOIN, "a", "Ada", 0, "robot", 1]]) });
    fold({ a: stream([[2, 2, PRESENCE, "a", true, 1]]) });
    fold({ a: stream([[3, 3, ACTION, "start", "m2"]]) });
    for (let tick = 4; tick < 60; tick++)
      fold(
        tick % 7 === 0
          ? { a: stream([[tick, tick, CONTROLS, tick % 14 === 0 ? LEFT : 0]]) }
          : {},
      );
    return room;
  };
  const one = play(),
    two = play();
  assert.equal(
    JSON.stringify(defined(one.race, "race")),
    JSON.stringify(defined(two.race, "race")),
  );
  assert.ok(defined(one.race, "race").tick > 60, "the race advanced");
});
