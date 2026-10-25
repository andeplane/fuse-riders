import test from "node:test";
import assert from "node:assert/strict";
import {
  ITEMS,
  ITEM_SLOTS,
  STEPS_PER_SECOND,
  centreOf,
  createWorld,
  viewOf,
  type World,
} from "../src/engine/index.js";
import { keyAction } from "../src/app/hud-state.js";
import {
  atFort,
  itemMark,
  itemStats,
  refundOf,
  shopOf,
  slotsOf,
} from "../src/app/shop-state.js";
import {
  IDLE,
  clickIntent,
  modeFor,
  overlayOf,
  pressItem,
} from "../src/app/targeting.js";
import { TINY, tiny } from "./fixtures/maps.js";

const map = tiny();
const at = centreOf;
const id = (name: string) => ITEMS.findIndex((i) => i.name === name);
const [AEGIS, COIL, BLADE, BOOTS] = [
  "Aegis Projector",
  "Phase Coil",
  "Servo Blade",
  "Track Boots",
].map(id) as [number, number, number, number];
const fort = map.sites[TINY.fort0]!;

/** Seat 0 at its fort with `gold` and `items` in its first slots. */
function world(gold: number, ...items: number[]): World {
  const w = createWorld(map, [0, 1], 1);
  const slots = Array.from({ length: ITEM_SLOTS }, (_, i) => items[i] ?? -1);
  Object.assign(w.heroes[0]!, {
    x: at(fort.x),
    y: at(fort.y),
    gold,
    items: slots,
  });
  return w;
}
const away = (w: World): World => {
  Object.assign(w.heroes[0]!, { x: at(6), y: at(8) });
  return w;
};

test("an item's stats read as short tags, and a sale refunds half its cost", () => {
  assert.deepEqual(itemStats(ITEMS[BLADE]!), ["+10 DMG"]);
  assert.deepEqual(itemStats(ITEMS[AEGIS]!), ["+150 HP", "SHIELD 4s · 40s CD"]);
  assert.deepEqual(itemStats(ITEMS[COIL]!), [
    "+6 DMG",
    "+1 SPEED",
    "BLINK 6 tiles · 25s CD",
  ]);
  assert.equal(itemMark(ITEMS[BOOTS]!), "TB");
  assert.equal(refundOf(BLADE), ITEMS[BLADE]!.cost / 2);
  assert.equal(refundOf(-1), 0);
});

test("the shop knows when the hero stands at its fort, and what it may buy there", () => {
  const rich = viewOf(map, world(ITEMS[BLADE]!.cost));
  assert.ok(atFort(rich, rich.heroes[0]));
  const shop = shopOf(rich, 0);
  assert.equal(shop.gold, ITEMS[BLADE]!.cost);
  assert.deepEqual(
    shop.tabs.map((t) => t.category),
    ["weapons", "armour", "systems", "special"],
  );
  assert.equal(
    shop.tabs.flatMap((t) => t.items).length,
    ITEMS.length,
    "every item in one tab",
  );
  const blade = shop.tabs[0]!.items.find((w) => w.id === BLADE)!;
  assert.deepEqual([blade.buyable, blade.short], [true, 0]);
  const arc = shop.tabs[0]!.items.find((w) => w.item.name === "Arc Cannon")!;
  assert.deepEqual(
    [arc.buyable, arc.short],
    [false, arc.item.cost - ITEMS[BLADE]!.cost],
  );
  // Away from the fort, or with every slot full, nothing is buyable.
  const far = shopOf(viewOf(map, away(world(99_999))), 0);
  assert.ok(
    !far.atFort && far.tabs.every((t) => t.items.every((w) => !w.buyable)),
  );
  const full = shopOf(viewOf(map, world(99_999, 0, 0, 0, 0, 0, 0)), 0);
  assert.ok(
    full.full && full.tabs.every((t) => t.items.every((w) => !w.buyable)),
  );
  // A watcher (no hero) sees a closed shop.
  assert.equal(shopOf(rich, 4).atFort, false);
});

test("the item bar shows each slot's mark, key, cooldown and whether it can be used or sold", () => {
  const w = world(0, AEGIS, BLADE);
  w.heroes[0]!.itemCooldowns = [10 * STEPS_PER_SECOND, 0, 0, 0, 0, 0];
  const [aegis, blade, empty] = slotsOf(viewOf(map, w), 0);
  assert.deepEqual(
    [aegis!.key, aegis!.mark, aegis!.seconds, aegis!.ready, aegis!.sellable],
    ["1", "AP", 10, false, false],
  );
  assert.ok(aegis!.shade > 0 && aegis!.shade < 1);
  assert.deepEqual([blade!.ready, blade!.sellable], [false, true], "passive");
  assert.deepEqual([empty!.id, empty!.sellable], [-1, false]);
  w.heroes[0]!.itemCooldowns = [0, 0, 0, 0, 0, 0];
  assert.equal(slotsOf(viewOf(map, w), 0)[0]!.ready, true);
});

test("keys 1–6 use item slots and B opens the shop", () => {
  assert.deepEqual(keyAction("1"), { kind: "item", slot: 0 });
  assert.deepEqual(keyAction("6"), { kind: "item", slot: 5 });
  assert.deepEqual(keyAction("b"), { kind: "shop" });
  assert.deepEqual(keyAction("B"), { kind: "shop" });
  assert.equal(keyAction("7"), undefined);
  assert.deepEqual(keyAction("q"), { kind: "cast", slot: 0 });
});

test("a SHIELD is used at once; a BLINK aims, lands in reach and draws its range", () => {
  const v = viewOf(map, away(world(0, AEGIS, COIL, BLADE)));
  assert.deepEqual(pressItem(v, 0, IDLE, 0), {
    mode: IDLE,
    use: { x: 6, y: 8 },
  });
  const aiming = pressItem(v, 0, IDLE, 1).mode;
  assert.deepEqual(aiming, { kind: "item", slot: 1 });
  assert.deepEqual(pressItem(v, 0, aiming, 1).mode, IDLE, "pressed again");
  assert.deepEqual(pressItem(v, 0, IDLE, 2), { mode: IDLE }, "passive");
  assert.deepEqual(pressItem(v, 0, IDLE, 3), { mode: IDLE }, "empty");
  assert.deepEqual(clickIntent(v, 0, aiming, { x: 9, y: 8 }, 0), {
    kind: "useItem",
    slot: 1,
    x: 9,
    y: 8,
  });
  assert.equal(clickIntent(v, 0, aiming, { x: 12, y: 1 }, 0).kind, "none");
  assert.equal(clickIntent(v, 0, aiming, { x: 9, y: 8 }, 2).kind, "cancel");
  assert.equal(
    overlayOf(v, 0, aiming, { x: 9, y: 8 }).range,
    ITEMS[COIL]!.range,
  );
  // Cooling: nothing.
  const cooling = away(world(0, AEGIS));
  cooling.heroes[0]!.itemCooldowns = [5, 0, 0, 0, 0, 0];
  assert.deepEqual(pressItem(viewOf(map, cooling), 0, IDLE, 0), {
    mode: IDLE,
  });
});

test("a BLINK aim disarms once its hero falls or its slot is sold", () => {
  const armed = { kind: "item", slot: 1 } as const;
  const w = away(world(0, AEGIS, COIL));
  assert.equal(modeFor(viewOf(map, w), 0, armed), armed);
  w.heroes[0]!.items = [AEGIS, -1, -1, -1, -1, -1];
  assert.equal(modeFor(viewOf(map, w), 0, armed), IDLE);
  const dead = away(world(0, AEGIS, COIL));
  Object.assign(dead.heroes[0]!, { hp: 0, respawn: 10 });
  assert.equal(modeFor(viewOf(map, dead), 0, armed), IDLE);
});
