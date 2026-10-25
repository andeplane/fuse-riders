/**
 * Focus fire. `attack` (`step.ts`) gives a living hero an enemy to shoot: a unit, an uncloaked hero, or a standing
 * turret or fort its team does not hold — anything its gun may pick (`combat.ts`). While that target is in range the
 * hero stands and shoots it before anything nearer; out of range it chases, walking to the target's tile along the
 * roaming flow field (re-pathed every `CHASE_REPATH` steps, so a chase churns the cache no faster than a `move`),
 * shooting the nearest enemy on the way. It drops the focus when the target dies, cloaks or changes sides, or after
 * `FOCUS_GIVE_UP` steps in a row unreachable or (a unit or hero) beyond `CHASE_LEASH`; a `move`, `attackMove`, held
 * `steer` or new `attack` replaces it.
 *
 * `heroTarget` is what the view shows the hero aiming at: its focus, else the enemy its gun picks next.
 */
import { UNREACHABLE, flowField, openTile } from "./flow.js";
import { alive } from "./hero.js";
import { shielded } from "./towers.js";
import type { GameMap } from "./map.js";
import { centreOf, tileOf } from "./move.js";
import {
  CHASE_LEASH,
  CHASE_REPATH,
  FOCUS_GIVE_UP,
  HEROES,
  teamOf,
} from "./tuning.js";
import { MARKS, NEUTRAL, ownerOf, type Hero, type World } from "./world.js";

/** A target the hero's gun may pick, where it stands now. */
export interface Aim {
  of: (typeof MARKS)[number];
  id: number;
  x: number;
  y: number;
}

/** The enemy of `team` that `of` (a `MARKS` index) and `id` name, while a gun may pick it; undefined otherwise. */
export function enemyAt(
  map: GameMap,
  world: World,
  team: number,
  of: number,
  id: number,
): Aim | undefined {
  if (of === 0) {
    const unit = world.units.find((each) => each.id === id);
    if (unit === undefined || teamOf(unit.owner) === team) return;
    return { of: "unit", id, x: unit.x, y: unit.y };
  }
  if (of === 1) {
    const hero = world.heroes.find((each) => each.seat === id);
    if (hero === undefined || !alive(hero) || hero.cloak > 0) return;
    if (teamOf(hero.seat) === team) return;
    return { of: "hero", id, x: hero.x, y: hero.y };
  }
  if (of !== 2) return;
  const building = world.buildings.find((each) => each.id === id);
  if (building === undefined || building.hp <= 0) return;
  const site = map.sites[id]!;
  if (site.kind !== "turret" && site.kind !== "fort") return;
  const owner = ownerOf(map, world, building);
  if (owner === NEUTRAL || teamOf(owner) === team) return;
  // A structure behind another on its lane, or a core behind its gates, can't be shot yet (`towers.ts`).
  if (shielded(map, world, building)) return;
  return { of: "building", id, x: centreOf(site.x), y: centreOf(site.y) };
}

/** The hero's focus while it still stands as a target, else undefined. */
export const focusTarget = (
  map: GameMap,
  world: World,
  hero: Hero,
): Aim | undefined =>
  hero.focusOf < 0
    ? undefined
    : enemyAt(map, world, teamOf(hero.seat), hero.focusOf, hero.focus);

/** The squared distance from the hero to (x, y), and whether that is within its gun's range. */
const away = (hero: Hero, x: number, y: number): number =>
  (x - hero.x) * (x - hero.x) + (y - hero.y) * (y - hero.y);
const inRange = (hero: Hero, { x, y }: { x: number; y: number }): boolean =>
  away(hero, x, y) <= HEROES[hero.kind].range * HEROES[hero.kind].range;

/** Drops a hero's focus (and the chase goal that came with it). */
export function dropFocus(hero: Hero): void {
  if (hero.focusOf >= 0) hero.goal = -1;
  [hero.focusOf, hero.focus, hero.lost] = [-1, -1, 0];
}

/**
 * After combat, before heroes walk: each focused living hero stands while its target is in range, else counts a
 * step lost and paths toward it, dropping the focus when the target is gone or lost too long.
 */
export function chase(map: GameMap, world: World): void {
  for (const hero of world.heroes) {
    if (!alive(hero) || hero.focusOf < 0) continue;
    const aim = focusTarget(map, world, hero);
    if (aim === undefined) {
      dropFocus(hero);
      continue;
    }
    if (inRange(hero, aim)) {
      [hero.goal, hero.lost] = [-1, 0];
      continue;
    }
    // A unit or hero beyond the leash, or a target with no path to it, is lost; a building far off is walked to.
    const far =
      aim.of !== "building" &&
      away(hero, aim.x, aim.y) > CHASE_LEASH * CHASE_LEASH;
    hero.lost = far || hero.goal < 0 ? hero.lost + 1 : 0;
    if (hero.lost >= FOCUS_GIVE_UP) {
      dropFocus(hero);
      continue;
    }
    // A chase paths when it starts or arrives, then only on its cadence, so a target with no path to it cannot
    // build a field every step.
    const fresh = hero.goal < 0 && hero.lost === 1;
    if (!fresh && (world.step + hero.seat) % CHASE_REPATH !== 0) continue;
    const [tx, ty] = [tileOf(aim.x), tileOf(aim.y)];
    const tile = ty * map.width + tx;
    const at = tileOf(hero.y) * map.width + tileOf(hero.x);
    const open =
      openTile(map, tx, ty) &&
      flowField(map, tile, true).cost(at) !== UNREACHABLE;
    hero.goal = open ? tile : -1;
  }
}

/** Whether `a` at squared distance `da` beats `b` at `db`: nearer, then unit, hero, building, then the lower id. */
const RANK = { unit: 0, hero: 1, building: 2 } as const;
export const better = (a: Aim, da: number, b: Aim, db: number): boolean =>
  da !== db ? da < db : a.of !== b.of ? RANK[a.of] < RANK[b.of] : a.id < b.id;

/**
 * What a living hero is shooting at, for the view: its focus (`chosen`), else the enemy its gun would pick from
 * where everything stands (the nearest in range, as `combat.ts` picks), else null.
 */
export function heroTarget(
  map: GameMap,
  world: World,
  hero: Hero,
): (Aim & { chosen: boolean }) | null {
  if (!alive(hero)) return null;
  const focus = focusTarget(map, world, hero);
  if (focus !== undefined) return { ...focus, chosen: true };
  const team = teamOf(hero.seat);
  let best: Aim | undefined,
    bestD = 0;
  const consider = (aim: Aim | undefined) => {
    if (aim === undefined || !inRange(hero, aim)) return;
    const d = away(hero, aim.x, aim.y);
    if (best === undefined || better(aim, d, best, bestD))
      [best, bestD] = [aim, d];
  };
  for (const unit of world.units)
    if (teamOf(unit.owner) !== team)
      consider({ of: "unit", id: unit.id, x: unit.x, y: unit.y });
  for (const each of world.heroes)
    consider(enemyAt(map, world, team, 1, each.seat));
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    // Only a building in range can be picked, so the lookup runs for a few.
    if (inRange(hero, { x: centreOf(site.x), y: centreOf(site.y) }))
      consider(enemyAt(map, world, team, 2, building.id));
  }
  return best === undefined ? null : { ...(best as Aim), chosen: false };
}
