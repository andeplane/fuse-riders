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
 *   enemy robots, Rally Cry its robots in a fight, and Orbital Drop whenever it can. Vix hijacks and snipes the
 *   nearest tank (or hero), cloaks when hurt in a fight and mines its path when a tank is near; Rivet overclocks when
 *   it can, repairs whatever is hurt near it, drops a turret and fortifies in a fight; Tally blitzes with its army,
 *   flares the flag it heads for and dashes toward it. An easy bot casts only its first slot.
 * - Stance: HOLD when its fort's sector is invaded or the team is behind on sectors or army, else PUSH; a profile
 *   with `lead` set FOLLOWs its healthy hero onto a fort when well ahead (none does now).
 * - On a lane map (`waves.ts`) the hero attack-moves down the lane its seat plays, then onto the enemy fort; there
 *   is no stance or factory order to choose.
 * - Orders: a robot factory builds grunts while flags lie neutral, torches against a robot swarm or enemy turrets and
 *   forts near it, and grunts otherwise; it only switches early in a batch so little work is thrown away.
 */
import { UNREACHABLE, flowField } from "./flow.js";
import { alive, levelOf, maxHp } from "./hero.js";
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
  type Stance,
  type UnitKind,
} from "./tuning.js";
import {
  NEUTRAL,
  NO_WINNER,
  fortSite,
  ownerOf,
  teamSectors,
  unitCap,
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
 * far behind. A hero never retreats: heroes now heal out of combat, but a bot league (`tests/league.test.ts`) with a
 * walk-home-to-heal rule won no more 1v1s and lost every team match against the same bot without it. Nor does a hard
 * bot lead onto a fort (`lead`) since forts fire back: it won fewer matches. Easy is timid and slow: it holds as soon
 * as it falls behind, wanders between targets, thinks every four seconds, casts only Shockwave and leaves its
 * factories alone.
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
    lead: 0,
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
  if (tick % profile.think === 0) {
    commands.push(...heroCommands(map, world, hero, profile, player.stance));
  }
  // A lane map's army is its waves (`waves.ts`): no stance or factory orders to choose.
  if (laneMap(map)) return commands;
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
  const goal = heroGoal(map, world, hero, profile, at, stance);
  const own: [number, number] = [tileOf(hero.x), tileOf(hero.y)];
  const room = owned < unitCap(world, seat);
  const fighting = foes > 0;
  const hurt = hero.hp * 10 < maxHp(level, hero.kind) * 6;
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
            [0, allies > 0 || hero.hp < maxHp(level, hero.kind), own],
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
      each.hp * 10 < maxHp(levelOf(each.xp), each.kind) * 4 &&
      near(each.x, each.y, hero.x, hero.y, range),
  );
  if (quarry !== undefined && hero.focusOf < 0) {
    commands.push({ seat, type: "attack", of: 1, id: quarry.seat });
    return commands;
  }
  if (hero.focusOf >= 0) return commands;
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
 * A lane bot's jungle detour: while no enemy unit or hero (camp guards aside) stands within `SCOUT`, the tile of the
 * jungle flag its team doesn't hold that is cheapest to walk to within `JUNGLE_WALK`; -1 otherwise.
 */
function jungleFlag(map: GameMap, world: World, hero: Hero, at: number) {
  const team = teamOf(hero.seat);
  const enemy = (owner: number, x: number, y: number) =>
    owner !== NEUTRAL &&
    teamOf(owner) !== team &&
    near(x, y, hero.x, hero.y, SCOUT);
  if (world.units.some((u) => enemy(u.owner, u.x, u.y))) return -1;
  if (world.heroes.some((h) => alive(h) && enemy(h.seat, h.x, h.y))) return -1;
  let best = -1,
    bestCost = JUNGLE_WALK + 1;
  for (const [sector, flag] of map.flags.entries()) {
    if (map.sectorKinds[sector] !== "jungle") continue;
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
  stance: Stance,
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
  if (stance === "follow") return enemyFort(map, world, team, at);
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
