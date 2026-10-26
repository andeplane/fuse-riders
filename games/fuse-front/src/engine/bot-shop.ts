/**
 * What a bot does with gold and items (v3 M3), as ordinary commands: at its fort it buys the next item of its hero's
 * build (`BUILDS`) it can afford, one a tick; anywhere it raises an Aegis SHIELD when hurt with an enemy near, and
 * BLINKs onto a hurt enemy hero just out of its gun's reach. Pure, like `bot.ts`.
 */
import { UNREACHABLE, flowField, openTile } from "./flow.js";
import { atFountain } from "./gold.js";
import { alive, heroMaxHp } from "./hero.js";
import { ITEMS } from "./items.js";
import { div, isqrt } from "./math.js";
import { centreOf, tileOf } from "./move.js";
import type { Command } from "./step.js";
import { AIM_SLACK, HEROES, TILE, teamOf, type HeroKind } from "./tuning.js";
import { fortSite, type Hero, type World } from "./world.js";
import type { GameMap } from "./map.js";

const item = (name: string): number => {
  const id = ITEMS.findIndex((each) => each.name === name);
  if (id < 0) throw new Error(`no item ${name}`);
  return id;
};

/** Each hero's build, bought in order: boots or a basic first, then its big items. */
export const BUILDS: Readonly<Record<HeroKind, readonly number[]>> = {
  brick: [
    "Track Boots",
    "Core Cell",
    "Bulwark Frame",
    "Aegis Projector",
    "Mender Beacon",
    "Plate Weave",
  ].map(item),
  vix: [
    "Track Boots",
    "Servo Blade",
    "Arc Cannon",
    "Phase Coil",
    "Rapid Feed",
    "Plate Weave",
  ].map(item),
  rivet: [
    "Core Cell",
    "Overclock Chip",
    "Mender Beacon",
    "Bulwark Frame",
    "Aegis Projector",
    "Track Boots",
  ].map(item),
  tally: [
    "Track Boots",
    "Rapid Feed",
    "Arc Cannon",
    "Phase Coil",
    "Core Cell",
    "Servo Blade",
  ].map(item),
};

/** The next item of `hero`'s build it does not hold yet, or -1 once it holds them all. */
export function nextBuy(hero: Hero): number {
  const held = [...hero.items];
  for (const id of BUILDS[hero.kind]) {
    const at = held.indexOf(id);
    if (at < 0) return id;
    held[at] = -1;
  }
  return -1;
}

/** A bot hero at its fort buys the next item of its build when it can afford it and has a slot. */
export function shopCommands(map: GameMap, hero: Hero): Command[] {
  if (!alive(hero) || !atFountain(map, hero) || !hero.items.includes(-1))
    return [];
  const id = nextBuy(hero);
  if (id < 0 || hero.gold < ITEMS[id]!.cost) return [];
  return [{ seat: hero.seat, type: "buy", item: id }];
}

const near = (a: Hero, x: number, y: number, r: number) =>
  (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y) <= r * r;
/** How near an enemy must be for a hurt bot to raise its SHIELD. */
const THREAT = 8 * TILE;

/** A bot uses an item active when it pays: SHIELD when hurt under threat, BLINK onto a fleeing hurt enemy hero. */
export function activeCommands(
  map: GameMap,
  world: World,
  hero: Hero,
): Command[] {
  if (!alive(hero)) return [];
  const { seat } = hero;
  const ready = (active: "shield" | "blink"): number =>
    hero.items.findIndex(
      (id, slot) =>
        ITEMS[id]?.active === active && hero.itemCooldowns[slot] === 0,
    );
  const foes = world.heroes.filter(
    (each) => alive(each) && teamOf(each.seat) !== teamOf(seat),
  );
  const shield = ready("shield");
  if (
    shield >= 0 &&
    hero.shield === 0 &&
    hero.hp * 2 < heroMaxHp(hero) &&
    (hero.quiet === 0 || foes.some((foe) => near(hero, foe.x, foe.y, THREAT)))
  )
    return [{ seat, type: "useItem", slot: shield, x: 0, y: 0 }];
  const blink = ready("blink");
  if (blink < 0 || hero.hp * 2 < heroMaxHp(hero)) return [];
  const range = HEROES[hero.kind].range;
  // It lands a tile inside its gun's range of the quarry, so the jump is at most the coil's reach.
  const reach = range - TILE + ITEMS[hero.items[blink]!]!.range;
  const quarry = foes.find(
    (foe) =>
      foe.cloak === 0 &&
      foe.hp * 10 < heroMaxHp(foe) * 4 &&
      !near(hero, foe.x, foe.y, range) &&
      near(hero, foe.x, foe.y, reach),
  );
  if (quarry === undefined) return [];
  const [dx, dy] = [quarry.x - hero.x, quarry.y - hero.y];
  const length = isqrt(dx * dx + dy * dy);
  const jump = length - range + TILE;
  const x = tileOf(hero.x + div(dx * jump, length));
  const y = tileOf(hero.y + div(dy * jump, length));
  // The shop's own checks (`useItem`): the landing tile's centre within reach, open, and on its fort's ground.
  const [cx, cy] = [centreOf(x) - hero.x, centreOf(y) - hero.y];
  const most = ITEMS[hero.items[blink]!]!.range + AIM_SLACK;
  if (cx * cx + cy * cy > most * most || !openTile(map, x, y)) return [];
  const home = fortSite(map, seat);
  const field = flowField(map, home.y * map.width + home.x);
  if (field.cost(y * map.width + x) === UNREACHABLE) return [];
  return [{ seat, type: "useItem", slot: blink, x, y }];
}
