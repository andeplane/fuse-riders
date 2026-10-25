/**
 * The shop and item actives (v3 M3), on the table in `items.ts`. A living hero standing in its own fort's courtyard
 * (`atFountain`) may buy an item into its first empty slot for its cost, or sell a slot's item back for
 * `SELL_PERCENT` of it once its active (if any) has cooled. Anything else (too little gold, no empty slot, away from the fort, dead, no such item) does
 * nothing, so a stale command is harmless. An item's hit points and energy come with it when bought and go with it
 * when sold. Anywhere, a living hero may use a slot's active once it is ready: SHIELD cuts the damage it takes, and
 * BLINK jumps it, over walls, to an open tile within reach that its fort's ground connects to; its orders carry on
 * from where it lands.
 */
import { UNREACHABLE, flowField, openTile } from "./flow.js";
import { atFountain, earn } from "./gold.js";
import { alive, heroMaxEnergy, heroMaxHp } from "./hero.js";
import {
  ITEMS,
  ITEM_SLOTS,
  SELL_PERCENT,
  SHIELD_PERCENT,
  bonusOf,
} from "./items.js";
import type { GameMap } from "./map.js";
import { div } from "./math.js";
import { centreOf } from "./move.js";
import { AIM_SLACK } from "./tuning.js";
import { fortSite, type Hero, type World } from "./world.js";

const least = (a: number, b: number): number => (a < b ? a : b);

/** Buys item `id` for `hero` if it may; returns whether it did. */
export function buy(map: GameMap, hero: Hero, id: number): boolean {
  const item = ITEMS[id];
  if (item === undefined || !alive(hero) || !atFountain(map, hero))
    return false;
  const slot = hero.items.indexOf(-1);
  if (slot < 0 || hero.gold < item.cost) return false;
  const [hp, energy] = [heroMaxHp(hero), heroMaxEnergy(hero)];
  hero.gold -= item.cost;
  hero.items = hero.items.map((each, i) => (i === slot ? id : each));
  hero.itemCooldowns = hero.itemCooldowns.map((each, i) =>
    i === slot ? 0 : each,
  );
  // Like a level gained: what the item adds to the most, it adds now.
  hero.hp += heroMaxHp(hero) - hp;
  hero.energy += heroMaxEnergy(hero) - energy;
  return true;
}

/** Sells `hero`'s item in `slot` if it may; returns whether it did. */
export function sell(map: GameMap, hero: Hero, slot: number): boolean {
  const item = ITEMS[hero.items[slot] ?? -1];
  if (item === undefined || !alive(hero) || !atFountain(map, hero))
    return false;
  // An active still cooling can't be sold, so a sale and a rebuy never refresh it (nor end a SHIELD early).
  if (hero.itemCooldowns[slot]! > 0) return false;
  earn(hero, div(item.cost * SELL_PERCENT, 100));
  hero.items = hero.items.map((each, i) => (i === slot ? -1 : each));
  hero.itemCooldowns = hero.itemCooldowns.map((each, i) =>
    i === slot ? 0 : each,
  );
  hero.hp = least(hero.hp, heroMaxHp(hero));
  hero.energy = least(hero.energy, heroMaxEnergy(hero));
  return true;
}

/** Uses `hero`'s active in `slot`, aimed at tile (`tx`, `ty`) for a BLINK; returns whether it did. */
export function useItem(
  map: GameMap,
  world: World,
  hero: Hero,
  slot: number,
  tx: number,
  ty: number,
): boolean {
  const id = hero.items[slot] ?? -1;
  const item = ITEMS[id];
  if (item?.active == null || !alive(hero)) return false;
  if (hero.itemCooldowns[slot]! > 0) return false;
  const [x, y] = [hero.x, hero.y];
  if (item.active === "blink") {
    // Over walls and water, but onto ground its fort's field reaches, so it never lands on an island.
    if (!openTile(map, tx, ty)) return false;
    const home = fortSite(map, hero.seat);
    const field = flowField(map, home.y * map.width + home.x);
    if (field.cost(ty * map.width + tx) === UNREACHABLE) return false;
    const [toX, toY] = [centreOf(tx), centreOf(ty)];
    const reach = item.range + AIM_SLACK;
    if ((toX - x) * (toX - x) + (toY - y) * (toY - y) > reach * reach)
      return false;
    [hero.x, hero.y] = [toX, toY];
  } else hero.shield = item.duration;
  hero.itemCooldowns = hero.itemCooldowns.map((each, i) =>
    i === slot ? item.cooldown : each,
  );
  world.events.push({
    type: "item",
    seat: hero.seat,
    slot,
    item: id,
    x,
    y,
    toX: hero.x,
    toY: hero.y,
  });
  return true;
}

/** The start of a step: item cooldowns and SHIELDs count down. */
export function tickItems(world: World): void {
  for (const hero of world.heroes) {
    if (hero.shield > 0) hero.shield--;
    if (hero.itemCooldowns.some((left) => left > 0))
      hero.itemCooldowns = hero.itemCooldowns.map((left) =>
        left > 0 ? left - 1 : 0,
      );
  }
}

/** The percent of a hit's damage a hero takes after its items' armour and its SHIELD. */
export function guardOf(hero: Hero): number {
  const armour = 100 - bonusOf(hero.items).armour;
  return hero.shield > 0 ? div(armour * (100 - SHIELD_PERCENT), 100) : armour;
}

/** A spell's cooldown for `hero`, cut by its items (`ItemStats.cdr`). */
export const spellCooldown = (hero: Hero, cooldown: number): number =>
  div(cooldown * (100 - bonusOf(hero.items).cdr), 100);

/** Whether `slot` is a slot index. */
export const isSlot = (slot: number): boolean =>
  Number.isInteger(slot) && slot >= 0 && slot < ITEM_SLOTS;
