import test from "node:test";
import assert from "node:assert/strict";
import {
  HERO,
  HEROES,
  GOLD,
  ITEMS,
  ITEM_CAPS,
  ITEM_SLOTS,
  KITS,
  SELL_PERCENT,
  SHIELD_PERCENT,
  STEPS_PER_SECOND,
  TILE,
  UNITS,
  BUILDS,
  activeCommands,
  bonusOf,
  nextBuy,
  shopCommands,
  centreOf,
  createWorld,
  decodeWorld,
  div,
  encodeWorld,
  heroGun,
  loadMap,
  heroMaxEnergy,
  heroMaxHp,
  maxEnergy,
  maxHp,
  step,
  type Command,
  type Hero,
  type World,
} from "../src/engine/index.js";
import { addUnit, arena } from "./fixtures/heroes.js";
import { TINY, tiny, tinyFile } from "./fixtures/maps.js";

const map = tiny();
const at = centreOf;
const id = (name: string): number => ITEMS.findIndex((i) => i.name === name);
const [BLADE, FEED, PLATE, CELL, CAPACITOR, CHIP, BOOTS, AEGIS, COIL, MENDER] =
  [
    "Servo Blade",
    "Rapid Feed",
    "Plate Weave",
    "Core Cell",
    "Capacitor",
    "Overclock Chip",
    "Track Boots",
    "Aegis Projector",
    "Phase Coil",
    "Mender Beacon",
  ].map(id) as number[] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
const fort = map.sites[TINY.fort0]!;

/** Seat 0's Brick at its fort with `gold`, against a fallen foe (`arena`). */
function shopper(gold = 10_000): World {
  const world = arena("brick");
  Object.assign(world.heroes[0]!, {
    x: at(fort.x),
    y: at(fort.y),
    energy: 100,
    gold,
  });
  return world;
}
const hero0 = (world: World): Hero => world.heroes[0]!;
const buy = (item: number): Command => ({ seat: 0, type: "buy", item });
const sell = (slot: number): Command => ({ seat: 0, type: "sell", slot });
const use = (slot: number, x = 0, y = 0): Command => ({
  seat: 0,
  type: "useItem",
  slot,
  x,
  y,
});
/** `world` with seat 0's hero holding `items` in its first slots. */
function holding(world: World, ...items: number[]): World {
  const slots = Array.from({ length: ITEM_SLOTS }, (_, i) => items[i] ?? -1);
  Object.assign(world.heroes[0]!, { items: slots });
  return world;
}

test("the shop has a dozen items in four categories, each with a cost and something to give", () => {
  assert.equal(ITEMS.length, 12);
  assert.ok(ITEMS.every((i) => i.cost > 0 && i.name && i.desc));
  for (const each of ITEMS) {
    const gives = each.damage + each.armour + each.hp + each.energy + each.cdr;
    assert.ok(gives + each.speed + each.haste > 0 || each.active, each.name);
  }
  assert.ok(ITEMS.some((i) => i.active === "shield"));
  assert.ok(ITEMS.some((i) => i.active === "blink"));
  assert.ok(ITEMS.some((i) => i.aura));
});

test("a hero at its fort buys into its first empty slot, paying the cost and gaining the item's hit points and energy", () => {
  const world = shopper(2000);
  const next = step(map, world, [buy(CELL), buy(CAPACITOR)]);
  const hero = hero0(next);
  assert.deepEqual(hero.items, [CELL, CAPACITOR, -1, -1, -1, -1]);
  assert.equal(hero.gold, 2000 - ITEMS[CELL]!.cost - ITEMS[CAPACITOR]!.cost);
  assert.equal(heroMaxHp(hero), maxHp(1) + ITEMS[CELL]!.hp);
  assert.equal(heroMaxEnergy(hero), maxEnergy(1) + ITEMS[CAPACITOR]!.energy);
  assert.equal(hero.hp, maxHp(1) + ITEMS[CELL]!.hp);
  assert.ok(hero.energy >= 100 + ITEMS[CAPACITOR]!.energy);
  assert.deepEqual(hero0(world).items, holding(shopper(), -1).heroes[0]!.items);
});

test("the shop refuses too little gold, a full inventory, an unknown item, a dead hero and one away from its fort", () => {
  const poor = step(map, shopper(ITEMS[BLADE]!.cost - 1), [buy(BLADE)]);
  assert.deepEqual(hero0(poor).items, Array(ITEM_SLOTS).fill(-1));
  const full = holding(shopper(), 0, 0, 0, 0, 0, 0);
  assert.equal(hero0(step(map, full, [buy(BLADE)])).gold, 10_000);
  const unknown = step(map, shopper(), [buy(ITEMS.length), buy(-1)]);
  assert.equal(hero0(unknown).gold, 10_000);
  const away = shopper();
  Object.assign(away.heroes[0]!, { x: at(4), y: at(6) });
  assert.equal(hero0(step(map, away, [buy(BLADE)])).gold, 10_000);
  const dead = shopper();
  Object.assign(dead.heroes[0]!, { hp: 0, respawn: 300 });
  assert.equal(hero0(step(map, dead, [buy(BLADE)])).gold, 10_000);
});

test("selling at the fort refunds part of the cost and takes the item's hit points with it", () => {
  const world = step(map, shopper(ITEMS[CELL]!.cost), [buy(CELL)]);
  assert.equal(hero0(world).gold, 0);
  const sold = step(map, world, [sell(0)]);
  assert.deepEqual(hero0(sold).items, Array(ITEM_SLOTS).fill(-1));
  assert.equal(hero0(sold).gold, div(ITEMS[CELL]!.cost * SELL_PERCENT, 100));
  assert.equal(hero0(sold).hp, maxHp(1));
  // An empty slot, a slot out of range or a hero away from its fort sells nothing.
  assert.equal(
    hero0(step(map, sold, [sell(0), sell(9)])).gold,
    hero0(sold).gold,
  );
  const away = structuredClone(world);
  Object.assign(away.heroes[0]!, { x: at(4), y: at(6) });
  assert.deepEqual(hero0(step(map, away, [sell(0)])).items[0], CELL);
});

test("items add to the gun's damage and reload, the hero's speed and its spells' cooldowns", () => {
  const plain = arena("brick");
  const armed = holding(arena("brick"), BLADE, FEED, CHIP, BOOTS);
  const base = heroGun(hero0(plain));
  const gun = heroGun(hero0(armed));
  assert.equal(gun.damage, base.damage + ITEMS[BLADE]!.damage);
  assert.equal(
    gun.cooldown,
    div(HERO.cooldown * 100, 100 + ITEMS[FEED]!.haste),
  );
  // A shot at a grunt: the item's damage, and the faster reload.
  addUnit(armed, 1, "grunt", 7, 6, 1000);
  const shot = step(map, armed);
  const event = shot.events.find(
    (e) => e.type === "shot" && e.from.of === "hero",
  );
  assert.equal(event?.type === "shot" && event.damage, gun.damage);
  assert.equal(hero0(shot).cooldown, gun.cooldown);
  // Speed: a step's walk east.
  const walk = (world: World) =>
    hero0(step(map, world, [{ seat: 0, type: "steer", dx: 8, dy: 0 }])).x -
    hero0(world).x;
  assert.equal(walk(plain), HEROES.brick.speed);
  assert.equal(
    walk(holding(arena("brick"), BOOTS)),
    HEROES.brick.speed + ITEMS[BOOTS]!.speed,
  );
  // Cooldown cut: SHOCKWAVE's cooldown under an Overclock Chip.
  const cast = step(map, armed, [
    { seat: 0, type: "cast", slot: 0, x: 4, y: 6 },
  ]);
  assert.equal(
    hero0(cast).spells[0],
    div(KITS.brick[0]!.cooldown * (100 - ITEMS[CHIP]!.cdr), 100),
  );
});

test("armour cuts the damage a hero takes, and stacked items stop at their caps", () => {
  // Vix has no IRON HIDE, so a tank's shot lands in full but for the armour.
  const hit = (world: World) => {
    addUnit(world, 1, "lightTank", 7, 6, 1000);
    world.heroes[0]!.cooldown = 99;
    return hero0(world).hp - hero0(step(map, world)).hp;
  };
  assert.equal(hit(arena("vix")), UNITS.lightTank.damage);
  assert.equal(
    hit(holding(arena("vix"), PLATE)),
    div(UNITS.lightTank.damage * (100 - ITEMS[PLATE]!.armour), 100),
  );
  const stacked = bonusOf([PLATE, PLATE, PLATE, PLATE, PLATE, PLATE]);
  assert.equal(stacked.armour, ITEM_CAPS.armour);
  assert.equal(bonusOf([CHIP, CHIP, CHIP, CHIP]).cdr, ITEM_CAPS.cdr);
});

test("the Aegis SHIELD halves the damage taken for its duration, then cools down", () => {
  const world = holding(arena("brick"), AEGIS);
  world.heroes[0]!.cooldown = 99;
  addUnit(world, 1, "lightTank", 7, 6, 5000);
  const bare = hero0(world).hp - hero0(step(map, world)).hp;
  const raised = step(map, world, [use(0)]);
  assert.equal(hero0(raised).shield, ITEMS[AEGIS]!.duration);
  assert.equal(
    hero0(world).hp - hero0(raised).hp,
    div(bare * (100 - SHIELD_PERCENT), 100),
  );
  assert.equal(hero0(raised).itemCooldowns[0], ITEMS[AEGIS]!.cooldown);
  assert.ok(raised.events.some((e) => e.type === "item"));
  // Used again while cooling: nothing.
  const again = step(map, raised, [use(0)]);
  assert.equal(hero0(again).itemCooldowns[0], ITEMS[AEGIS]!.cooldown - 1);
  let worn = raised;
  for (let index = 0; index < ITEMS[AEGIS]!.duration; index++)
    worn = step(map, worn);
  assert.equal(hero0(worn).shield, 0);
});

test("the Phase Coil BLINKs to an open tile in reach, and refuses rock, too far and an empty or passive slot", () => {
  const world = holding(arena("brick"), COIL, BLADE);
  const jumped = step(map, world, [use(0, 9, 6)]);
  assert.deepEqual([hero0(jumped).x, hero0(jumped).y], [at(9), at(6)]);
  assert.equal(hero0(jumped).itemCooldowns[0], ITEMS[COIL]!.cooldown);
  const stays = (command: Command) => {
    const next = step(map, world, [command]);
    assert.deepEqual(hero0(next).itemCooldowns, [0, 0, 0, 0, 0, 0]);
    assert.notEqual(hero0(next).x, at(9));
  };
  stays(use(0, 0, 0));
  stays(use(0, 12, 8));
  stays(use(1, 9, 6));
  stays(use(2, 9, 6));
  stays(use(6, 9, 6));
  assert.ok(ITEMS[COIL]!.range < 8 * TILE);
});

test("a MENDER heals its carrier and allied heroes near it", () => {
  const world = createWorld(map, [0, 1, 2], 1);
  for (const [seat, x] of [
    [0, 4],
    [2, 6],
  ] as const)
    Object.assign(world.heroes[seat === 0 ? 0 : 2]!, {
      x: at(x),
      y: at(8),
      hp: 300,
      quiet: 0,
    });
  holding(world, MENDER);
  let next = world;
  for (let index = 0; index < 2 * STEPS_PER_SECOND; index++)
    next = step(map, next);
  // Not calm (`quiet` reset), so only the aura heals: 20 a second each.
  assert.ok(hero0(next).hp >= 300 + 2 * 20 && next.heroes[2]!.hp >= 340);
  const lone = createWorld(map, [0, 1, 2], 1);
  Object.assign(lone.heroes[2]!, { x: at(6), y: at(8), hp: 300, quiet: 0 });
  let alone = lone;
  for (let index = 0; index < 2 * STEPS_PER_SECOND; index++)
    alone = step(map, alone);
  assert.ok(alone.heroes[2]!.hp < next.heroes[2]!.hp);
});

/** A tiny match whose seat 0 holds an Aegis and a Core Cell, as a checkpoint that decodes. */
function wireOf(): unknown[] {
  const world = holding(createWorld(map, [0, 1], 1), AEGIS, CELL);
  Object.assign(world.heroes[0]!, {
    hp: maxHp(1) + ITEMS[AEGIS]!.hp + ITEMS[CELL]!.hp,
    itemCooldowns: [5, 0, 0, 0, 0, 0],
    shield: 3,
  });
  const wire = structuredClone(encodeWorld(world)) as unknown[];
  const back = decodeWorld(structuredClone(wire), map);
  assert.deepEqual(back?.heroes[0]!.items, world.heroes[0]!.items);
  assert.equal(back?.heroes[0]!.shield, 3);
  return wire;
}
const ITEMS_AT = 28;
const set =
  (index: number, value: unknown) =>
  (hero: unknown[]): void => {
    hero[index] = value;
  };
const corrupt: [string, (hero: unknown[]) => void][] = [
  ["an unknown item", set(ITEMS_AT, [12, -1, -1, -1, -1, -1])],
  ["too few slots", set(ITEMS_AT, [9, 4])],
  ["a cooldown on a passive item", set(ITEMS_AT + 1, [5, 5, 0, 0, 0, 0])],
  [
    "a cooldown past the active's",
    set(ITEMS_AT + 1, [ITEMS[AEGIS]!.cooldown + 1, 0, 0, 0, 0, 0]),
  ],
  ["a negative cooldown", set(ITEMS_AT + 1, [-1, 0, 0, 0, 0, 0])],
  ["a shield past the longest", set(ITEMS_AT + 2, ITEMS[AEGIS]!.duration + 1)],
  [
    "hit points past the items'",
    set(3, maxHp(1) + ITEMS[AEGIS]!.hp + ITEMS[CELL]!.hp + 1),
  ],
  ["hit points of an item sold", set(ITEMS_AT, [AEGIS, -1, -1, -1, -1, -1])],
];

for (const [label, change] of corrupt)
  test(`a checkpoint with ${label} is refused`, () => {
    const wire = wireOf();
    change((wire[7] as unknown[][])[0]!);
    assert.equal(decodeWorld(wire, map), undefined);
  });

test("a checkpoint with a shield on a fallen hero is refused", () => {
  const world = createWorld(map, [0, 1], 1);
  Object.assign(world.heroes[1]!, { hp: 0, respawn: 1, shield: 1 });
  assert.equal(decodeWorld(encodeWorld(world), map), undefined);
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const each of Object.values(value)) deepFreeze(each);
    Object.freeze(value);
  }
  return value;
};

test("buying, selling and using items leave the step's input untouched", () => {
  const world = holding(shopper(), COIL, AEGIS);
  const frozen = deepFreeze(structuredClone(world));
  let next = step(map, frozen, [buy(BLADE), sell(1), use(0, 3, 3)]);
  next = step(map, next, [use(1)]);
  assert.deepEqual(frozen, world);
  assert.equal(hero0(next).items[2], BLADE);
});

test("a hero that falls under its SHIELD loses it, and the world still checkpoints", () => {
  const world = holding(arena("brick"), AEGIS);
  Object.assign(world.heroes[0]!, { hp: 1, energy: 100, cooldown: 99 });
  addUnit(world, 1, "lightTank", 7, 6, UNITS.lightTank.hp);
  const fallen = step(map, world, [use(0)]);
  assert.equal(hero0(fallen).hp, 0);
  assert.equal(hero0(fallen).shield, 0);
  // The foe's long respawn is past a checkpoint's bound, so bring it home first.
  Object.assign(fallen.heroes[1]!, { respawn: 1 });
  assert.ok(decodeWorld(encodeWorld(fallen), map));
});

test("an active still cooling can't be sold (no refresh by rebuying), and a sale's refund caps the purse", () => {
  const world = holding(shopper(), AEGIS);
  const raised = step(map, world, [use(0)]);
  const kept = step(map, raised, [sell(0)]);
  assert.deepEqual(hero0(kept).items[0], AEGIS);
  assert.equal(hero0(kept).gold, hero0(raised).gold);
  const rich = holding(shopper(GOLD.max - 10), CELL);
  assert.equal(hero0(step(map, rich, [sell(0)])).gold, GOLD.max);
});

test("BLINK crosses rock, but never onto ground its fort can't reach", () => {
  const walled = loadMap({
    ...tinyFile(),
    terrain: [
      "##############",
      "#............#",
      "#............#",
      "#..###.##....#",
      "#..#.#.......#",
      "#..###.......#",
      "#............#",
      "#............#",
      "#............#",
      "##############",
    ],
    // A flag of its own, so the map loads with a pocket nothing walks into.
    flags: [...tinyFile().flags, { x: 4, y: 4 }],
  });
  const world = holding(createWorld(walled, [0, 1], 1), COIL);
  Object.assign(world.heroes[0]!, { x: at(4), y: at(7) });
  const sealed = step(walled, world, [use(0, 4, 4)]);
  assert.equal(hero0(sealed).y, at(7), "the pocket is sealed");
  const over = step(walled, world, [use(0, 4, 1)]);
  assert.deepEqual([hero0(over).x, hero0(over).y], [at(4), at(1)]);
});

test("a bot buys its hero's build in order at its fort, when it can afford the next item", () => {
  const world = shopper(ITEMS[BOOTS]!.cost);
  assert.equal(BUILDS.brick[0], BOOTS);
  assert.deepEqual(shopCommands(map, hero0(world)), [buy(BOOTS)]);
  const next = step(map, world, shopCommands(map, hero0(world)));
  assert.deepEqual(hero0(next).items[0], BOOTS);
  assert.equal(nextBuy(hero0(next)), BUILDS.brick[1]);
  assert.deepEqual(shopCommands(map, hero0(next)), [], "too poor for more");
  const away = shopper();
  Object.assign(away.heroes[0]!, { x: at(4), y: at(6) });
  assert.deepEqual(shopCommands(map, hero0(away)), []);
  assert.equal(nextBuy(holding(shopper(), ...BUILDS.brick).heroes[0]!), -1);
});

test("a bot raises its SHIELD when hurt under fire, and BLINKs onto a hurt enemy hero out of reach", () => {
  const world = holding(arena("brick"), AEGIS);
  Object.assign(world.heroes[0]!, { hp: 200, quiet: 0 });
  assert.deepEqual(activeCommands(map, world, hero0(world)), [use(0)]);
  Object.assign(world.heroes[0]!, { hp: maxHp(1) });
  assert.deepEqual(activeCommands(map, world, hero0(world)), []);
  const chase = holding(arena("brick"), COIL);
  Object.assign(chase.heroes[0]!, { x: at(2), y: at(6) });
  Object.assign(chase.heroes[1]!, {
    hp: 100,
    respawn: 0,
    x: at(12),
    y: at(6),
  });
  const [blink] = activeCommands(map, chase, hero0(chase));
  assert.equal(blink?.type, "useItem");
  const landed = hero0(step(map, chase, [blink!]));
  assert.ok(landed.x > at(2), "it jumped toward its quarry");
  assert.ok(at(12) - landed.x <= HEROES.brick.range, "and has it in range");
});
