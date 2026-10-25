/**
 * The jungle (v3), on a map with lanes: the sectors off the lanes, each with a flag, a factory and a neutral camp.
 *
 * - **Camps:** each camp (`GameMap.camps`) is guarded by `CAMP_GUARDS` neutral sentries (owner `NEUTRAL`) on its
 *   tile. They never move or burn out, shoot only heroes and units outside the waves, and only those shoot them
 *   (`combat.ts`). Once a camp's guards are all down it stays empty `CAMP_RESPAWN` steps, then they stand again
 *   (`tendCamps`). A jungle flag can't be taken while its camp is guarded, and a home flag never can (`step.ts`).
 * - **Upgrades:** a factory in a sector a team holds upgrades that team's waves while held (`upgrades`): a robot
 *   factory adds a torch to the wave of its nearest lane and armours the team's wave grunts (`GRUNT_ARMOUR` percent
 *   less from guns); a vehicle factory adds a light tank to every third wave of its nearest lane. Losing the sector
 *   loses the upgrade.
 */
import { traceLine, type GameMap } from "./map.js";
import { div } from "./math.js";
import {
  CAMP_GUARDS,
  CAMP_RESPAWN,
  TILE,
  UNITS,
  teamOf,
  type UnitKind,
} from "./tuning.js";
import { NEUTRAL, type World } from "./world.js";

const centre = (tile: number): number => tile * TILE + div(TILE, 2);
const tileAt = (map: GameMap, x: number, y: number): number =>
  div(y, TILE) * map.width + div(x, TILE);

/** Each camp's guards stand on its tile; a camp whose guards are all down stands again after `CAMP_RESPAWN` steps. */
export function tendCamps(map: GameMap, world: World): void {
  if (map.camps.length === 0) return;
  const guarded = new Set<number>();
  for (const unit of world.units)
    if (unit.owner === NEUTRAL) guarded.add(tileAt(map, unit.x, unit.y));
  for (const [index, camp] of map.camps.entries()) {
    if (guarded.has(camp.y * map.width + camp.x)) {
      world.camps[index] = CAMP_RESPAWN;
      continue;
    }
    if (--world.camps[index]! > 0) continue;
    world.camps[index] = CAMP_RESPAWN;
    for (let at = 0; at < CAMP_GUARDS; at++)
      world.units.push({
        id: world.nextId++,
        kind: "sentry",
        owner: NEUTRAL,
        x:
          centre(camp.x) +
          div((2 * at - (CAMP_GUARDS - 1)) * TILE, 4 * CAMP_GUARDS),
        y: centre(camp.y),
        hp: UNITS.sentry.hp,
        cooldown: 0,
        goal: -1,
        stun: 0,
        rally: 0,
        lane: -1,
        wave: 0,
      });
  }
}

const campIndex = new WeakMap<GameMap, Int32Array>();
/** The camp in a sector (`GameMap.camps` index), or -1. */
export function campOf(map: GameMap, sector: number): number {
  let table = campIndex.get(map);
  if (table === undefined) {
    table = new Int32Array(map.flags.length).fill(-1);
    for (const [index, camp] of map.camps.entries())
      table[map.sectorOf[camp.y * map.width + camp.x]!] = index;
    campIndex.set(map, table);
  }
  return table[sector] ?? -1;
}

/** Whether a sector's camp has a guard standing. */
export function guarded(map: GameMap, world: World, sector: number): boolean {
  const camp = map.camps[campOf(map, sector)];
  if (camp === undefined) return false;
  const tile = camp.y * map.width + camp.x;
  return world.units.some(
    (unit) => unit.owner === NEUTRAL && tileAt(map, unit.x, unit.y) === tile,
  );
}

const lanesBy = new WeakMap<GameMap, Int32Array>();
/** The lane nearest a site (by its legs' tiles, either axis; ties to the lower lane), or -1 on a map without lanes. */
export function nearestLane(map: GameMap, site: number): number {
  let table = lanesBy.get(map);
  if (table === undefined) {
    table = new Int32Array(map.sites.length).fill(-1);
    const legs = map.lanes.map((lane) => {
      const tiles: [number, number][] = [];
      for (let i = 1; i < lane.path.length; i++)
        traceLine(lane.path[i - 1]!, lane.path[i]!, (x, y) => {
          tiles.push([x, y]);
          return true;
        });
      return tiles;
    });
    for (const each of map.sites) {
      let best = -1,
        bestD = map.width + map.height;
      for (const [lane, tiles] of legs.entries())
        for (const [x, y] of tiles) {
          const [dx, dy] = [x - each.x, y - each.y];
          const ax = dx < 0 ? -dx : dx,
            ay = dy < 0 ? -dy : dy;
          const d = ax > ay ? ax : ay;
          if (d < bestD) [best, bestD] = [lane, d];
        }
      table[each.id] = best;
    }
    lanesBy.set(map, table);
  }
  return table[site]!;
}

/** What a team's held factories add to its waves: armour for its grunts, and extra units by lane. */
export interface Upgrades {
  armour: boolean;
  /** By lane: the torches and tanks (every third wave) added. */
  torches: number[];
  tanks: number[];
}

export function upgrades(map: GameMap, world: World, team: number): Upgrades {
  const out: Upgrades = {
    armour: false,
    torches: map.lanes.map(() => 0),
    tanks: map.lanes.map(() => 0),
  };
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    if (building.hp <= 0) continue;
    if (site.kind !== "robotFactory" && site.kind !== "vehicleFactory")
      continue;
    const owner = world.sectors[site.sector]!;
    if (owner === NEUTRAL || teamOf(owner) !== team) continue;
    const lane = nearestLane(map, site.id);
    if (lane < 0) continue;
    if (site.kind === "robotFactory") {
      out.armour = true;
      out.torches[lane]!++;
    } else out.tanks[lane]!++;
  }
  return out;
}

/** A team's wave for one lane: grunts and torches, a torch per held robot factory and, every third wave, a tank per vehicle factory. */
export function waveKinds(
  base: readonly UnitKind[],
  ups: Upgrades,
  lane: number,
  wave: number,
): UnitKind[] {
  const kinds = [...base];
  for (let i = 0; i < ups.torches[lane]!; i++) kinds.push("torch");
  if (wave % 3 === 0)
    for (let i = 0; i < ups.tanks[lane]!; i++) kinds.push("lightTank");
  return kinds;
}
