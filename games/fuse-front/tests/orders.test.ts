import test from "node:test";
import assert from "node:assert/strict";
import {
  CAST_WAIT,
  QUEUE_MAX,
  decodeWorld,
  encodeWorld,
  hashWorld,
  maxEnergy,
  respawnSteps,
  step,
  tileOf,
  UNITS,
  viewOf,
  type Command,
  type World,
} from "../src/engine/index.js";
import { tiny } from "./fixtures/maps.js";
import { addUnit, arena } from "./fixtures/heroes.js";

const map = tiny();
const move = (x: number, y: number, queued = false): Command => ({
  seat: 0,
  type: "move",
  x,
  y,
  queued,
});
const run = (world: World, steps: number, first: Command[] = []): World => {
  for (let index = 0; index < steps; index++)
    world = step(map, world, index === 0 ? first : []);
  return world;
};
const tile = (x: number, y: number) => y * map.width + x;
/** Steps until hero 0 has no current order and nothing queued, recording each goal it walks to. */
function walk(world: World, limit = 600): { world: World; goals: number[] } {
  const goals: number[] = [];
  for (let index = 0; index < limit; index++) {
    world = step(map, world);
    const hero = world.heroes[0]!;
    if (hero.goal >= 0 && goals.at(-1) !== hero.goal) goals.push(hero.goal);
    if (hero.goal < 0 && hero.focusOf < 0 && hero.queue.length === 0)
      return { world, goals };
  }
  assert.fail("the hero never finished its route");
}

test("queued moves are walked one after another, and the view lists the route", () => {
  let world = step(map, arena("brick"), [
    move(4, 2),
    move(5, 8, true),
    { seat: 0, type: "attackMove", x: 2, y: 7, queued: true },
  ]);
  const hero = world.heroes[0]!;
  assert.equal(hero.goal, tile(4, 2), "the plain move starts at once");
  assert.deepEqual(hero.queue, [
    { type: "move", x: 5, y: 8 },
    { type: "attackMove", x: 2, y: 7 },
  ]);
  const route = viewOf(map, world).heroes[0]!.route;
  assert.deepEqual(
    route.map((stop) => [
      stop.kind,
      tileOf(stop.x),
      tileOf(stop.y),
      stop.current,
    ]),
    [
      ["move", 4, 2, true],
      ["move", 5, 8, false],
      ["attackMove", 2, 7, false],
    ],
  );
  const done = walk(world);
  world = done.world;
  assert.deepEqual(done.goals.slice(1), [tile(5, 8), tile(2, 7)]);
  const end = world.heroes[0]!;
  assert.deepEqual([tileOf(end.x), tileOf(end.y)], [2, 7]);
  assert.deepEqual(viewOf(map, world).heroes[0]!.route, []);
});

test("a queued order given to an idle hero starts at once", () => {
  const world = step(map, arena("brick"), [move(9, 2, true)]);
  assert.equal(world.heroes[0]!.goal, tile(9, 2));
  assert.deepEqual(world.heroes[0]!.queue, []);
});

test("a plain order, a held stick or death clears the queue; a released stick keeps it", () => {
  const queued = () =>
    step(map, arena("brick"), [move(2, 2), move(9, 2, true), move(9, 7, true)]);
  assert.equal(queued().heroes[0]!.queue.length, 2);
  const replaced = step(map, queued(), [move(5, 5)]);
  assert.deepEqual(replaced.heroes[0]!.queue, []);
  assert.equal(replaced.heroes[0]!.goal, tile(5, 5));
  const steered = step(map, queued(), [
    { seat: 0, type: "steer", dx: 4, dy: 0 },
  ]);
  assert.deepEqual(steered.heroes[0]!.queue, []);
  const released = step(map, queued(), [
    { seat: 0, type: "steer", dx: 0, dy: 0 },
  ]);
  assert.equal(released.heroes[0]!.queue.length, 2);
  const attacked = queued();
  const foe = addUnit(attacked, 1, "sentry", 10, 6);
  const focused = step(map, attacked, [
    { seat: 0, type: "attack", of: 0, id: foe.id },
  ]);
  assert.deepEqual(focused.heroes[0]!.queue, [], "a plain attack replaces it");
  // A plain cast is instant: it leaves the walk and the queue alone.
  const cast = step(map, queued(), [
    { seat: 0, type: "cast", slot: 0, x: 0, y: 0 },
  ]);
  assert.equal(cast.heroes[0]!.queue.length, 2);
  assert.ok(cast.heroes[0]!.spells[0]! > 0, "it went off");
  // Death: an enemy hero's fatal shot (`fell`) is stood in for by draining it next to a live enemy fort's gun.
  const doomed = queued();
  Object.assign(doomed.heroes[0]!, {
    x: doomed.heroes[1]!.x - 128,
    y: doomed.heroes[1]!.y,
    hp: 1,
  });
  let after = doomed;
  for (let i = 0; i < 200 && after.heroes[0]!.hp > 0; i++)
    after = step(map, after);
  assert.equal(after.heroes[0]!.hp, 0, "the fort's gun kills it");
  assert.deepEqual(after.heroes[0]!.queue, []);
});

test("the queue holds at most QUEUE_MAX orders", () => {
  let world = step(map, arena("brick"), [move(12, 8)]);
  for (let index = 0; index < QUEUE_MAX + 3; index++)
    world = step(map, world, [move(1 + (index % 10), 1, true)]);
  assert.equal(world.heroes[0]!.queue.length, QUEUE_MAX);
});

test("a queued attack focuses its target when reached, and is skipped once the target is gone", () => {
  const world = arena("brick");
  const far = addUnit(world, 1, "sentry", 11, 8, 5000);
  let next = step(map, world, [
    move(4, 2),
    { seat: 0, type: "attack", of: 0, id: far.id, queued: true },
  ]);
  next = run(next, 200);
  assert.deepEqual(
    [next.heroes[0]!.focusOf, next.heroes[0]!.focus],
    [0, far.id],
  );
  // The same order with its target gone by the time it comes up: the move after it starts instead.
  const gone = arena("brick");
  const doomed = addUnit(gone, 1, "sentry", 11, 8, 5000);
  let later = step(map, gone, [
    move(4, 2),
    { seat: 0, type: "attack", of: 0, id: doomed.id, queued: true },
    move(9, 2, true),
  ]);
  later = { ...later, units: later.units.filter((u) => u.id !== doomed.id) };
  const done = walk(later);
  assert.equal(done.world.heroes[0]!.focusOf, -1);
  assert.equal(done.goals.at(-1), tile(9, 2));
});

test("a queued cast fires when reached, waits out a short cooldown, and is skipped when it never can", () => {
  const queuedCast: Command = {
    seat: 0,
    type: "cast",
    slot: 0,
    x: 0,
    y: 0,
    queued: true,
  };
  let world = step(map, arena("brick"), [move(5, 6), queuedCast]);
  assert.equal(world.heroes[0]!.spells[0], 0, "not before the move ends");
  world = run(world, 40);
  assert.ok(world.heroes[0]!.spells[0]! > 0, "it went off on arrival");
  assert.deepEqual(world.heroes[0]!.queue, []);
  // On cooldown for a few steps: it waits, standing, then fires.
  const cooling = arena("brick");
  cooling.heroes[0]!.spells[0] = 6;
  let waited = step(map, cooling, [queuedCast, move(9, 2, true)]);
  assert.equal(waited.heroes[0]!.wait, 1);
  assert.equal(waited.heroes[0]!.goal, -1, "it stands while it waits");
  const fired = run(waited, 6);
  assert.equal(fired.heroes[0]!.queue.length, 0);
  assert.equal(fired.heroes[0]!.goal, tile(9, 2), "then walks on");
  // With no energy it cannot: after CAST_WAIT tries the order is dropped and the next starts.
  const drained = arena("brick");
  drained.heroes[0]!.energy = 0;
  waited = step(map, drained, [queuedCast, move(9, 2, true)]);
  waited = run(waited, CAST_WAIT - 2);
  assert.equal(waited.heroes[0]!.queue.length, 2, "still waiting");
  waited = run(waited, 1);
  assert.equal(waited.heroes[0]!.queue.length, 0);
  assert.equal(waited.heroes[0]!.goal, tile(9, 2));
});

test("a queue survives a checkpoint, and resumes to the same world", () => {
  const world = arena("brick");
  // A respawn and energy a checkpoint admits.
  world.heroes[1]!.respawn = respawnSteps(1);
  world.heroes[0]!.energy = maxEnergy(1);
  const foe = addUnit(world, 1, "sentry", 11, 8, UNITS.sentry.hp);
  let next = step(map, world, [
    move(4, 2),
    move(9, 2, true),
    { seat: 0, type: "attack", of: 0, id: foe.id, queued: true },
    {
      seat: 0,
      type: "cast",
      slot: 0,
      x: 3,
      y: 3,
      of: 0,
      id: foe.id,
      queued: true,
    },
  ]);
  const restored = decodeWorld(
    JSON.parse(JSON.stringify(encodeWorld(next))),
    map,
  );
  assert.ok(restored);
  assert.deepEqual(restored.heroes[0]!.queue, next.heroes[0]!.queue);
  assert.equal(
    hashWorld(run(restored, 300)),
    hashWorld((next = run(next, 300))),
  );
});

test("a queued cast at a target no checkpoint admits is refused, so the world still decodes", () => {
  const world = arena("brick");
  world.heroes[1]!.respawn = respawnSteps(1);
  world.heroes[0]!.energy = maxEnergy(1);
  const busy = step(map, world, [move(12, 8)]);
  const bogus = (of: number, id: number): Command => ({
    ...{ seat: 0, type: "cast", slot: 1, x: 4, y: 4, queued: true },
    of,
    id,
  });
  const next = step(map, busy, [bogus(0, 999_999), bogus(1, 5), bogus(2, 99)]);
  assert.equal(next.heroes[0]!.queue.length, 0);
  assert.ok(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(next))), map));
});

test("orders queued while dead start after the respawn, and ones queued under a held stick wait for its release", () => {
  const world = arena("brick");
  Object.assign(world.heroes[0]!, { hp: 0, respawn: 2 });
  let next = step(map, world, [move(9, 2, true)]);
  assert.equal(next.heroes[0]!.queue.length, 1, "kept while dead");
  next = run(next, 3);
  assert.ok(next.heroes[0]!.hp > 0);
  assert.equal(next.heroes[0]!.goal, tile(9, 2));
  let held = step(map, arena("brick"), [
    { seat: 0, type: "steer", dx: 4, dy: 0 },
  ]);
  held = step(map, held, [move(9, 2, true)]);
  assert.equal(held.heroes[0]!.queue.length, 1, "waits under the stick");
  held = step(map, held, [{ seat: 0, type: "steer", dx: 0, dy: 0 }]);
  assert.equal(held.heroes[0]!.goal, tile(9, 2));
});
