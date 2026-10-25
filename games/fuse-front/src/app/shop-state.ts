/**
 * What the shop panel and the item bar show (v3 M3), derived from a `WorldView` for this device's seat: the shop's
 * items by category with what each gives and whether it can be bought now, the hero's six slots with their cooldowns
 * and what each sells for, and whether the hero stands in its fort's courtyard, where it shops. Pure.
 */
import {
  FOUNTAIN,
  ITEMS,
  ITEM_CATEGORIES,
  SELL_PERCENT,
  STEPS_PER_SECOND,
  TILE,
  type HeroView,
  type Item,
  type ItemCategory,
  type WorldView,
} from "../engine/index.js";

/** The keys that use item slots 1–6 (the stance keys went in M2d). */
export const ITEM_KEYS = "123456";

/** An item's stats as short tags: "+10 DMG", "+20% HASTE", "SHIELD 4s / 40s" and so on. */
export function itemStats(item: Readonly<Item>): string[] {
  const tags: string[] = [];
  const add = (value: number, text: string) => value && tags.push(text);
  add(item.damage, `+${item.damage} DMG`);
  add(item.armour, `${item.armour}% ARMOUR`);
  add(item.hp, `+${item.hp} HP`);
  add(item.energy, `+${item.energy} EN`);
  add(item.cdr, `-${item.cdr}% COOLDOWN`);
  add(item.speed, `+${item.speed} SPEED`);
  add(item.haste, `+${item.haste}% HASTE`);
  const secs = (steps: number) => `${steps / STEPS_PER_SECOND}s`;
  if (item.active === "shield")
    tags.push(`SHIELD ${secs(item.duration)} · ${secs(item.cooldown)} CD`);
  if (item.active === "blink")
    tags.push(`BLINK ${item.range / TILE} tiles · ${secs(item.cooldown)} CD`);
  if (item.aura) tags.push("HEAL AURA");
  return tags;
}

/** A short mark for an item's slot: its initials. */
export const itemMark = (item: Readonly<Item>): string =>
  item.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);

/** What a sale of item `id` refunds. */
export const refundOf = (id: number): number =>
  Math.floor(((ITEMS[id]?.cost ?? 0) * SELL_PERCENT) / 100);

/** Whether `hero` stands in its own fort's courtyard (`FOUNTAIN.radius`), where it heals and shops. */
export function atFort(world: WorldView, hero: HeroView | undefined): boolean {
  if (!hero || hero.hp <= 0) return false;
  return world.buildings.some((b) => {
    if (b.kind !== "fort" || b.owner !== hero.seat) return false;
    const dx = hero.x - (b.x + 0.5) * TILE,
      dy = hero.y - (b.y + 0.5) * TILE;
    return dx * dx + dy * dy <= FOUNTAIN.radius * FOUNTAIN.radius;
  });
}

export interface SlotState {
  slot: number;
  key: string;
  /** -1 for an empty slot. */
  id: number;
  name: string;
  mark: string;
  /** Whole seconds until its active is ready, and the share of the cooldown still to run. */
  seconds: number;
  shade: number;
  /** It has an active that a press would use now. */
  ready: boolean;
  active: Item["active"];
  /** What a sale gives, and whether one is possible now (at the fort, cooled down). */
  refund: number;
  sellable: boolean;
}

export interface ShopEntry {
  id: number;
  item: Readonly<Item>;
  stats: string[];
  /** Whether a buy goes through now: at the fort, a free slot and the gold. */
  buyable: boolean;
  /** Gold still missing, 0 when it can be afforded. */
  short: number;
}

export interface ShopState {
  gold: number;
  atFort: boolean;
  full: boolean;
  slots: SlotState[];
  /** The shop by category, in table order within each. */
  tabs: { category: ItemCategory; items: ShopEntry[] }[];
}

/** The hero's slots, for the item bar and the shop's sell row. */
export function slotsOf(world: WorldView, seat: number): SlotState[] {
  const hero = world.heroes.find((h) => h.seat === seat);
  const home = atFort(world, hero);
  return [...ITEM_KEYS].map((key, slot) => {
    const id = hero?.items[slot] ?? -1;
    const item = ITEMS[id];
    const left = hero?.itemCooldowns[slot] ?? 0;
    const alive = !!hero && hero.hp > 0;
    return {
      slot,
      key,
      id,
      name: item?.name ?? "",
      mark: item ? itemMark(item) : "",
      seconds: Math.ceil(left / STEPS_PER_SECOND),
      shade: item?.cooldown ? Math.min(1, left / item.cooldown) : 0,
      ready: alive && !!item?.active && left === 0,
      active: item?.active ?? null,
      refund: item ? refundOf(id) : 0,
      sellable: !!item && home && left === 0,
    };
  });
}

/** The shop for `seat`'s hero. */
export function shopOf(world: WorldView, seat: number): ShopState {
  const hero = world.heroes.find((h) => h.seat === seat);
  const gold = hero?.gold ?? 0;
  const home = atFort(world, hero);
  const full = !hero || !hero.items.includes(-1);
  const tabs = ITEM_CATEGORIES.map((category) => ({
    category,
    items: ITEMS.flatMap((item, id) =>
      item.category !== category
        ? []
        : [
            {
              id,
              item,
              stats: itemStats(item),
              buyable: home && !full && gold >= item.cost,
              short: Math.max(0, item.cost - gold),
            },
          ],
    ),
  }));
  return { gold, atFort: home, full, slots: slotsOf(world, seat), tabs };
}
