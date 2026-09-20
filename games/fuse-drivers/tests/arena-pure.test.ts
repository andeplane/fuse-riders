import test from "node:test";
import assert from "node:assert/strict";
import { fuseDriversView, trackFor } from "../src/game/index.js";
import type { FuseDriversView } from "../src/game/game.js";
import type { RaceState } from "../src/game/sim/race.js";
import { createTruck, type Truck } from "../src/game/sim/truck.js";
import {
  focusTruck,
  truckNames,
  type ArenaFrame,
} from "../src/app/arena/frame.js";
import { renderSnapshot, renderTruck } from "../src/app/arena/interpolate.js";
import { runTo, started } from "./fixtures/fuseDrivers.js";
import { defined } from "./fixtures/defined.js";

/** Further than a truck travels in one tick; `interpolate.ts` snaps rather than smearing a jump this large. */
const SNAP_DISTANCE = 200;

const truck = (
  x: number,
  y: number,
  heading = 0,
  extra: Partial<Truck> = {},
): Truck => ({ ...createTruck(0, x, y, heading), ...extra });

/** A race the fixtures have driven well past the countdown, so its trucks are moving. */
function racing(): {
  previous: RaceState;
  next: RaceState;
  view: FuseDriversView;
} {
  const room = started();
  runTo(room, room.tick + 120);
  const previous = defined(room.race, "race");
  runTo(room, room.tick + 1);
  const next = defined(room.race, "race");
  assert.equal(next.phase, "racing");
  assert.ok(next.tick > previous.tick, "the race moved on");
  return { previous, next, view: fuseDriversView(room) };
}

test("positions lerp between the two races the page handed over", () => {
  const pose = renderTruck(truck(10, 20), truck(30, 50), 7, 0.25);
  assert.equal(pose.x, 15);
  assert.equal(pose.y, 27.5);
});

test("alpha of 0 and 1 give exactly the older and the newer pose", () => {
  const prev = truck(10, 20, 0.5),
    next = truck(30, 50, 1.25);
  assert.deepEqual(renderTruck(prev, next, 7, 0), {
    x: 10,
    y: 20,
    heading: 0.5,
  });
  assert.deepEqual(renderTruck(prev, next, 7, 1), {
    x: 30,
    y: 50,
    heading: 1.25,
  });
});

test("a heading takes the shortest arc, including across the wrap", () => {
  // Just under a full turn to just past zero: the short way is forward through the wrap, not back
  // most of a turn. A naive lerp would put this halfway pose near pi, pointing the other way.
  const forward = renderTruck(truck(0, 0, 6.2), truck(0, 0, 0.1), 7, 0.5);
  assert.ok(
    Math.abs(forward.heading - 0.00840734641020705) < 1e-9,
    `crossed the wrap forward, got ${String(forward.heading)}`,
  );

  const back = renderTruck(truck(0, 0, 0.1), truck(0, 0, 6.2), 7, 0.5);
  assert.ok(
    Math.abs(back.heading - 0.00840734641020705) < 1e-9,
    `crossed the wrap backward, got ${String(back.heading)}`,
  );

  // Every pose is a wrapped angle, whatever the two ends were.
  for (const pose of [forward, back])
    assert.ok(
      pose.heading >= -Math.PI && pose.heading < Math.PI,
      "the pose is wrapped",
    );

  // Within the range, the arc is the plain one.
  const plain = renderTruck(truck(0, 0, 0.5), truck(0, 0, 1.5), 7, 0.5);
  assert.ok(Math.abs(plain.heading - 1) < 1e-12);
  // And the long way round is never taken: half a turn each side of pi.
  const across = renderTruck(truck(0, 0, 3), truck(0, 0, -3.1), 7, 0.5);
  assert.ok(
    Math.abs(across.heading - 3.09159265358979) < 1e-9,
    `stayed near pi, got ${String(across.heading)}`,
  );
});

test("a first frame, a respawn and a teleport snap rather than sliding", () => {
  const next = truck(400, 500, 1.25);
  assert.deepEqual(
    renderTruck(undefined, next, 7, 0.5),
    { x: 400, y: 500, heading: 1.25 },
    "nothing to interpolate from",
  );

  // A respawn moves the truck back to the grid; the tick it happened on is drawn at the new place.
  const respawned = truck(12, 20, 1.25, { respawnedTick: 7 });
  assert.deepEqual(
    renderTruck(truck(10, 20, 0.5), respawned, 7, 0.5),
    { x: 12, y: 20, heading: 1.25 },
    "a respawn on this very tick",
  );
  assert.equal(
    renderTruck(truck(10, 20), respawned, 8, 0.5).x,
    11,
    "an older respawn still lerps",
  );

  // A rollback that rewrote the truck's place lands as a jump larger than the snap distance.
  assert.deepEqual(
    renderTruck(truck(0, 0), truck(0, SNAP_DISTANCE + 1), 7, 0.5),
    { x: 0, y: SNAP_DISTANCE + 1, heading: 0 },
    "a teleport past the snap distance",
  );
  assert.equal(
    renderTruck(truck(0, 0), truck(0, SNAP_DISTANCE), 7, 0.5).y,
    SNAP_DISTANCE / 2,
    "a move of exactly the snap distance still lerps",
  );
});

test("a snapshot poses every truck of the newer race", () => {
  const { previous, next } = racing();
  assert.ok(next.trucks.length >= 2, "the fixture seats two drivers");

  const half = renderSnapshot(previous, next, 0.5);
  assert.equal(half.length, next.trucks.length);
  let moved = false;
  for (const [slot, pose] of half.entries()) {
    const before = defined(previous.trucks[slot], "older truck"),
      after = defined(next.trucks[slot], "newer truck");
    if (before.x !== after.x || before.y !== after.y) moved = true;
    const between = (a: number, b: number, value: number) =>
      value >= Math.min(a, b) && value <= Math.max(a, b);
    assert.ok(between(before.x, after.x, pose.x), `slot ${String(slot)} x`);
    assert.ok(between(before.y, after.y, pose.y), `slot ${String(slot)} y`);
  }
  assert.ok(moved, "the trucks are driving");

  assert.deepEqual(
    renderSnapshot(previous, next, 1),
    next.trucks.map((t) => ({ x: t.x, y: t.y, heading: t.heading })),
    "at the newer end the poses are the newer race",
  );
  assert.deepEqual(
    renderSnapshot(undefined, next, 0.5),
    next.trucks.map((t) => ({ x: t.x, y: t.y, heading: t.heading })),
    "with nothing to interpolate from every truck snaps",
  );

  // A truck the older race did not have yet is drawn where it is, not where nothing was.
  const shorter: RaceState = {
    ...previous,
    trucks: previous.trucks.slice(0, 1),
  };
  const grown = renderSnapshot(shorter, next, 0.5);
  const last = defined(next.trucks[next.trucks.length - 1], "last truck");
  assert.deepEqual(defined(grown[grown.length - 1], "last pose"), {
    x: last.x,
    y: last.y,
    heading: last.heading,
  });
});

test("the panels follow this device's truck, or the leader when it drives none", () => {
  const { next, view } = racing();
  const drivers = view.drivers;
  const ada = defined(
    drivers.find((driver) => driver.id === "a"),
    "seat a",
  );
  assert.equal(focusTruck(view, next, "a"), ada.truck);
  assert.equal(
    focusTruck(view, next, "b"),
    defined(
      drivers.find((driver) => driver.id === "b"),
      "seat b",
    ).truck,
  );

  const leader = defined(next.placements[0], "the leader");
  assert.equal(focusTruck(view, next, undefined), leader, "a shared screen");
  assert.equal(focusTruck(view, next, "nobody"), leader, "a watcher");

  const seated = (truckOf: number): FuseDriversView => ({
    ...view,
    drivers: drivers.map((driver) =>
      driver.id === "a" ? { ...driver, truck: truckOf } : driver,
    ),
  });
  assert.equal(
    focusTruck(seated(-1), next, "a"),
    leader,
    "a seat before the grid is formed",
  );
  assert.equal(
    focusTruck(seated(next.trucks.length), next, "a"),
    leader,
    "a seat naming a truck the race does not have",
  );
  assert.equal(
    focusTruck(view, { ...next, placements: [] }, "nobody"),
    0,
    "no placement to follow yet",
  );
});

test("names are in truck order, short, upper case, and fall back to the slot", () => {
  const { next, view } = racing();
  assert.deepEqual(truckNames(view, next.trucks.length), ["ADA", "BO"]);
  assert.deepEqual(truckNames(view, 4), ["ADA", "BO", "CPU 3", "CPU 4"]);
  assert.deepEqual(truckNames(view, 0), []);

  const long: FuseDriversView = {
    ...view,
    drivers: view.drivers.map((driver) =>
      driver.truck === 0 ? { ...driver, name: "Wilhelmina" } : driver,
    ),
  };
  assert.deepEqual(truckNames(long, 1), ["WILHELMI"]);
});

test("one drawn frame carries the race, the poses, the track and the names", () => {
  const { previous, next, view } = racing();
  const alpha = 0.4;
  const frame: ArenaFrame = {
    view,
    race: next,
    previous,
    alpha,
    poses: renderSnapshot(previous, next, alpha),
    track: trackFor(next.trackName),
    focus: focusTruck(view, next, "a"),
    newTick: true,
    names: truckNames(view, next.trucks.length),
  };

  assert.equal(frame.poses.length, next.trucks.length);
  assert.equal(frame.names.length, next.trucks.length);
  assert.ok(frame.focus >= 0 && frame.focus < next.trucks.length);
  assert.equal(frame.track.name, next.trackName);
  assert.equal(defined(frame.previous, "the older race").tick, previous.tick);
  assert.deepEqual(frame.poses, renderSnapshot(previous, next, alpha));
  assert.ok(frame.alpha >= 0 && frame.alpha <= 1);
  assert.equal(
    frame.view.race,
    next,
    "the view carries the race it was built from",
  );
});
