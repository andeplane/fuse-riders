import {
  MAX_LEVEL,
  MAX_XP,
  cast,
  centreOf,
  createWorld,
  levelXp,
  respawnSteps,
  type Hero,
  type HeroKind,
  type Unit,
  type UnitKind,
  type World,
} from "../../src/engine/index.js";
import { tiny } from "./maps.js";

/**
 * The world with every hero dead at the top level, waiting its full respawn (1,040 steps), so a rule test about
 * units, turrets or forts sees no hero shoot, capture or level up. It still decodes.
 */
export const benchHeroes = (world: World): World => ({
  ...world,
  heroes: world.heroes.map((hero) => ({
    ...hero,
    hp: 0,
    xp: MAX_XP,
    cooldown: 0,
    respawn: respawnSteps(MAX_LEVEL),
  })),
});

/**
 * Seat 0's `kind` at `level` in the open middle of the tiny map (tile 4, 6), facing east with 200 energy, against
 * seat 1's `foe` waiting at its fort to respawn, so only what a test adds fights.
 */
export function arena(kind: HeroKind, level = 1, foe: HeroKind = "brick") {
  const world = createWorld(tiny(), [0, 1], 1, { 0: kind, 1: foe });
  const [hero, other] = world.heroes as [Hero, Hero];
  Object.assign(hero, { x: centreOf(4), y: centreOf(6) });
  Object.assign(hero, { xp: levelXp(level), energy: 200 });
  Object.assign(other, { hp: 0, respawn: 900 });
  return world;
}

/** Adds a unit of `owner`'s on tile (`tx`, `ty`) with `hp` hit points; returns it. */
export function addUnit(
  world: World,
  owner: number,
  kind: UnitKind,
  tx: number,
  ty: number,
  hp = 1000,
): Unit {
  const unit = {
    id: world.nextId++,
    kind,
    owner,
    x: centreOf(tx),
    y: centreOf(ty),
  };
  world.units.push({
    ...unit,
    hp,
    cooldown: 0,
    goal: -1,
    stun: 0,
    rally: 0,
    lane: -1,
    wave: 0,
  });
  return world.units.at(-1)!;
}

/** Casts seat 0's `slot` at tile (`tx`, `ty`) on a copy of `world`: whether it was cast, and the copy. */
export function fire(
  world: World,
  slot: number,
  tx = 4,
  ty = 6,
): [boolean, World] {
  const next = structuredClone(world);
  return [cast(tiny(), next, next.heroes[0]!, slot, tx, ty), next];
}
