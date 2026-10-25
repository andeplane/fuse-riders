/**
 * What the HUD shows, derived from a `WorldView` for this device's seat: the hero's bars and spell slots,
 * the sector tug-of-war, the production clock and the match timer, plus the factory panel and the key bindings.
 * Pure: `deriveHud` fills one reused record, so a frame that changes nothing allocates nothing but the timer text.
 */
import {
  FACTORY_KINDS,
  KITS,
  MAX_LEVEL,
  STEPS_PER_SECOND,
  SUB,
  TILE_PX,
  UNITS,
  UNIT_CAP,
  clockRate,
  levelXp,
  teamOf,
  type BuildingView,
  type HeroKind,
  type UnitKind,
  type WorldView,
} from "../engine/index.js";
import { ITEM_KEYS } from "./shop-state.js";

/**
 * The record `deriveHud` fills, for the seat's hero `kind` (its kit names the spell slots). Bars are shares 0 to 1, `respawn` is seconds (0 while alive), `red`/`neutral`/`blue`
 * count sectors, `clock` is this team's production clock in percent and `time` the match time as `m:ss`. Each spell
 * slot has whole `seconds` of cooldown left and the `shade` share of it still to run, is `locked` below its unlock
 * level, and `ready` when a press would cast (alive, unlocked, cooled down, with the energy).
 */
export function createHud() {
  const spells = KITS.brick.map((spell, i) => ({
    effect: spell.effect as string,
    name: spell.name,
    key: "QWER"[i]!,
    seconds: 0,
    shade: 0,
    locked: false,
    passive: spell.passive,
    ultimate: spell.unlock > 1,
    ready: false,
  }));
  const hero = {
    kind: "brick" as HeroKind,
    hp: 0,
    energy: 0,
    /** The bars' whole hit points and energy. */
    hpNow: 0,
    energyNow: 0,
    xp: 0,
    /** The player's whole gold. */
    gold: 0,
    level: 1,
    respawn: 0,
    spells,
  };
  const sectors = { red: 0, neutral: 0, blue: 0, clock: 100 };
  return { ...hero, ...sectors, time: "0:00" };
}
export type HudState = ReturnType<typeof createHud>;

const seconds = (steps: number) => Math.ceil(steps / STEPS_PER_SECOND);

/** Fills `out` from `world` for `seat` (or a watcher's view when the seat has no hero) and returns it. */
export function deriveHud(
  out: HudState,
  world: WorldView,
  seat: number,
): HudState {
  const hero = world.heroes.find((h) => h.seat === seat);
  out.red = out.neutral = out.blue = 0;
  for (const owner of world.sectorOwners)
    if (owner < 0) out.neutral++;
    else if (teamOf(owner) === 0) out.red++;
    else out.blue++;
  out.clock = clockRate(seat < 0 ? 0 : teamOf(seat) === 0 ? out.red : out.blue);
  const total = Math.floor(world.step / STEPS_PER_SECOND);
  out.time = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  const level = hero?.level ?? 1;
  out.level = level;
  out.hp = hero ? hero.hp / hero.maxHp : 0;
  out.energy = hero ? hero.energy / hero.maxEnergy : 0;
  out.hpNow = Math.max(0, Math.ceil(hero?.hp ?? 0));
  out.energyNow = Math.floor(hero?.energy ?? 0);
  const from = levelXp(level);
  out.xp = !hero
    ? 0
    : level >= MAX_LEVEL
      ? 1
      : (hero.xp - from) / (levelXp(level + 1) - from);
  out.gold = hero?.gold ?? 0;
  out.respawn = hero && hero.hp <= 0 ? seconds(hero.respawn) : 0;
  out.kind = hero?.kind ?? "brick";
  KITS[out.kind].forEach((spell, i) => {
    const slot = out.spells[i]!;
    slot.effect = spell.effect;
    slot.name = spell.name;
    slot.passive = spell.passive;
    slot.ultimate = spell.unlock > 1;
    const left = hero?.spells[i] ?? 0;
    slot.seconds = seconds(left);
    slot.shade = spell.cooldown > 0 ? Math.min(1, left / spell.cooldown) : 0;
    slot.locked = level < spell.unlock;
    const able = !!hero && hero.hp > 0 && hero.energy >= spell.energy;
    slot.ready = able && !spell.passive && !slot.locked && left === 0;
  });
  return out;
}

/** The tile the hero stands on, where a `self` spell is cast (`pressSpell`). */
export function heroTile(
  world: WorldView,
  seat: number,
): { x: number; y: number } | undefined {
  const hero = world.heroes.find((h) => h.seat === seat && h.hp > 0);
  const at = (sub: number) => Math.floor(sub / SUB / TILE_PX);
  return hero && { x: at(hero.x), y: at(hero.y) };
}

/** This seat's standing factories, in map order. */
export function factoriesOf(world: WorldView, seat: number): BuildingView[] {
  return world.buildings.filter(
    (b) => b.owner === seat && b.hp > 0 && FACTORY_KINDS[b.kind].length > 0,
  );
}

/**
 * The factory of `seat` a click on `tile` picks: its own tile, or the tiles its sprite stands over (one either side,
 * up to two above).
 */
export function factoryAt(
  world: WorldView,
  tile: { x: number; y: number },
  seat: number,
): BuildingView | undefined {
  return factoriesOf(world, seat).find(
    (b) =>
      Math.abs(b.x - tile.x) <= 1 && b.y - tile.y >= 0 && b.y - tile.y <= 2,
  );
}

/** A factory with what it can build, whole seconds until its batch steps out, and whether the unit cap pauses it. */
export type FactoryPanel = BuildingView & {
  choices: readonly UnitKind[];
  eta: number;
  paused: boolean;
};

/** The orders panel of factory `id`, or undefined once it is no longer this seat's. */
export function factoryPanel(
  world: WorldView,
  id: number,
  seat: number,
): FactoryPanel | undefined {
  const b = factoriesOf(world, seat).find((each) => each.id === id);
  if (!b) return undefined;
  let sectors = 0,
    units = 0;
  for (const owner of world.sectorOwners)
    if (owner >= 0 && teamOf(owner) === b.team) sectors++;
  for (const u of world.units) if (u.owner === seat) units++;
  const left = b.order
    ? (UNITS[b.order].build * 100 * (1000 - b.progress)) / 1000
    : 0;
  const eta = seconds(Math.ceil(left / clockRate(sectors)));
  return {
    ...b,
    choices: FACTORY_KINDS[b.kind],
    eta,
    paused:
      units >=
      (world.players.find((p) => p.seat === seat)?.unitCap ?? UNIT_CAP),
  };
}

export type KeyAction =
  | { kind: "cast"; slot: number }
  | { kind: "attackMove" }
  | { kind: "recentre" }
  | { kind: "zoom"; factor: number }
  | { kind: "home" }
  | { kind: "fight" }
  | { kind: "close" }
  /** An item slot's active (1–6), and the shop panel (B). */
  | { kind: "item"; slot: number }
  | { kind: "shop" };

/** One zoom key press: Z or + closer by this factor, X or - out. */
export const ZOOM_STEP = 1.25;
const ZOOM_KEYS: Readonly<Record<string, number>> = {
  z: 1,
  "+": 1,
  "=": 1,
  x: -1,
  "-": -1,
  _: -1,
};

/**
 * What a key press does: Q/W/E/R cast (or aim), A arms an attack-move, Space or F follows the
 * hero again, Z/X or +/- zoom a step in or out, Home looks at this seat's fort, Tab at the latest fight, Escape
 * cancels aiming and closes a panel, 1–6 use an item slot's active and B opens or closes the shop.
 */
export function keyAction(key: string): KeyAction | undefined {
  const slot = key.length === 1 ? "QWER".indexOf(key.toUpperCase()) : -1;
  if (slot >= 0) return { kind: "cast", slot };
  if (key === "a" || key === "A") return { kind: "attackMove" };
  if (key === " " || key === "f" || key === "F") return { kind: "recentre" };
  const zoom = ZOOM_KEYS[key.toLowerCase()];
  if (zoom)
    return { kind: "zoom", factor: zoom > 0 ? ZOOM_STEP : 1 / ZOOM_STEP };
  if (key === "Home") return { kind: "home" };
  if (key === "Tab") return { kind: "fight" };
  if (key === "Escape") return { kind: "close" };
  const item = key.length === 1 ? ITEM_KEYS.indexOf(key) : -1;
  if (item >= 0) return { kind: "item", slot: item };
  if (key === "b" || key === "B") return { kind: "shop" };
  return undefined;
}
