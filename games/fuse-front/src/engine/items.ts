/**
 * Items (v3 M3): the shop's table and what a hero's inventory adds up to. A hero carries up to `ITEM_SLOTS` items
 * (`Hero.items`, by slot, -1 for an empty one), bought and sold at its own fort (`shop.ts`). Each item adds flat
 * stats, and a few have an active (used from its slot, with a cooldown) or an aura. Stats from several items add up,
 * with armour, cooldown cut and haste capped (`ITEM_CAPS`). Everything is whole numbers, so items are as
 * deterministic as the rest of the step.
 */
import { STEPS_PER_SECOND, TILE } from "./tuning.js";

const s = (seconds: number): number => seconds * STEPS_PER_SECOND;

/** The shop's tabs. */
export const ITEM_CATEGORIES = [
  "weapons",
  "armour",
  "systems",
  "special",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** What an item adds: gun damage, percent armour, hit points, energy, percent spell cooldown cut, speed, percent haste. */
export interface ItemStats {
  damage: number;
  armour: number;
  hp: number;
  energy: number;
  /** Percent off every spell's cooldown. */
  cdr: number;
  /** Sub-pixels per step. */
  speed: number;
  /** Percent faster reloading. */
  haste: number;
}

export interface Item extends ItemStats {
  name: string;
  desc: string;
  category: ItemCategory;
  cost: number;
  /**
   * Its active, used from its slot (`useItem`): SHIELD halves the damage the hero takes for `duration` steps; BLINK
   * jumps it to an open tile within `range`. null for an item without one.
   */
  active: "shield" | "blink" | null;
  /** Steps until the active is ready again; 0 without one. */
  cooldown: number;
  /** BLINK's reach (sub-pixels), SHIELD's steps; 0 otherwise. */
  range: number;
  duration: number;
  /** MENDER: living allied heroes within `AURA.radius` (the carrier too) heal `AURA.hp` every `AURA.every` steps. */
  aura: boolean;
}

const none: ItemStats & Omit<Item, "name" | "desc" | "category" | "cost"> = {
  damage: 0,
  armour: 0,
  hp: 0,
  energy: 0,
  cdr: 0,
  speed: 0,
  haste: 0,
  active: null,
  cooldown: 0,
  range: 0,
  duration: 0,
  aura: false,
};
const item = (
  name: string,
  category: ItemCategory,
  cost: number,
  desc: string,
  stats: Partial<Item>,
): Readonly<Item> =>
  Object.freeze({ ...none, name, category, cost, desc, ...stats });

/** The shop, by item id (a checkpoint and the wire name items by index, so only ever append). */
export const ITEMS: readonly Readonly<Item>[] = Object.freeze([
  item("Servo Blade", "weapons", 950, "A heavier gun arm.", { damage: 10 }),
  item("Rapid Feed", "weapons", 1050, "A faster ammunition feed.", {
    haste: 20,
  }),
  item(
    "Arc Cannon",
    "weapons",
    2200,
    "A charged barrel that hits hard and often.",
    {
      damage: 22,
      haste: 15,
    },
  ),
  item("Plate Weave", "armour", 900, "Woven plating over the chassis.", {
    armour: 10,
  }),
  item("Core Cell", "armour", 950, "A spare power core: more hit points.", {
    hp: 220,
  }),
  item(
    "Bulwark Frame",
    "armour",
    2300,
    "A siege frame: hit points and armour.",
    {
      hp: 380,
      armour: 12,
    },
  ),
  item("Capacitor", "systems", 850, "A bigger energy bank.", { energy: 50 }),
  item("Overclock Chip", "systems", 1100, "Spells cool down faster.", {
    cdr: 15,
    energy: 20,
  }),
  item("Track Boots", "systems", 800, "Faster treads.", { speed: 2 }),
  item(
    "Aegis Projector",
    "special",
    1800,
    "Active: halve the damage you take for 4 s.",
    {
      hp: 150,
      active: "shield",
      cooldown: s(40),
      duration: s(4),
    },
  ),
  item(
    "Phase Coil",
    "special",
    1700,
    "Active: blink to a spot up to 6 tiles away.",
    {
      damage: 6,
      speed: 1,
      active: "blink",
      cooldown: s(25),
      range: 6 * TILE,
    },
  ),
  item(
    "Mender Beacon",
    "special",
    1950,
    "Aura: you and allied heroes near you heal 20 a second.",
    {
      hp: 100,
      energy: 30,
      aura: true,
    },
  ),
]);

export const ITEM_SLOTS = 6;
/** Percent of its cost an item sells back for. */
export const SELL_PERCENT = 50;
/** The most armour, cooldown cut and haste items can add up to, in percent. */
export const ITEM_CAPS = { armour: 50, cdr: 40, haste: 100 } as const;
/** SHIELD's cut, in percent of the damage taken. */
export const SHIELD_PERCENT = 50;
/** MENDER's aura. */
export const AURA = { radius: 6 * TILE, hp: 1, every: 2 } as const;
/** An inventory with nothing in it. */
export const NO_ITEMS: readonly number[] = Object.freeze(
  Array.from({ length: ITEM_SLOTS }, () => -1),
);
/** No item cooling down. */
export const NO_COOLDOWNS: readonly number[] = Object.freeze(
  Array.from({ length: ITEM_SLOTS }, () => 0),
);

const least = (a: number, b: number): number => (a < b ? a : b);

/** What `items` (by slot, -1 for empty) add up to, capped. */
export function bonusOf(items: readonly number[]): ItemStats {
  const total: ItemStats = {
    damage: 0,
    armour: 0,
    hp: 0,
    energy: 0,
    cdr: 0,
    speed: 0,
    haste: 0,
  };
  for (const id of items) {
    const each = ITEMS[id];
    if (each === undefined) continue;
    total.damage += each.damage;
    total.armour += each.armour;
    total.hp += each.hp;
    total.energy += each.energy;
    total.cdr += each.cdr;
    total.speed += each.speed;
    total.haste += each.haste;
  }
  total.armour = least(total.armour, ITEM_CAPS.armour);
  total.cdr = least(total.cdr, ITEM_CAPS.cdr);
  total.haste = least(total.haste, ITEM_CAPS.haste);
  return total;
}

/** The longest SHIELD any item gives. */
export const SHIELD_STEPS = ITEMS.reduce(
  (most, each) =>
    each.active === "shield" && each.duration > most ? each.duration : most,
  0,
);

/** The most an item in a slot's cooldown can be: its active's, else 0. */
export const slotCooldown = (id: number): number => ITEMS[id]?.cooldown ?? 0;
