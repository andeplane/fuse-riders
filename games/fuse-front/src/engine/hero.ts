/**
 * Heroes: one per player, of the kind picked for it (`HEROES`). A hero walks to the tile `move` sent it to along
 * that tile's flow field, or in the held `steer` direction (the latest command wins; steering clears a move and a
 * move releases the stick). It
 * shoots while it walks (`combat.ts`), takes flags like a robot (`step.ts`), and gains XP for kills, assists and
 * captures; its level, and with it its hit points, energy and damage, follows from its XP. A dead hero waits a delay
 * that grows with its level and respawns on its fort's tile. Heroes do not push or get pushed by units.
 */
import { DIRS, UNREACHABLE, flowField } from "./flow.js";
import type { GameMap } from "./map.js";
import { div, isqrt } from "./math.js";
import { centreOf, settle, tileOf } from "./move.js";
import {
  ASSIST_RADIUS,
  HERO,
  HEROES,
  HERO_XP,
  HERO_XP_PER_LEVEL,
  MAX_LEVEL,
  STEER_MAX,
  XP_STEP,
  teamOf,
  type HeroKind,
} from "./tuning.js";
import { fortSite, type Hero, type World } from "./world.js";

/** The total XP level `level` needs. */
export const levelXp = (level: number): number =>
  (XP_STEP * level * (level - 1)) / 2;
/** XP stops counting at the top level, so it stays bounded. */
export const MAX_XP = levelXp(MAX_LEVEL);

export function levelOf(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= levelXp(level + 1)) level++;
  return level;
}

export const maxHp = (level: number, kind: HeroKind = "brick"): number =>
  HEROES[kind].hp + HEROES[kind].hpPerLevel * (level - 1);
export const maxEnergy = (level: number): number =>
  HERO.energy + HERO.energyPerLevel * (level - 1);
/** A hero's gun at a level, shaped like `UnitStats` for `combat.ts`. */
export const heroShot = (level: number, kind: HeroKind = "brick") => ({
  range: HEROES[kind].range,
  damage: HEROES[kind].damage + HEROES[kind].damagePerLevel * (level - 1),
  cooldown: HERO.cooldown,
  siege: HERO.siege,
});
export const respawnSteps = (level: number): number =>
  HERO.respawn + HERO.respawnPerLevel * level;

export const alive = (hero: Hero): boolean => hero.hp > 0;

/**
 * A hero falls to `killer`'s seat: it waits to respawn with its gun at rest, its move and CLOAK gone.
 * Returns the XP the kill is worth, for the caller to `award`.
 */
export function fell(world: World, hero: Hero, killer: number): number {
  const { seat, x, y } = hero;
  const level = levelOf(hero.xp);
  Object.assign(hero, {
    hp: 0,
    respawn: respawnSteps(level),
    cooldown: 0,
    goal: -1,
    quiet: 0,
    cloak: 0,
  });
  world.events.push({ type: "heroDeath", seat, killer, x, y });
  return HERO_XP + HERO_XP_PER_LEVEL * level;
}

/** The `DIRS` index nearest a direction: an axis counts when it is at least 0.4 of the other. */
export function facingOf(dx: number, dy: number, facing: number): number {
  const ax = dx < 0 ? -dx : dx,
    ay = dy < 0 ? -dy : dy;
  const sx = 5 * ax >= 2 * ay ? (dx > 0 ? 1 : dx < 0 ? -1 : 0) : 0;
  const sy = 5 * ay >= 2 * ax ? (dy > 0 ? 1 : dy < 0 ? -1 : 0) : 0;
  const dir = DIRS.findIndex(([x, y]) => x === sx && y === sy);
  return dir < 0 ? facing : dir;
}

/** Adds XP (up to `MAX_XP`); a level gained adds its hit points and energy, and is announced. */
export function gainXp(world: World, hero: Hero, amount: number): void {
  const before = levelOf(hero.xp);
  hero.xp = hero.xp + amount < MAX_XP ? hero.xp + amount : MAX_XP;
  const after = levelOf(hero.xp);
  if (after === before) return;
  if (alive(hero))
    hero.hp += maxHp(after, hero.kind) - maxHp(before, hero.kind);
  hero.energy += maxEnergy(after) - maxEnergy(before);
  world.events.push({ type: "levelUp", seat: hero.seat, level: after });
}

/**
 * XP for a kill at (x, y) of something on `victimTeam`: all of it to the killer's hero, wherever it is, and half to
 * each other living hero of another team within `ASSIST_RADIUS`. Heroes are visited by seat.
 */
export function award(
  world: World,
  killer: number,
  victimTeam: number,
  x: number,
  y: number,
  amount: number,
): void {
  for (const hero of world.heroes) {
    if (teamOf(hero.seat) === victimTeam) continue;
    if (hero.seat === killer) gainXp(world, hero, amount);
    else if (alive(hero)) {
      const dx = hero.x - x,
        dy = hero.y - y;
      if (dx * dx + dy * dy <= ASSIST_RADIUS * ASSIST_RADIUS)
        gainXp(world, hero, div(amount, 2));
    }
  }
}

/** This step's velocity: the stick's direction, scaled by its magnitude, else the next flow-field tile's centre. */
function velocity(map: GameMap, hero: Hero): [number, number] {
  const { steerX: sx, steerY: sy } = hero;
  const speed = HEROES[hero.kind].speed;
  if (sx !== 0 || sy !== 0) {
    const length = isqrt(sx * sx + sy * sy);
    const scale = speed * (length < STEER_MAX ? length : STEER_MAX);
    return [
      div(sx * scale, length * STEER_MAX),
      div(sy * scale, length * STEER_MAX),
    ];
  }
  if (hero.goal < 0) return [0, 0];
  const at = tileOf(hero.y) * map.width + tileOf(hero.x);
  const field = flowField(map, hero.goal, true);
  if (field.cost[at] === UNREACHABLE) {
    hero.goal = -1;
    return [0, 0];
  }
  let target = hero.goal;
  if (at !== hero.goal) {
    const [dx, dy] = DIRS[field.next[at]!]!;
    target = at + dy * map.width + dx;
  }
  const tx = target % map.width;
  const dx = centreOf(tx) - hero.x,
    dy = centreOf((target - tx) / map.width) - hero.y;
  const length = isqrt(dx * dx + dy * dy);
  if (length <= speed) {
    if (target === hero.goal) hero.goal = -1;
    return [dx, dy];
  }
  return [div(dx * speed, length), div(dy * speed, length)];
}

/** Walks every living hero one step, by seat. */
export function moveHeroes(map: GameMap, world: World): void {
  for (const hero of world.heroes) {
    if (!alive(hero)) continue;
    const [vx, vy] = velocity(map, hero);
    if (vx === 0 && vy === 0) continue;
    hero.facing = facingOf(vx, vy, hero.facing);
    [hero.x, hero.y] = settle(map, hero.x, hero.y, hero.x + vx, hero.y + vy);
  }
}

/**
 * Early in a step: living heroes regenerate energy, faster when calm (`HERO.calm` steps without shooting or being
 * hit), and a calm hero heals; dead ones count down and respawn on their fort's tile.
 */
export function tendHeroes(map: GameMap, world: World): void {
  for (const hero of world.heroes) {
    const level = levelOf(hero.xp);
    if (alive(hero)) {
      const calm = hero.quiet >= HERO.calm;
      if (!calm) hero.quiet++;
      const every = calm ? HERO.calmEnergyEvery : HERO.energyEvery;
      if (world.step % every === 0 && hero.energy < maxEnergy(level))
        hero.energy++;
      const healed = calm ? hero.hp + HERO.regen : hero.hp;
      if (healed > hero.hp)
        hero.hp =
          healed < maxHp(level, hero.kind) ? healed : maxHp(level, hero.kind);
      continue;
    }
    if (--hero.respawn > 0) continue;
    const fort = fortSite(map, hero.seat);
    hero.x = centreOf(fort.x);
    hero.y = centreOf(fort.y);
    hero.hp = maxHp(level, hero.kind);
    world.events.push({
      type: "respawn",
      seat: hero.seat,
      x: hero.x,
      y: hero.y,
    });
  }
}
