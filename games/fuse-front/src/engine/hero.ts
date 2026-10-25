/**
 * Heroes: one per player, of the kind picked for it (`HEROES`). A hero walks to the tile `move` sent it to along
 * that tile's flow field, or in the held `steer` direction (the latest command wins; steering clears a move and a
 * move releases the stick). It
 * shoots while it walks (`combat.ts`), takes flags like a robot (`step.ts`), and gains XP from deaths near it and
 * from captures; its level, and with it its hit points, energy and damage, follows from its XP (`LEVEL_XP`). A dead
 * hero waits a delay that grows with its level, up to a cap, and respawns on its fort's tile. Heroes do not push or
 * get pushed by units.
 */
import { DIRS, UNREACHABLE, flowField } from "./flow.js";
import type { GameMap } from "./map.js";
import { div, isqrt } from "./math.js";
import { razedBy } from "./waves.js";
import { heroBounty, tendGold } from "./gold.js";
import { AURA, ITEMS, bonusOf } from "./items.js";
import { FLARE, centreOf, settle, tileOf } from "./move.js";
import {
  COMEBACK_MAX,
  COMEBACK_XP,
  HERO,
  HEROES,
  HERO_XP,
  HERO_XP_PER_LEVEL,
  LEVEL_XP,
  MAX_LEVEL,
  STEER_MAX,
  XP_GROUP,
  XP_RADIUS,
  teamOf,
  type HeroKind,
} from "./tuning.js";
import { fortSite, type Hero, type World } from "./world.js";

/** The total XP level `level` (1 to `MAX_LEVEL`) needs. */
export const levelXp = (level: number): number => LEVEL_XP[level]!;
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
/** A hero's most hit points and energy: its level's, plus its items' (`items.ts`). */
export const heroMaxHp = (hero: Hero): number =>
  maxHp(levelOf(hero.xp), hero.kind) + bonusOf(hero.items).hp;
export const heroMaxEnergy = (hero: Hero): number =>
  maxEnergy(levelOf(hero.xp)) + bonusOf(hero.items).energy;
/** A hero's gun with its items: their damage on its level's, and their haste on its reload. */
export function heroGun(hero: Hero) {
  const shot = heroShot(levelOf(hero.xp), hero.kind);
  const { damage, haste } = bonusOf(hero.items);
  return {
    ...shot,
    damage: shot.damage + damage,
    cooldown: div(shot.cooldown * 100, 100 + haste),
  };
}
/** Steps a hero of `level` waits dead: `HERO.respawn` plus `HERO.respawnPerLevel` a level, at most `HERO.respawnMax`. */
export function respawnSteps(level: number): number {
  const wait = HERO.respawn + HERO.respawnPerLevel * level;
  return wait < HERO.respawnMax ? wait : HERO.respawnMax;
}

export const alive = (hero: Hero): boolean => hero.hp > 0;

/**
 * A hero falls to `killer`'s seat, which earns its bounty (`heroBounty`): it waits its level's respawn
 * (`respawnSteps`) with its gun at rest, its move, queued orders, SHIELD, CLOAK, BLITZ and FLARE gone. Returns the XP
 * the kill is worth, for the caller to `award`.
 */
export function fell(world: World, hero: Hero, killer: number): number {
  const { seat, x, y } = hero;
  const level = levelOf(hero.xp);
  heroBounty(world, hero, killer);
  Object.assign(hero, {
    hp: 0,
    respawn: respawnSteps(level),
    cooldown: 0,
    goal: -1,
    quiet: 0,
    cloak: 0,
    blitz: 0,
    flare: -1,
    flareLeft: 0,
    focusOf: -1,
    focus: -1,
    lost: 0,
    sweep: 0,
    queue: [],
    wait: 0,
    shield: 0,
  });
  // Its FLARE goes out with it, releasing the robots it drew.
  for (const unit of world.units)
    if (unit.owner === seat && unit.goal === FLARE) unit.goal = -1;
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
 * The percent of XP `team` takes from the comeback rule: `COMEBACK_XP` more for each lane structure it has razed fewer
 * than the other team (`razedBy`), up to `COMEBACK_MAX`.
 */
export function comebackOf(map: GameMap, world: World, team: number): number {
  const razed = razedBy(map, world.buildings);
  const behind = razed[1 - team]! - razed[team]!;
  const bonus = behind > 0 ? COMEBACK_XP * behind : 0;
  return 100 + (bonus < COMEBACK_MAX ? bonus : COMEBACK_MAX);
}

/**
 * XP for a death at (x, y) of something on `victimTeam` (a neutral's is -1) that `killer`'s seat made: shared by the
 * living heroes of the killing team within `XP_RADIUS`, wherever the killer is, so standing in lane is what earns and
 * a last hit earns no more. With n heroes sharing, each takes `(100 + XP_GROUP * (n - 1)) / n` percent, times the
 * team's comeback (`comebackOf`). A kill no seat made earns nothing. Heroes are visited by seat.
 */
export function award(
  map: GameMap,
  world: World,
  killer: number,
  victimTeam: number,
  x: number,
  y: number,
  amount: number,
): void {
  if (killer < 0) return;
  const team = victimTeam < 0 ? teamOf(killer) : 1 - victimTeam;
  const near = world.heroes.filter((hero) => {
    if (teamOf(hero.seat) !== team || !alive(hero)) return false;
    const dx = hero.x - x,
      dy = hero.y - y;
    return dx * dx + dy * dy <= XP_RADIUS * XP_RADIUS;
  });
  if (near.length === 0) return;
  const group = 100 + XP_GROUP * (near.length - 1);
  const percent = div(group * comebackOf(map, world, team), 100);
  const share = div(amount * percent, 100 * near.length);
  for (const hero of near) gainXp(world, hero, share);
}

/** This step's velocity: the stick's direction, scaled by its magnitude, else the next flow-field tile's centre. */
function velocity(map: GameMap, hero: Hero): [number, number] {
  const { steerX: sx, steerY: sy } = hero;
  const speed = HEROES[hero.kind].speed + bonusOf(hero.items).speed;
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
  if (field.cost(at) === UNREACHABLE) {
    hero.goal = -1;
    return [0, 0];
  }
  let target = hero.goal;
  if (at !== hero.goal) {
    const [dx, dy] = DIRS[field.next(at)]!;
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

/**
 * Walks every living hero one step, by seat; one in `holding` (an attack-move with an enemy in range) stands. An
 * attack-move ends with its goal.
 */
export function moveHeroes(
  map: GameMap,
  world: World,
  holding: ReadonlySet<number> = new Set(),
): void {
  for (const hero of world.heroes) {
    if (!alive(hero) || holding.has(hero.seat)) continue;
    const [vx, vy] = velocity(map, hero);
    if (hero.goal < 0) hero.sweep = 0;
    if (vx === 0 && vy === 0) continue;
    hero.facing = facingOf(vx, vy, hero.facing);
    [hero.x, hero.y] = settle(map, hero.x, hero.y, hero.x + vx, hero.y + vy);
  }
}

/**
 * Early in a step: living heroes regenerate energy, faster when calm (`HERO.calm` steps without shooting or being
 * hit), and a calm hero heals, as does one in a MENDER's aura (`items.ts`); dead ones count down and respawn on their
 * fort's tile.
 */
export function tendHeroes(map: GameMap, world: World): void {
  const menders =
    world.step % AURA.every === 0
      ? world.heroes.filter(
          (hero) => alive(hero) && hero.items.some((id) => ITEMS[id]?.aura),
        )
      : [];
  const mended = (hero: Hero): number =>
    menders.some(
      (each) =>
        teamOf(each.seat) === teamOf(hero.seat) &&
        (each.x - hero.x) * (each.x - hero.x) +
          (each.y - hero.y) * (each.y - hero.y) <=
          AURA.radius * AURA.radius,
    )
      ? AURA.hp
      : 0;
  for (const hero of world.heroes) {
    const most = heroMaxHp(hero);
    const mostEnergy = heroMaxEnergy(hero);
    // The trickle and the fountain (`gold.ts`).
    const [spring, sip] = tendGold(map, world, hero, most);
    if (alive(hero)) {
      const calm = hero.quiet >= HERO.calm;
      if (!calm) hero.quiet++;
      const every = calm ? HERO.calmEnergyEvery : HERO.energyEvery;
      const tick = world.step % every === 0 ? 1 : 0;
      const energy = hero.energy + tick + sip;
      if (energy > hero.energy && hero.energy < mostEnergy)
        hero.energy = energy < mostEnergy ? energy : mostEnergy;
      const healed = hero.hp + (calm ? HERO.regen : 0) + spring + mended(hero);
      if (healed > hero.hp && hero.hp < most)
        hero.hp = healed < most ? healed : most;
      continue;
    }
    if (--hero.respawn > 0) continue;
    const fort = fortSite(map, hero.seat);
    hero.x = centreOf(fort.x);
    hero.y = centreOf(fort.y);
    hero.hp = most;
    world.events.push({
      type: "respawn",
      seat: hero.seat,
      x: hero.x,
      y: hero.y,
    });
  }
}
