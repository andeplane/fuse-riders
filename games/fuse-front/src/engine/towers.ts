/**
 * Lane structures (v3), on a map with lanes: each lane side's two towers and its gate stand as turrets of their team
 * on the lane's slots (`loadMap` adds their sites after the map's own), and each team's forts are its core.
 *
 * - **Protection:** a tower or gate can't be picked by any gun while the structure in front of it on its lane and
 *   side stands, so there is no backdoor. A fort can't be picked while every gate of its team stands (`shielded`).
 * - **Targets:** a tower keeps the target it last shot while that stays in range and pickable; otherwise it takes
 *   the nearest enemy unit in range, else the nearest enemy hero (`combat.ts`).
 * - **Aggro:** an enemy hero whose shot hits a friendly hero switches every tower that has both in range onto it
 *   (`aggro`), from the next step.
 * - **Ramp:** each shot in a row on the same target does `TOWER.ramp` percent more, up to `TOWER.rampMax` shots
 *   (`rampUp`), so standing under a tower grows costly.
 * - **Momentum:** each enemy tower or gate a team has brought down makes its later waves `RAZE_WAVES` waves tougher
 *   (`waves.ts`), so a lead in structures grows into a push and a match ends.
 * - Destroying a team's last fort wins (`winnerOf`), as on any map.
 */
import { laneMap } from "./waves.js";
import { TOWERS_PER_SIDE, type GameMap } from "./map.js";
import { div } from "./math.js";
import { centreOf } from "./move.js";
import { TOWER, teamOf } from "./tuning.js";
import { MARKS, type Building, type Mark, type World } from "./world.js";

/** The site in front of each lane structure (the same lane and side, one tier out), or -1; by site id, per map. */
const fronts = new WeakMap<GameMap, Int32Array>();
function frontOf(map: GameMap, id: number): number {
  let table = fronts.get(map);
  if (table === undefined) {
    table = new Int32Array(map.sites.length).fill(-1);
    for (const site of map.sites) {
      if (site.lane < 0 || site.tier === 0) continue;
      const front = map.sites.find(
        (other) =>
          other.lane === site.lane &&
          other.team === site.team &&
          other.tier === site.tier - 1,
      );
      table[site.id] = front?.id ?? -1;
    }
    fronts.set(map, table);
  }
  return table[id]!;
}

/** Whether the building on site `id` stands (a fort of a seat not in play has no building, and doesn't). */
const standing = (world: World, id: number): boolean =>
  world.buildings.some((each) => each.id === id && each.hp > 0);

/**
 * Whether no gun may pick a building yet: a lane structure while the one in front of it stands, or, on a lane map, a
 * fort while every gate of its team stands.
 */
export function shielded(
  map: GameMap,
  world: World,
  building: Building,
): boolean {
  const site = map.sites[building.id]!;
  if (site.lane >= 0) {
    const front = frontOf(map, site.id);
    return front >= 0 && standing(world, front);
  }
  if (site.kind !== "fort" || !laneMap(map)) return false;
  const team = teamOf(site.seat);
  return map.sites.every(
    (each) =>
      each.lane < 0 ||
      each.team !== team ||
      each.tier !== TOWERS_PER_SIDE ||
      standing(world, each.id),
  );
}

/**
 * A tower's shot at `victim`, ramped by the shots it has already landed on it in a row (none on a new target); the
 * shot then counts toward the next.
 */
export function rampUp(
  tower: Building,
  victim: Readonly<Mark>,
  damage: number,
): number {
  const of = MARKS.indexOf(victim.of);
  if (tower.aimOf !== of || tower.aim !== victim.id)
    [tower.aimOf, tower.aim, tower.ramp] = [of, victim.id, 0];
  const ramped = div(damage * (100 + TOWER.ramp * tower.ramp), 100);
  if (tower.ramp < TOWER.rampMax) tower.ramp++;
  return ramped;
}

const within = (map: GameMap, id: number, spot: Readonly<Mark>): boolean => {
  const site = map.sites[id]!;
  const dx = spot.x - centreOf(site.x),
    dy = spot.y - centreOf(site.y);
  return dx * dx + dy * dy <= TOWER.range * TOWER.range;
};

/**
 * After the step's shots: each hero-on-hero hit (shooter, victim; in shooter order) turns every standing tower of the
 * victim's team with both in range onto the shooter, its ramp starting over unless it already aimed there.
 */
export function aggro(
  map: GameMap,
  world: World,
  duels: readonly (readonly [Readonly<Mark>, Readonly<Mark>])[],
): void {
  if (duels.length === 0) return;
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    if (site.lane < 0 || building.hp <= 0) continue;
    for (const [shooter, victim] of duels) {
      if (teamOf(victim.id) !== site.team) continue;
      if (!within(map, site.id, shooter) || !within(map, site.id, victim))
        continue;
      if (building.aimOf === 1 && building.aim === shooter.id) continue;
      [building.aimOf, building.aim, building.ramp] = [1, shooter.id, 0];
    }
  }
}
