/**
 * Lane waves (v3), on a map with lanes (`GameMap.lanes`); a map without them keeps its factories building instead.
 *
 * - Every `WAVE_EVERY` steps from `WAVE_FIRST`, each lane sends `WAVE_GRUNTS` grunts and `WAVE_TORCHES` torches from
 *   each team's end of it (`spawnWaves`), owned by the seat that plays that lane (`laneOwner`). A team sends nothing
 *   more while `WAVE_CAP` of its lane units stand.
 * - Wave n's units carry their wave number and have `waveGrowth(n)` percent of their kind's hit points and damage, so
 *   later waves are tougher and a match always ends.
 * - A lane unit walks its lane's waypoints in its team's order, attack-move style: it stands to fight whatever comes
 *   in range (`combat.ts`) and never seeks anything off its lane. It turns to an enemy structure within `LANE_SIGHT`,
 *   and past its last waypoint it makes for the nearest enemy fort (`laneGoal`).
 */
import {
  TOWERS_PER_SIDE,
  type GameMap,
  type Lane,
  type LaneName,
  type Tile,
} from "./map.js";
import { div } from "./math.js";
import { flowField, UNREACHABLE } from "./flow.js";
import {
  LANE_SIGHT,
  RAZE_WAVES,
  STRAIGHT,
  TILE,
  UNITS,
  WAVE_CAP,
  WAVE_EVERY,
  WAVE_FIRST,
  WAVE_GROWTH,
  WAVE_GROWTH_MAX,
  WAVE_GRUNTS,
  WAVE_TORCHES,
  WAYPOINT_REACH,
  teamOf,
  type UnitKind,
} from "./tuning.js";
import type { Building, Unit, World } from "./world.js";
import { upgrades, waveKinds } from "./jungle.js";

const centre = (tile: number): number => tile * TILE + div(TILE, 2);
const d2 = (ax: number, ay: number, bx: number, by: number): number =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/** Whether the map plays the lane rules: waves instead of factory production. */
export const laneMap = (map: GameMap): boolean => map.lanes.length > 0;

/** The percent of its kind's hit points and damage a unit of wave `wave` has (100 for a unit of no wave). */
export function waveGrowth(wave: number): number {
  if (wave <= 0) return 100;
  const grown = WAVE_GROWTH * (wave - 1);
  return 100 + (grown < WAVE_GROWTH_MAX ? grown : WAVE_GROWTH_MAX);
}

/** A wave unit's hit points when it spawns. */
export const waveHp = (kind: UnitKind, wave: number): number =>
  div(UNITS[kind].hp * waveGrowth(wave), 100);

/** A unit's shot before auras and armour: its kind's damage, grown by its wave. */
export const unitDamage = (unit: Unit): number =>
  div(UNITS[unit.kind].damage * waveGrowth(unit.wave), 100);

/** The wave that spawns on `step`, or 0 when none does. */
export function waveAt(step: number): number {
  const since = step - WAVE_FIRST;
  return since >= 0 && since % WAVE_EVERY === 0
    ? div(since, WAVE_EVERY) + 1
    : 0;
}

/** The newest wave that has spawned by `step` (0 before the first). */
export const lastWave = (step: number): number =>
  step < WAVE_FIRST ? 0 : div(step - WAVE_FIRST, WAVE_EVERY) + 1;

/** The lanes a team of each size plays, by name: one rider takes mid, two take top and bot, three take one each. */
const PLAYS: readonly (readonly LaneName[])[] = [
  ["mid"],
  ["top", "bot"],
  ["top", "mid", "bot"],
];

/** The lane index `seat` plays: its place in its team, seat order, by `PLAYS` (any lane the map has). */
export function seatLane(map: GameMap, world: World, seat: number): number {
  const team = world.players.filter((p) => p.team === teamOf(seat));
  // A seat not in play counts as its team's first.
  const found = team.findIndex((p) => p.seat === seat);
  const place = found < 0 ? 0 : found;
  const names = PLAYS[(team.length < 3 ? team.length : 3) - 1]!;
  const lane = map.lanes.findIndex(
    (each) => each.name === names[place % names.length],
  );
  return lane >= 0 ? lane : place % map.lanes.length;
}

/** The seat whose wave a lane sends for `team`: the lowest seat that plays it, else the team's lowest; -1 for none. */
export function laneOwner(
  map: GameMap,
  world: World,
  team: number,
  lane: number,
): number {
  const seats = world.players.filter((p) => p.team === team);
  const player =
    seats.find((p) => seatLane(map, world, p.seat) === lane) ?? seats[0];
  return player?.seat ?? -1;
}

const reversed = new WeakMap<Lane, readonly Tile[]>();
/** A lane's waypoints in the order `team` walks them: team 0 from the path's start, team 1 from its end. */
export function waypoints(lane: Readonly<Lane>, team: number): readonly Tile[] {
  if (team === 0) return lane.path;
  let path = reversed.get(lane);
  if (path === undefined) reversed.set(lane, (path = [...lane.path].reverse()));
  return path;
}

/**
 * The index in `path` of the waypoint a walker at (x, y) heads for: the one after the last it has reached (within
 * `WAYPOINT_REACH`) or passed (it stands nearer the next waypoint than this one does, or for the last, beyond it
 * along the last leg); `path.length` past the last.
 * The latest such waypoint wins, which relies on a lane leading steadily from base to base (`loadMap` checks each
 * waypoint is further from one fort and nearer the other), so an earlier waypoint never lies ahead of a later one.
 */
export function aheadOf(path: readonly Tile[], x: number, y: number): number {
  let ahead = 0;
  for (const [index, here] of path.entries()) {
    const [hx, hy] = [centre(here.x), centre(here.y)];
    const [next, last] = [path[index + 1], path[index - 1]];
    // Past the last waypoint is beyond the line through it square to the lane's last leg, so a walker making for the
    // fort from there doesn't turn back to it once it is out of reach.
    const passed =
      d2(x, y, hx, hy) <= WAYPOINT_REACH * WAYPOINT_REACH ||
      (next !== undefined &&
        d2(x, y, centre(next.x), centre(next.y)) <
          d2(hx, hy, centre(next.x), centre(next.y))) ||
      (next === undefined &&
        last !== undefined &&
        (x - hx) * (hx - centre(last.x)) + (y - hy) * (hy - centre(last.y)) >
          0);
    if (passed) ahead = index + 1;
  }
  return ahead;
}

/** Whether a building is an enemy structure of `team` a lane unit may siege: a standing turret or fort. */
type Siegeable = (index: number) => boolean;

/** The walk (flow cost) a structure in sight may lie at: one across a wall or the river is not the lane's. */
const SIEGE_WALK = 2 * div(LANE_SIGHT, TILE) * STRAIGHT;

/**
 * A lane unit's goal tile: the nearest siegeable enemy structure within `LANE_SIGHT` and a short walk
 * (`SIEGE_WALK`), else the waypoint it heads for, else (past its lane's end) the enemy fort cheapest to walk to; -1
 * when there is none.
 */
export function laneGoal(
  map: GameMap,
  world: World,
  unit: Unit,
  siegeable: Siegeable,
): number {
  const from = div(unit.y, TILE) * map.width + div(unit.x, TILE);
  let best = -1,
    bestD = LANE_SIGHT * LANE_SIGHT + 1;
  for (const [index, building] of world.buildings.entries()) {
    const site = map.sites[building.id]!;
    const d = d2(unit.x, unit.y, centre(site.x), centre(site.y));
    if (d >= bestD || !siegeable(index)) continue;
    const tile = site.y * map.width + site.x;
    if (flowField(map, tile).cost(from) <= SIEGE_WALK)
      [best, bestD] = [tile, d];
  }
  if (best >= 0) return best;
  const team = teamOf(unit.owner);
  const path = waypoints(map.lanes[unit.lane]!, team);
  const ahead = aheadOf(path, unit.x, unit.y);
  if (ahead < path.length) return path[ahead]!.y * map.width + path[ahead]!.x;
  let cost = UNREACHABLE;
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    if (site.kind !== "fort" || building.hp <= 0) continue;
    if (teamOf(site.seat) === team) continue;
    const tile = site.y * map.width + site.x;
    const there = flowField(map, tile).cost(from);
    if (there < cost) [best, cost] = [tile, there];
  }
  return best;
}

/** Whether `tile` is a waypoint of one of the map's lanes. */
export const isWaypoint = (map: GameMap, tile: number): boolean =>
  map.lanes.some((lane) =>
    lane.path.some((spot) => spot.y * map.width + spot.x === tile),
  );

/** Lane units by team. */
export function laneCounts(units: readonly Unit[]): [number, number] {
  const counts: [number, number] = [0, 0];
  for (const unit of units)
    if (unit.lane >= 0) counts[teamOf(unit.owner)]! += 1;
  return counts;
}

/** What a wave holds: its grunts and torches, and the tanks a held vehicle factory adds (`jungle.ts`). */
export const WAVE_KINDS: readonly UnitKind[] = ["grunt", "torch", "lightTank"];

/** By team: the enemy lane structures (towers and gates) it has brought down. */
export function razedBy(
  map: GameMap,
  buildings: readonly Building[],
): [number, number] {
  const razed: [number, number] = [0, 0];
  for (const building of buildings) {
    const site = map.sites[building.id]!;
    if (site.lane >= 0 && building.hp <= 0) razed[1 - site.team]! += 1;
  }
  return razed;
}

/** On a wave's step, each lane's wave steps out at each team's end of it, while the team is under `WAVE_CAP`. */
export function spawnWaves(map: GameMap, world: World): void {
  const wave = waveAt(world.step);
  if (wave === 0 || !laneMap(map)) return;
  const counts = laneCounts(world.units);
  const razed = razedBy(map, world.buildings);
  // A team's held jungle factories add to its waves (`jungle.ts`).
  const ups = [0, 1].map((team) => upgrades(map, world, team));
  const base: UnitKind[] = [
    ...Array<UnitKind>(WAVE_GRUNTS).fill("grunt"),
    ...Array<UnitKind>(WAVE_TORCHES).fill("torch"),
  ];
  for (const team of [0, 1])
    for (const [index, lane] of map.lanes.entries()) {
      const owner = laneOwner(map, world, team, index);
      if (owner < 0) continue;
      const kinds = waveKinds(base, ups[team]!, index, wave);
      const room = WAVE_CAP - counts[team]!;
      const batch = kinds.slice(0, room > 0 ? room : 0);
      const start = waypoints(lane, team)[0]!;
      for (const [at, kind] of batch.entries())
        world.units.push({
          id: world.nextId++,
          kind,
          owner,
          // Side by side within the start tile, which is open ground: team 1's row is team 0's under the half
          // turn, so neither team's slow torch stands in front of its grunts while the other's stands behind.
          x:
            centre(start.x) +
            (team === 0 ? 1 : -1) *
              div((2 * at - (batch.length - 1)) * TILE, 4 * batch.length),
          y: centre(start.y),
          hp: waveHp(kind, wave),
          cooldown: 0,
          goal: -1,
          stun: 0,
          rally: 0,
          lane: index,
          wave: wave + RAZE_WAVES * razed[team]!,
        });
      counts[team]! += batch.length;
    }
}
