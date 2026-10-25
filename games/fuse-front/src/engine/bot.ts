/**
 * Bots: `botCommands` decides what a bot seat sends this tick, as the same `Command`s a player sends (a hero `move`
 * or `attackMove`, an `attack` and a `cast`), at most one of each so it stays within `COMMANDS_PER_SEAT`. It reads
 * only what a player sees (there is no fog of war yet, so the whole world view is fair) and never the world's RNG: its
 * varied choices hash its seat with the world it sees. It is pure and never mutates the world, so every peer that
 * runs it on the same world gets the same commands, and the netcode can fold them into the log like a player's.
 *
 * It thinks on a cadence staggered by seat (`PROFILES`), never re-sends what already holds (a move to the hero's
 * goal), and its work is linear in units, flags and buildings: the flow fields it reads are the flag, fort and
 * waypoint fields the units already cache.
 *
 * - Hero: walk to the cheapest flag its team does not hold (enemy flags cost more), else the nearest enemy fort. It
 *   shoots whatever it meets on the way (`combat.ts`). Shockwave a crowd of
 *   enemy robots, Rally Cry its robots in a fight, and Orbital Drop whenever it can. Vix hijacks and snipes the
 *   nearest tank (or hero), cloaks when hurt in a fight and mines its path when a tank is near; Rivet overclocks when
 *   it can, repairs whatever is hurt near it, drops a turret and fortifies in a fight; Tally blitzes with its army,
 *   flares the flag it heads for and dashes toward it. An easy bot casts only its first slot.
 * - It takes a cheap last hit, an enemy unit one shot finishes, before anything but a hurt enemy hero.
 * - On a lane map (`waves.ts`) the hero plays a MOBA instead (`bot-lane.ts`): laning, last hits, retreat, fights,
 *   towers, objectives and the jungle.
 * - Anywhere it shops its hero's build at its fort and uses its item actives (`bot-shop.ts`).
 */
import { UNREACHABLE, flowField } from "./flow.js";
import { alive, heroGun, heroMaxHp, levelOf } from "./hero.js";
import { activeCommands, shopCommands } from "./bot-shop.js";
import type { GameMap } from "./map.js";
import { div, isqrt } from "./math.js";
import { centreOf, tileOf } from "./move.js";
import { fnv1a, next } from "./rng.js";
import { kitOf, type Chosen } from "./spells.js";
import type { Command } from "./step.js";
import { laneMap } from "./waves.js";
import { laneCommands } from "./bot-lane.js";
import {
  HEROES,
  HERO_KINDS,
  STEPS_PER_TICK,
  STRAIGHT,
  TILE,
  UNITS,
  teamOf,
  type HeroKind,
} from "./tuning.js";
import {
  NEUTRAL,
  NO_WINNER,
  teamSectors,
  unitCap,
  type Hero,
  type Unit,
  type World,
} from "./world.js";

export const DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface Profile {
  /** Ticks between hero decisions (moves, attacks and casts). */
  think: number;
  /** Enemy robots near enough for Shockwave, and own robots in a fight for Rally Cry (0: never). */
  shockwave: number;
  rally: number;
  /** Whether the hero casts Orbital Drop. */
  drop: boolean;
  /** The hero picks among this many of its best targets (1: always the best). */
  wander: number;
  /**
   * On a lane map (`bot-lane.ts`): the hit points (percent) below which it falls back behind its tower, and to which
   * it rests there; the percent of its shot's exact damage at which it takes a last hit (above 100 it shoots too
   * early); how far (tiles) it sees a teammate's fight to join; how far (tiles of walk) it detours to a jungle flag; whether a two-seat team plays mid and a roamer; the percent of the enemy's strength its side needs to take a
   * fight; and what it weighs in that strength (0 the heroes, 1 also the towers that reach the fight, 2 also the
   * longer gun's free shots).
   */
  retreat: number;
  rested: number;
  lastHit: number;
  aware: number;
  jungle: number;
  roam: boolean;
  nerve: number;
  sense: number;
}

/**
 * Easy is slow: it wanders between targets, thinks every four seconds, casts only its first slot, takes last hits a
 * half-shot early, stays in fights it loses, retreats late, never helps a teammate and keeps out of the jungle. Hard
 * thinks every 0.3 s, retreats early, sees fights across the map and roams in 2v2. None reads what a player can't see.
 */
export const PROFILES: Readonly<Record<Difficulty, Readonly<Profile>>> = {
  easy: {
    think: 80,
    shockwave: 5,
    rally: 0,
    drop: false,
    wander: 3,
    retreat: 15,
    rested: 60,
    lastHit: 150,
    aware: 0,
    jungle: 0,
    roam: false,
    nerve: 60,
    sense: 0,
  },
  normal: {
    think: 16,
    shockwave: 3,
    rally: 5,
    drop: true,
    wander: 1,
    retreat: 30,
    rested: 85,
    lastHit: 100,
    aware: 24,
    jungle: 30,
    roam: false,
    nerve: 100,
    sense: 1,
  },
  hard: {
    think: 6,
    shockwave: 2,
    rally: 4,
    drop: true,
    wander: 1,
    retreat: 25,
    rested: 80,
    lastHit: 100,
    aware: 40,
    jungle: 40,
    roam: true,
    nerve: 95,
    sense: 2,
  },
};

/** How far (sub-pixels) a hero counts allies and foes around it. */
const NEAR = 8 * TILE;
/** Flow cost an enemy-held flag carries over a neutral one: it is defended, a neutral one is not. */
const ENEMY_FLAG = 40 * STRAIGHT;

const near = (ax: number, ay: number, bx: number, by: number, r: number) =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by) <= r * r;

/**
 * Each seat's hero for a match: its pick, else (no pick, or a teammate's repeated) the first hero its team has left,
 * looking from a place the seat sets (seats 0 and 1 start at Brick, 2 and 3 at the next), or that place's hero when
 * the team has none left. Picks go first, then the rest in seat order, so every peer resolves the same heroes.
 */
export function pickHeroes(
  seats: readonly number[],
  picks: Readonly<Record<number, HeroKind | null>>,
): Record<number, HeroKind> {
  const out: Record<number, HeroKind> = {};
  const taken = [new Set<HeroKind>(), new Set<HeroKind>()];
  const ordered = [...seats].sort((a, b) => a - b);
  for (const seat of ordered) {
    // A pick is checked here too: a kind outside `HERO_KINDS` counts as none.
    const pick = HERO_KINDS.find((kind) => kind === picks[seat]);
    if (pick && !taken[teamOf(seat)]!.has(pick))
      taken[teamOf(seat)]!.add((out[seat] = pick));
  }
  for (const seat of ordered) {
    if (out[seat] !== undefined) continue;
    const team = taken[teamOf(seat)]!;
    const order = HERO_KINDS.map(
      (_, i) => HERO_KINDS[(div(seat, 2) + i) % HERO_KINDS.length]!,
    );
    team.add((out[seat] = order.find((kind) => !team.has(kind)) ?? order[0]!));
  }
  return out;
}

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
  // On a lane map teammates think a few ticks apart and the teams half a think apart, so neither team always sees
  // the other's latest decision first (the v2 seat stagger, kept for the v2 maps, handed one side that edge).
  const tick =
    div(world.step, STEPS_PER_TICK) +
    (laneMap(map)
      ? div(seat, 2) * 5 + teamOf(seat) * div(profile.think, 2)
      : seat * 7);
  const commands: Command[] = [];
  // At its fort it shops every tick, so even a slow thinker buys before it walks out (`bot-shop.ts`).
  commands.push(...shopCommands(map, hero));
  if (tick % profile.think === 0) {
    commands.push(...activeCommands(map, world, hero));
    if (!laneMap(map))
      commands.push(...heroCommands(map, world, hero, profile));
    else if (alive(hero))
      commands.push(...laneCommands(map, world, hero, profile));
  }
  return commands;
}

function heroCommands(
  map: GameMap,
  world: World,
  hero: Hero,
  profile: Profile,
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
    // A camp's guards (`jungle.ts`) are neither friend nor foe here.
    if (unit.owner === NEUTRAL) continue;
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

  // At most one cast: the first slot that is ready and called for. A profile without Rally Cry (easy) only ever
  // casts its first slot, whatever its kit.
  const ready = (slot: number): boolean => {
    const spell = kit[slot]!;
    return (
      !spell.passive &&
      level >= spell.unlock &&
      hero.spells[slot] === 0 &&
      hero.energy >= spell.energy &&
      (slot === 0 || profile.rally > 0)
    );
  };
  const goal = heroGoal(map, world, hero, profile, at);
  const own: [number, number] = [tileOf(hero.x), tileOf(hero.y)];
  const room = owned < unitCap(world, seat);
  const fighting = foes > 0;
  const hurt = hero.hp * 10 < heroMaxHp(hero) * 6;
  /** The nearest enemy tank (or hero, with `heroes`) within `range`: its tile to aim at, and itself as the target. */
  const prey = (range: number, heroes: boolean) => {
    let best: { at: [number, number]; chosen: Chosen } | null = null,
      bestD = range * range + 1;
    const consider = (x: number, y: number, of: number, id: number) => {
      const d = (x - hero.x) * (x - hero.x) + (y - hero.y) * (y - hero.y);
      if (d < bestD)
        [best, bestD] = [{ at: [tileOf(x), tileOf(y)], chosen: { of, id } }, d];
    };
    for (const unit of world.units)
      if (teamOf(unit.owner) !== team && unit.kind === "lightTank")
        consider(unit.x, unit.y, 0, unit.id);
    if (heroes)
      for (const each of world.heroes)
        if (teamOf(each.seat) !== team && alive(each) && each.cloak === 0)
          consider(each.x, each.y, 1, each.seat);
    return best as { at: [number, number]; chosen: Chosen } | null;
  };
  const toward: [number, number] | null =
    goal >= 0 ? [goal % map.width, div(goal, map.width)] : null;
  const lit =
    toward !== null &&
    near(
      centreOf(toward[0]),
      centreOf(toward[1]),
      hero.x,
      hero.y,
      kit[1]!.range,
    );
  // DASH only reaches so far, so it aims at the point of its range on the way to the goal.
  const dashTo = ((): [number, number] | null => {
    if (toward === null) return null;
    const [dx, dy] = [
      centreOf(toward[0]) - hero.x,
      centreOf(toward[1]) - hero.y,
    ];
    const length = isqrt(dx * dx + dy * dy);
    const reach = kit[0]!.range - div(TILE, 2);
    if (length <= reach) return toward;
    return [
      tileOf(hero.x + div(dx * reach, length)),
      tileOf(hero.y + div(dy * reach, length)),
    ];
  })();
  const hijack = prey(kit[3]!.range, false),
    snipe = prey(kit[0]!.range, true);
  // Per kit: [slot, whether it is called for, where to aim, the target it names].
  const plans: [number, boolean, [number, number] | null, Chosen?][] =
    hero.kind === "vix"
      ? [
          [3, room, hijack?.at ?? null, hijack?.chosen],
          [0, true, snipe?.at ?? null, snipe?.chosen],
          [1, fighting && hurt, own],
          [2, prey(NEAR, false) !== null, own],
        ]
      : hero.kind === "rivet"
        ? [
            [3, true, own],
            [0, allies > 0 || hero.hp < heroMaxHp(hero), own],
            [1, fighting && room, own],
            [2, fighting, own],
          ]
        : hero.kind === "tally"
          ? [
              [3, allies >= profile.rally, own],
              [1, allies > 0 && !fighting && lit, toward],
              [0, !fighting && goal >= 0, dashTo],
            ]
          : [
              [0, profile.shockwave > 0 && crowd >= profile.shockwave, own],
              [
                1,
                profile.rally > 0 && allies >= profile.rally && fighting,
                own,
              ],
              [3, profile.drop && room, own],
            ];
  const plan = plans.find(
    ([slot, wanted, aim]) => ready(slot) && wanted && aim,
  );
  if (plan !== undefined) {
    const [slot, , [x, y], chosen] = plan as [
      number,
      boolean,
      [number, number],
      Chosen?,
    ];
    commands.push({ seat, type: "cast", slot, x, y, ...chosen });
  }

  // Focus fire on a hurt enemy hero in range; while a focus holds, the bot lets it run (`focus.ts` drops it).
  const range = HEROES[hero.kind].range;
  const quarry = world.heroes.find(
    (each) =>
      teamOf(each.seat) !== team &&
      alive(each) &&
      each.cloak === 0 &&
      each.hp * 10 < heroMaxHp(each) * 4 &&
      near(each.x, each.y, hero.x, hero.y, range),
  );
  if (quarry !== undefined && hero.focusOf < 0) {
    commands.push({ seat, type: "attack", of: 1, id: quarry.seat });
    return commands;
  }
  if (hero.focusOf >= 0) return commands;
  // A last hit when it is cheap: an enemy unit in range that one shot surely finishes (`gold.ts`), the weakest first.
  // Armour and IRON HIDE can cut a shot by up to a quarter, so it counts on three quarters of its damage.
  const gun = heroGun(hero);
  let finish: Unit | undefined;
  for (const unit of world.units)
    if (
      unit.owner !== NEUTRAL &&
      teamOf(unit.owner) !== team &&
      unit.hp * 4 <= gun.damage * 3 &&
      near(unit.x, unit.y, hero.x, hero.y, range) &&
      (finish === undefined || unit.hp < finish.hp)
    )
      finish = unit;
  if (finish !== undefined) {
    commands.push({ seat, type: "attack", of: 0, id: finish.id });
    return commands;
  }
  // The way to an enemy fort is an attack-move: the hero stands to fight what it meets, beside its army.
  const fort = map.sites.some(
    (site) => site.kind === "fort" && site.y * map.width + site.x === goal,
  );
  if (
    goal >= 0 &&
    goal !== at &&
    (goal !== hero.goal || fort !== hero.sweep > 0)
  ) {
    const gx = goal % map.width;
    const type = fort ? "attackMove" : "move";
    commands.push({ seat, type, x: gx, y: (goal - gx) / map.width });
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
): number {
  const team = teamOf(hero.seat);
  const candidates: [number, number][] = [];
  for (const [index, flag] of map.flags.entries()) {
    const owner = world.sectors[index]!;
    if (owner !== NEUTRAL && teamOf(owner) === team) continue;
    const tile = flag.y * map.width + flag.x;
    const cost = flowField(map, tile).cost(at);
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
    const cost = flowField(map, tile).cost(at);
    if (cost < bestCost) [target, bestCost] = [tile, cost];
  }
  return target;
}
