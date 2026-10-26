import test from "node:test";
import assert from "node:assert/strict";
import {
  FOCUS_GIVE_UP,
  HEROES,
  SPELL_INFO,
  centreOf,
  decodeWorld,
  encodeWorld,
  step,
  tileOf,
  viewOf,
  type Command,
  type World,
} from "../src/engine/index.js";
import { tiny, TINY } from "./fixtures/maps.js";
import { addUnit, arena } from "./fixtures/heroes.js";

const map = tiny();
const attack = (of: number, id: number): Command => ({
  seat: 0,
  type: "attack",
  of,
  id,
});
const run = (world: World, steps: number, first: Command[] = []): World => {
  for (let index = 0; index < steps; index++)
    world = step(map, world, index === 0 ? first : []);
  return world;
};
/** The ids hero 0 shot at during a step. */
const shotsOf = (world: World) =>
  world.events.flatMap((e) =>
    e.type === "shot" && e.from.of === "hero" && e.from.id === 0
      ? [e.to.id]
      : [],
  );

test("attack chases the chosen enemy out of range, then shoots it before a nearer one", () => {
  const world = arena("brick");
  // Two sentries far east (they never move); the chosen one is the farther.
  const near = addUnit(world, 1, "sentry", 10, 8, 400);
  const far = addUnit(world, 1, "sentry", 11, 8, 400);
  let next = step(map, world, [attack(0, far.id)]);
  const hero = next.heroes[0]!;
  assert.deepEqual([hero.focusOf, hero.focus], [0, far.id]);
  assert.equal(hero.goal, 8 * map.width + 11, "it paths to the target");
  next = run(next, 120);
  // In range of both now, it shoots only the one it was told to.
  const shots: number[] = [];
  for (let index = 0; index < 90; index++) {
    next = step(map, next);
    shots.push(...shotsOf(next));
  }
  const range = HEROES.brick.range;
  const [dx, dy] = [far.x - next.heroes[0]!.x, far.y - next.heroes[0]!.y];
  assert.ok(dx * dx + dy * dy <= range * range, "it closed to range");
  assert.equal(next.heroes[0]!.goal, -1, "and stands");
  assert.ok(shots.length > 0);
  assert.ok(
    shots.every((id) => id === far.id),
    "every shot at the focus, though the other stood nearer",
  );
  assert.equal(viewOf(map, next).heroes[0]!.target?.chosen, true);
});

test("a move, attack-move or held stick cancels the focus; releasing the stick does not", () => {
  const world = arena("brick");
  const sentry = addUnit(world, 1, "sentry", 11, 8, 400);
  const focused = step(map, world, [attack(0, sentry.id)]);
  const after = (command: Command) => step(map, focused, [command]).heroes[0]!;
  const seat = 0;
  assert.equal(after({ seat, type: "move", x: 2, y: 6 }).focusOf, -1);
  assert.equal(after({ seat, type: "attackMove", x: 2, y: 6 }).focusOf, -1);
  assert.equal(after({ seat, type: "steer", dx: 4, dy: 0 }).focusOf, -1);
  assert.equal(after({ seat, type: "steer", dx: 0, dy: 0 }).focusOf, 0);
});

test("the focus drops when its target dies", () => {
  const world = arena("brick");
  const sentry = addUnit(world, 1, "sentry", 6, 7, 100);
  let next = step(map, world, [attack(0, sentry.id)]);
  assert.equal(next.heroes[0]!.focusOf, 0);
  next = run(next, 100);
  assert.equal(next.units.length, 0, "shot dead");
  assert.deepEqual([next.heroes[0]!.focusOf, next.heroes[0]!.focus], [-1, -1]);
  assert.equal(viewOf(map, next).heroes[0]!.target, null);
});

test("a unit beyond the leash for FOCUS_GIVE_UP steps in a row is given up; a far building is not", () => {
  const world = arena("brick");
  const sentry = addUnit(world, 1, "sentry", 12, 8, 400);
  let next = step(map, world, [attack(0, sentry.id)]);
  let fort = step(map, world, [attack(2, TINY.fort1)]);
  // Pinned in place (as if blocked), the hero never closes in.
  for (let index = 1; index < FOCUS_GIVE_UP - 1; index++) {
    next = step(map, { ...next, heroes: pin(next) });
    fort = step(map, { ...fort, heroes: pin(fort) });
    assert.equal(next.heroes[0]!.focusOf, 0, `still focused at ${index}`);
  }
  next = step(map, { ...next, heroes: pin(next) });
  assert.deepEqual([next.heroes[0]!.focusOf, next.heroes[0]!.goal], [-1, -1]);
  assert.equal(
    fort.heroes[0]!.focusOf,
    2,
    "a fort stays put, so it is walked to",
  );
});
const pin = (world: World) =>
  world.heroes.map((hero, index) =>
    index === 0 ? { ...hero, x: centreOf(1), y: centreOf(8) } : hero,
  );

test("attack is refused for a friend, a stranger, a neutral turret, a cloaked hero or a dead attacker", () => {
  const world = arena("brick", 1, "vix");
  const friend = addUnit(world, 0, "grunt", 5, 6);
  const refused = (w: World, command: Command) =>
    step(map, w, [command]).heroes[0]!.focusOf === -1;
  assert.ok(refused(world, attack(0, friend.id)));
  assert.ok(refused(world, attack(0, 999)));
  assert.ok(refused(world, attack(2, TINY.turret)), "neutral");
  assert.ok(refused(world, attack(1, 0)), "itself");
  const vix = structuredClone(world);
  Object.assign(vix.heroes[1]!, { hp: 300, respawn: 0, cloak: 5 });
  assert.ok(refused(vix, attack(1, 1)), "cloaked");
  vix.heroes[1]!.cloak = 0;
  assert.ok(!refused(vix, attack(1, 1)), "uncloaked, it is fair game");
  assert.ok(!refused(world, attack(2, TINY.fort1)), "an enemy fort");
  const dead = structuredClone(world);
  Object.assign(dead.heroes[0]!, { hp: 0, respawn: 50 });
  const sentry = addUnit(dead, 1, "sentry", 9, 8, 400);
  assert.ok(refused(dead, attack(0, sentry.id)));
});

test("an attack-move stands to fight what it meets and walks on once it is dead", () => {
  const world = arena("brick");
  addUnit(world, 1, "sentry", 10, 8, 120);
  const go: Command = { seat: 0, type: "attackMove", x: 12, y: 8 };
  let next = step(map, world, [go]);
  assert.equal(next.heroes[0]!.sweep, 1);
  // It walks until the sentry is in range, then holds while it shoots.
  next = run(next, 30);
  const held = next.heroes[0]!.x;
  next = run(next, 20);
  assert.equal(next.heroes[0]!.x, held, "it stands while the sentry lives");
  next = run(next, 200);
  assert.equal(next.units.length, 0);
  assert.equal(tileOf(next.heroes[0]!.x), 12, "then walks on to the goal");
  assert.equal(next.heroes[0]!.sweep, 0, "and the attack-move ends there");
  const moved = run(world, 50, [{ seat: 0, type: "move", x: 12, y: 8 }]); // walks past
  assert.ok(moved.heroes[0]!.x > held);
});

test("the view shows what the hero shoots next, picked or chosen, and every spell's metadata", () => {
  const world = arena("brick");
  const sentry = addUnit(world, 1, "sentry", 7, 7, 400);
  const view = viewOf(map, world).heroes[0]!;
  const { x, y } = sentry;
  assert.deepEqual(view.target, {
    of: "unit",
    id: sentry.id,
    x,
    y,
    chosen: false,
  });
  assert.deepEqual(shotsOf(step(map, world)), [sentry.id], "the next shot");
  const chosen = viewOf(map, step(map, world, [attack(2, TINY.fort1)]));
  const fort = {
    of: "building",
    id: TINY.fort1,
    x: centreOf(12),
    y: centreOf(1),
  };
  assert.deepEqual(chosen.heroes[0]!.target, { ...fort, chosen: true });
  assert.equal(view.kit, SPELL_INFO.brick);
  for (const kit of Object.values(SPELL_INFO))
    for (const spell of kit) {
      assert.ok(spell.name.length > 0 && spell.desc.length > 10, spell.name);
      assert.equal(spell.targeting === "self", spell.range === 0, spell.name);
    }
  assert.ok(Object.isFrozen(SPELL_INFO.vix[0]));
});

test("an aimed spell is refused beyond its reach without spending, and a chosen target overrides the aim", () => {
  const world = arena("vix", 6);
  addUnit(world, 1, "grunt", 7, 7, 1000);
  const far = addUnit(world, 1, "grunt", 9, 6, 1000);
  const tank = addUnit(world, 1, "lightTank", 12, 8, 1000);
  const friend = addUnit(world, 0, "grunt", 3, 6);
  const cast = (command: Partial<Command>) =>
    step(map, world, [
      { seat: 0, type: "cast", slot: 0, x: 7, y: 7, ...command } as Command,
    ]);
  const cast_ = (w: World) => w.events.some((e) => e.type === "cast");
  const hp = (w: World, id: number) => w.units.find((u) => u.id === id)!.hp;
  // SNIPE at level 6 does 170; Vix's gun meanwhile shoots the nearest, the grunt by the aim.
  assert.equal(hp(cast({ of: 0, id: far.id }), far.id), 1000 - 170);
  assert.equal(hp(cast({}), far.id), 1000, "unchosen: nearest the aim");
  // HIJACK reaches six tiles; the tank stands over eight away.
  const hijack = cast({ slot: 3, x: 12, y: 8, of: 0, id: tank.id });
  assert.equal(hijack.units.find((u) => u.id === tank.id)!.owner, 1);
  assert.deepEqual([cast_(hijack), hijack.heroes[0]!.spells[3]], [false, 0]);
  // A friend, a stranger or a half-named target is refused too.
  for (const refused of [
    { of: 0, id: friend.id },
    { of: 0, id: 99 },
    { of: 0 },
  ])
    assert.equal(cast_(cast(refused)), false, JSON.stringify(refused));
  // STICKY MINE (point) reaches three tiles, and half a tile of slack.
  assert.equal(cast({ slot: 2, x: 8, y: 6 }).mines.length, 0);
  assert.equal(cast({ slot: 2, x: 7, y: 6 }).mines.length, 1);
});

test("a focus and an attack-move survive a checkpoint, and inconsistent ones are refused", () => {
  const world = arena("brick");
  world.heroes[0]!.energy = 100;
  world.heroes[1]!.respawn = 300; // within what a checkpoint allows
  const sentry = addUnit(world, 1, "sentry", 11, 8, 400);
  const focused = run(world, 5, [attack(0, sentry.id)]);
  const swept = step(map, world, [
    { seat: 0, type: "attackMove", x: 12, y: 8 },
  ]);
  for (const each of [focused, swept]) {
    const wire = JSON.parse(JSON.stringify(encodeWorld(each)));
    assert.deepEqual(encodeWorld(decodeWorld(wire, map)!), wire);
  }
  /** Hero 0's fields 19–22 (focusOf, focus, lost, sweep) and its steer, set on `base`'s checkpoint. */
  const with_ = (base: World, fields: Record<number, number>) => {
    const raw = JSON.parse(JSON.stringify(encodeWorld(base)));
    for (const [at, value] of Object.entries(fields)) raw[7][0][at] = value;
    return decodeWorld(raw, map);
  };
  assert.ok(with_(focused, {}));
  assert.equal(with_(focused, { 19: 3 }), undefined, "no such mark");
  assert.equal(with_(focused, { 19: 1, 20: 0 }), undefined, "itself");
  assert.equal(with_(focused, { 20: 99 }), undefined, "an id not given out");
  assert.equal(with_(focused, { 21: FOCUS_GIVE_UP }), undefined);
  assert.equal(with_(focused, { 10: 3 }), undefined, "with the stick held");
  assert.equal(with_(focused, { 22: 1 }), undefined, "and an attack-move");
  assert.equal(with_(focused, { 19: -1 }), undefined, "an id with no mark");
  assert.equal(with_(swept, { 9: -1 }), undefined, "attack-move, no goal");
  assert.equal(with_(swept, { 22: 2 }), undefined);
  assert.ok(with_(focused, { 19: 2, 20: TINY.turret }));
  assert.equal(with_(focused, { 19: 2, 20: TINY.robotFactory }), undefined);
});
