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
 * - On a lane map (`waves.ts`) the hero attack-moves down the lane its seat plays, then onto the enemy fort.
 * - It takes a cheap last hit, an enemy unit one shot finishes, before anything but a hurt enemy hero, shops its
 *   hero's build at its fort and uses its item actives (`bot-shop.ts`).
 */
import { UNREACHABLE, flowField } from "./flow.js";
import { alive, heroGun, heroMaxHp, levelOf } from "./hero.js";
import { activeCommands, shopCommands } from "./bot-shop.js";
import type { GameMap } from "./map.js";
import { div, isqrt } from "./math.js";
import { centreOf, tileOf } from "./move.js";
import { fnv1a, next } from "./rng.js";
import { kitOf, type Chosen } from "./spells.js";
import { enemyAt } from "./focus.js";
import type { Command } from "./step.js";
import { aheadOf, laneMap, seatLane, waypoints } from "./waves.js";
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

interface Profile {
  /** Ticks between hero decisions (moves, attacks and casts). */
  think: number;
  /** Enemy robots near enough for Shockwave, and own robots in a fight for Rally Cry (0: never). */
  shockwave: number;
  rally: number;
  /** Whether the hero casts Orbital Drop. */
  drop: boolean;
  /** The hero picks among this many of its best targets (1: always the best). */
  wander: number;
}

/**
 * A hero never retreats (MOBA laning and retreat are v3 M5's). Easy is slow: it wanders between targets, thinks every
 * four seconds and casts only Shockwave.
 */
export const PROFILES: Readonly<Record<Difficulty, Readonly<Profile>>> = {
  easy: {
    think: 80,
    shockwave: 5,
    rally: 0,
    drop: false,
    wander: 3,
  },
  normal: {
    think: 16,
    shockwave: 3,
    rally: 5,
    drop: true,
    wander: 1,
  },
  hard: {
    think: 6,
    shockwave: 2,
    rally: 4,
    drop: true,
    wander: 1,
  },
};

/** How far (sub-pixels) a lane bot looks for enemies before a jungle detour, and a hero for allies and foes around it. */
const SCOUT = 16 * TILE;
const NEAR = 8 * TILE;
/** Flow cost an enemy-held flag carries over a neutral one: it is defended, a neutral one is not. */
const ENEMY_FLAG = 40 * STRAIGHT;
/** A lane bot pushes a structure within `PUSH_REACH` while no enemy hero stands within `PUSH_CLEAR` (sub-pixels). */
const PUSH_REACH = 12 * TILE;
const PUSH_CLEAR = 16 * TILE;
/** How far (flow cost) a lane bot detours to take a jungle flag. */
const JUNGLE_WALK = 30 * STRAIGHT;

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
  const tick = div(world.step, STEPS_PER_TICK) + seat * 7;
  const commands: Command[] = [];
  // At its fort it shops every tick, so even a slow thinker buys before it walks out (`bot-shop.ts`).
  commands.push(...shopCommands(map, hero));
  if (tick % profile.think === 0) {
    commands.push(...activeCommands(map, world, hero));
    commands.push(...heroCommands(map, world, hero, profile));
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
  // On a lane map with no enemy hero about, the hero brings down the nearest structure it may shoot (`towers.ts`).
  const siege = laneMap(map) ? pushTarget(map, world, hero) : -1;
  if (siege >= 0) {
    commands.push({ seat, type: "attack", of: 2, id: siege });
    return commands;
  }
  // The way to an enemy fort, and every walk down a lane, is an attack-move: the hero stands to fight what it meets,
  // beside its army.
  const fort =
    laneMap(map) ||
    map.sites.some(
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

/**
 * The site id of the enemy structure a lane bot's hero should attack: the nearest it may shoot within `PUSH_REACH`,
 * while no living enemy hero stands within `PUSH_CLEAR`; -1 otherwise.
 */
function pushTarget(map: GameMap, world: World, hero: Hero): number {
  const team = teamOf(hero.seat);
  for (const each of world.heroes)
    if (alive(each) && teamOf(each.seat) !== team)
      if (near(each.x, each.y, hero.x, hero.y, PUSH_CLEAR)) return -1;
  let best = -1,
    bestD = PUSH_REACH * PUSH_REACH + 1;
  for (const building of world.buildings) {
    const aim = enemyAt(map, world, team, 2, building.id);
    if (aim === undefined) continue;
    const d =
      (aim.x - hero.x) * (aim.x - hero.x) + (aim.y - hero.y) * (aim.y - hero.y);
    if (d < bestD) [best, bestD] = [building.id, d];
  }
  return best;
}

/**
 * A lane bot's jungle detour: while its hero is healthy and no enemy unit or hero (camp guards aside) stands within
 * `SCOUT`, the tile of the jungle flag its team doesn't hold (and that no FORTIFY holds) cheapest to walk to within
 * `JUNGLE_WALK`; -1 otherwise.
 */
function jungleFlag(map: GameMap, world: World, hero: Hero, at: number) {
  const team = teamOf(hero.seat);
  // A hurt hero stays in lane rather than take on a camp.
  if (hero.hp * 10 < heroMaxHp(hero) * 6) return -1;
  const enemy = (owner: number, x: number, y: number) =>
    owner !== NEUTRAL &&
    teamOf(owner) !== team &&
    near(x, y, hero.x, hero.y, SCOUT);
  if (world.units.some((u) => enemy(u.owner, u.x, u.y))) return -1;
  if (world.heroes.some((h) => alive(h) && enemy(h.seat, h.x, h.y))) return -1;
  let best = -1,
    bestCost = JUNGLE_WALK + 1;
  for (const [sector, flag] of map.flags.entries()) {
    if (map.sectorKinds[sector] !== "jungle" || world.fortified[sector]! > 0)
      continue;
    const owner = world.sectors[sector]!;
    if (owner !== NEUTRAL && teamOf(owner) === team) continue;
    const tile = flag.y * map.width + flag.x;
    const cost = flowField(map, tile).cost(at);
    if (cost < bestCost) [best, bestCost] = [tile, cost];
  }
  return best;
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
  if (laneMap(map)) {
    // With no enemy about, take a jungle flag a short walk off (fighting its camp, `jungle.ts`).
    const jungle = jungleFlag(map, world, hero, at);
    if (jungle >= 0) return jungle;
    // Down its lane, waypoint by waypoint (`waves.ts`), then onto the enemy fort.
    const lane = map.lanes[seatLane(map, world, hero.seat)]!;
    const path = waypoints(lane, team);
    const spot = path[aheadOf(path, hero.x, hero.y)];
    if (spot === undefined) return enemyFort(map, world, team, at);
    return spot.y * map.width + spot.x;
  }
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
