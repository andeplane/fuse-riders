/**
 * Bots: `botCommands` decides what a bot seat sends this tick, as the same `Command`s a player sends (a hero `move`,
 * a `cast`, a `stance` and a factory `order`), at most one of each so it stays within `COMMANDS_PER_SEAT`. It reads
 * only what a player sees (there is no fog of war yet, so the whole world view is fair) and never the world's RNG: its
 * varied choices hash its seat with the world it sees. It is pure and never mutates the world, so every peer that
 * runs it on the same world gets the same commands, and the netcode can fold them into the log like a player's.
 *
 * It thinks on a cadence staggered by seat (`PROFILES`), never re-sends what already holds (a move to the hero's goal,
 * the stance it has, a factory's order), and its work is linear in units, flags and buildings: the flow fields it
 * reads are the flag and fort fields every stance already caches.
 *
 * - Hero: walk to the cheapest flag its team does not hold (enemy flags cost more), else the nearest enemy fort, and
 *   to that fort while its army FOLLOWs it. It shoots whatever it meets on the way (`combat.ts`). Shockwave a crowd of
 *   enemy robots, Rally Cry its robots in a fight, and Orbital Drop whenever it can.
 * - Stance: HOLD when its fort's sector is invaded or the team is behind on sectors or army, else PUSH; a hard bot
 *   well ahead with a healthy hero FOLLOWs it onto a fort to close the match.
 * - Orders: a robot factory builds grunts while flags lie neutral, torches against a robot swarm or enemy turrets and
 *   forts near it, and grunts otherwise; it only switches early in a batch so little work is thrown away.
 */
import { UNREACHABLE, flowField } from "./flow.js";
import { alive, levelOf, maxHp } from "./hero.js";
import type { GameMap } from "./map.js";
import { div } from "./math.js";
import { tileOf } from "./move.js";
import { fnv1a, next } from "./rng.js";
import { kitOf } from "./spells.js";
import type { Command } from "./step.js";
import {
  STEPS_PER_TICK,
  STRAIGHT,
  TILE,
  UNITS,
  UNIT_CAP,
  teamOf,
  type Stance,
  type UnitKind,
} from "./tuning.js";
import {
  NEUTRAL,
  NO_WINNER,
  fortSite,
  ownerOf,
  teamSectors,
  type Hero,
  type World,
} from "./world.js";

export const DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

interface Profile {
  /** Ticks between hero decisions (moves and casts), and between stance and order decisions. */
  think: number;
  plan: number;
  /** Enemy robots near enough for Shockwave, and own robots in a fight for Rally Cry (0: never). */
  shockwave: number;
  rally: number;
  /** Whether the hero casts Orbital Drop. */
  drop: boolean;
  /** HOLD when the team holds this many sectors fewer, or its army is below this percent of the enemy's; 0 never. */
  holdBehind: number;
  holdBelow: number;
  /** HOLD when this many enemy units stand in its fort's sector; 0 never. */
  defend: number;
  /** The hero picks among this many of its best targets (1: always the best). */
  wander: number;
  /** FOLLOW the hero to an enemy fort when this many sectors ahead with a quarter more army; 0 never. */
  lead: number;
  /** Whether factories get orders at all. */
  orders: boolean;
}

/**
 * HOLD is costly on Dust Basin (a holding team stops taking flags), so it is kept for a home under attack or a team
 * far behind. A hero never retreats: heroes do not heal, so a retreat would only idle it until it dies anyway. Easy
 * is timid and slow: it holds as soon as it falls behind, wanders between targets, thinks every four seconds, casts
 * only Shockwave and leaves its factories alone.
 */
export const PROFILES: Readonly<Record<Difficulty, Readonly<Profile>>> = {
  easy: {
    think: 80,
    plan: 400,
    shockwave: 5,
    rally: 0,
    drop: false,
    holdBehind: 2,
    holdBelow: 80,
    defend: 3,
    wander: 3,
    lead: 0,
    orders: false,
  },
  normal: {
    think: 16,
    plan: 120,
    shockwave: 3,
    rally: 5,
    drop: true,
    holdBehind: 6,
    holdBelow: 30,
    defend: 3,
    wander: 1,
    lead: 0,
    orders: true,
  },
  hard: {
    think: 6,
    plan: 120,
    shockwave: 2,
    rally: 4,
    drop: true,
    holdBehind: 6,
    holdBelow: 30,
    defend: 3,
    wander: 1,
    lead: 4,
    orders: true,
  },
};

/** How far (sub-pixels) a factory looks for enemies to counter, and a hero for allies and foes around it. */
const SCOUT = 16 * TILE;
const NEAR = 8 * TILE;
/** Flow cost an enemy-held flag carries over a neutral one: it is defended, a neutral one is not. */
const ENEMY_FLAG = 40 * STRAIGHT;
/** Torches beat this many enemy robots near a factory; a factory switches only before this percent of a batch. */
const SWARM = 6;
const SWITCH_BEFORE = 25;

const near = (ax: number, ay: number, bx: number, by: number, r: number) =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by) <= r * r;

/** The commands bot `seat` sends with this tick; empty when the seat is not playing or the match is over. */
export function botCommands(
  map: GameMap,
  world: World,
  seat: number,
  difficulty: Difficulty,
): Command[] {
  const player = world.players.find((each) => each.seat === seat);
  const hero = world.heroes.find((each) => each.seat === seat);
  if (player === undefined || hero === undefined || world.winner !== NO_WINNER)
    return [];
  const profile = PROFILES[difficulty];
  const tick = div(world.step, STEPS_PER_TICK) + seat * 7;
  const commands: Command[] = [];
  if (tick % profile.think === 0) {
    commands.push(...heroCommands(map, world, hero, profile, player.stance));
  }
  if (tick % profile.plan === 0) {
    const stance = chooseStance(map, world, seat, hero, profile, tick);
    if (stance !== player.stance)
      commands.push({ seat, type: "stance", stance });
  }
  if (profile.orders && (tick + div(profile.plan, 2)) % profile.plan === 0) {
    const order = chooseOrder(map, world, seat);
    if (order !== null) commands.push({ seat, type: "order", ...order });
  }
  return commands;
}

function heroCommands(
  map: GameMap,
  world: World,
  hero: Hero,
  profile: Profile,
  stance: Stance,
): Command[] {
  if (!alive(hero)) return [];
  const { seat } = hero;
  const team = teamOf(seat);
  const commands: Command[] = [];
  const level = levelOf(hero.xp);
  const at = tileOf(hero.y) * map.width + tileOf(hero.x);
  // Who stands around the hero: enemy robots within Shockwave's reach, and the robots and enemies within NEAR.
  const kit = kitOf(hero);
  let crowd = 0,
    allies = 0,
    foes = 0,
    owned = 0;
  for (const unit of world.units) {
    if (unit.owner === seat) owned++;
    const ally = teamOf(unit.owner) === team;
    if (!ally && UNITS[unit.kind].robot)
      if (near(unit.x, unit.y, hero.x, hero.y, kit[0]!.radius)) crowd++;
    if (!near(unit.x, unit.y, hero.x, hero.y, NEAR)) continue;
    if (ally) allies += UNITS[unit.kind].robot ? 1 : 0;
    else foes += unit.hp;
  }
  for (const each of world.heroes)
    if (alive(each) && teamOf(each.seat) !== team)
      if (near(each.x, each.y, hero.x, hero.y, NEAR)) foes += each.hp;

  // At most one cast: the first of Shockwave, Rally Cry and Orbital Drop that is ready and called for.
  const ready = (slot: number): boolean => {
    const spell = kit[slot]!;
    return (
      !spell.passive &&
      level >= spell.unlock &&
      hero.spells[slot] === 0 &&
      hero.energy >= spell.energy
    );
  };
  const tx = tileOf(hero.x),
    ty = tileOf(hero.y);
  const slot =
    ready(0) && profile.shockwave > 0 && crowd >= profile.shockwave
      ? 0
      : ready(1) && profile.rally > 0 && allies >= profile.rally && foes > 0
        ? 1
        : ready(3) && profile.drop && owned < UNIT_CAP
          ? 3
          : -1;
  if (slot >= 0) commands.push({ seat, type: "cast", slot, x: tx, y: ty });

  const goal = heroGoal(map, world, hero, profile, at, stance);
  if (goal >= 0 && goal !== at && goal !== hero.goal) {
    const gx = goal % map.width;
    commands.push({ seat, type: "move", x: gx, y: (goal - gx) / map.width });
  }
  return commands;
}

/** The tile the hero should walk to, or -1 to stay. */
function heroGoal(
  map: GameMap,
  world: World,
  hero: Hero,
  profile: Profile,
  at: number,
  stance: Stance,
): number {
  const team = teamOf(hero.seat);
  if (stance === "follow") return enemyFort(map, world, team, at);
  const candidates: [number, number][] = [];
  for (const [index, flag] of map.flags.entries()) {
    const owner = world.sectors[index]!;
    if (owner !== NEUTRAL && teamOf(owner) === team) continue;
    const tile = flag.y * map.width + flag.x;
    const cost = flowField(map, tile).cost[at]!;
    if (cost === UNREACHABLE) continue;
    candidates.push([cost + (owner === NEUTRAL ? 0 : ENEMY_FLAG), tile]);
  }
  if (candidates.length === 0) return enemyFort(map, world, team, at);
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // A wandering bot takes one of its few best, the same one until its team's sector count changes.
  const spread =
    candidates.length < profile.wander ? candidates.length : profile.wander;
  const salt = fnv1a(`${hero.seat}:${teamSectors(world, team)}`);
  return candidates[next(salt).value % spread]![1]!;
}

/** The enemy fort cheapest to walk to from `at`, or -1. */
function enemyFort(map: GameMap, world: World, team: number, at: number) {
  let target = -1,
    bestCost = UNREACHABLE;
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    if (site.kind !== "fort" || building.hp <= 0) continue;
    if (teamOf(site.seat) === team) continue;
    const tile = site.y * map.width + site.x;
    const cost = flowField(map, tile).cost[at]!;
    if (cost < bestCost) [target, bestCost] = [tile, cost];
  }
  return target;
}

function chooseStance(
  map: GameMap,
  world: World,
  seat: number,
  hero: Hero,
  profile: Profile,
  tick: number,
): Stance {
  const team = teamOf(seat);
  const home = fortSite(map, seat).sector;
  let ourSectors = 0,
    theirSectors = 0;
  for (const owner of world.sectors)
    if (owner !== NEUTRAL) {
      if (teamOf(owner) === team) ourSectors++;
      else theirSectors++;
    }
  let ourArmy = 0,
    theirArmy = 0,
    invaders = 0;
  for (const unit of world.units) {
    if (teamOf(unit.owner) === team) ourArmy += unit.hp;
    else {
      theirArmy += unit.hp;
      if (map.sectorOf[tileOf(unit.y) * map.width + tileOf(unit.x)] === home)
        invaders++;
    }
  }
  if (profile.defend > 0 && invaders >= profile.defend) return "hold";
  if (profile.holdBehind > 0 && theirSectors >= ourSectors + profile.holdBehind)
    return "hold";
  if (ourArmy * 100 < theirArmy * profile.holdBelow) return "hold";
  // Well ahead with a bigger army and a healthy hero: lead it onto a fort to close the match, three plans in four.
  const lead =
    profile.lead > 0 &&
    ourSectors >= theirSectors + profile.lead &&
    ourArmy * 4 >= theirArmy * 5 &&
    alive(hero) &&
    hero.hp * 10 > maxHp(levelOf(hero.xp)) * 6 &&
    (next(fnv1a(`${seat}:${div(tick, profile.plan)}`)).value & 3) !== 0;
  return lead ? "follow" : "push";
}

/** One robot factory whose order should change, or null. */
function chooseOrder(
  map: GameMap,
  world: World,
  seat: number,
): { factory: number; kind: UnitKind } | null {
  const team = teamOf(seat);
  let neutral = 0;
  for (const owner of world.sectors) if (owner === NEUTRAL) neutral++;
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    if (site.kind !== "robotFactory" || building.hp <= 0) continue;
    if (ownerOf(map, world, building) !== seat) continue;
    const order = building.order ?? "grunt";
    if (building.progress * 100 > UNITS[order].build * 100 * SWITCH_BEFORE)
      continue;
    const [x, y] = [site.x * TILE, site.y * TILE];
    let robots = 0,
      sieges = 0;
    for (const unit of world.units)
      if (teamOf(unit.owner) !== team && UNITS[unit.kind].robot)
        if (near(unit.x, unit.y, x, y, SCOUT)) robots++;
    for (const other of world.buildings) {
      const there = map.sites[other.id]!;
      if (other.hp <= 0 || (there.kind !== "turret" && there.kind !== "fort"))
        continue;
      const owner = ownerOf(map, world, other);
      if (owner === NEUTRAL || teamOf(owner) === team) continue;
      if (near(there.x * TILE, there.y * TILE, x, y, SCOUT)) sieges++;
    }
    const want: UnitKind =
      neutral > 0 && robots < SWARM
        ? "grunt"
        : robots >= SWARM || sieges > 0
          ? "torch"
          : "grunt";
    if (want !== building.order) return { factory: building.id, kind: want };
  }
  return null;
}
