import { neighbors } from "./map.js";
import { RULES, type MapDefinition, type World } from "./types.js";

/**
 * Territory is the core of Fuse Craft: every connected structure claims its
 * own cell and the cells around it. A cell touched by two players' networks is
 * contested and counts for nobody. Territory pays a nutrient trickle, and a
 * player who holds a large enough share for long enough wins by dominance.
 */
export const TERRITORY = Object.freeze({
  /** Biomass per claimed cell, paid once a second. */
  incomePerCell: 16,
  /** How long a dominant share must be held, in ticks (60 s). */
  dominanceTicks: 1200,
});

/** Cells that can be claimed: everything a network can grow over or mine. */
export function claimableCells(map: Readonly<MapDefinition>): number {
  return map.cells.filter((cell) => cell.terrain !== "blocked").length;
}

/**
 * The share of claimable cells needed for dominance: 40% of the map against
 * one rival, a little less with more players (35% of a four-way map), so a
 * free-for-all can still end. Contested cells count for nobody, so holding
 * it means pushing rivals back, not just outgrowing them.
 */
export function dominanceShare(players: number): number {
  return 0.3 + 0.2 / Math.max(2, players);
}
/** A dominant player also holds this many times any rival's territory. */
export const DOMINANCE_LEAD = 1.5;
export function dominanceCells(world: Readonly<World>): number {
  return Math.ceil(
    claimableCells(world.map) * dominanceShare(world.players.length),
  );
}

/** Owner of each claimed cell; contested and unclaimed cells are absent. */
export function territoryOwners(world: Readonly<World>): Map<number, string> {
  const claims = new Map<number, string | null>();
  for (const s of world.structures) {
    if (!s.connected) continue;
    for (const cell of [s.cell, ...neighbors(world.map, s.cell)]) {
      if (world.map.cells[cell]?.terrain === "blocked") continue;
      const current = claims.get(cell);
      if (current === undefined) claims.set(cell, s.ownerId);
      else if (current !== s.ownerId) claims.set(cell, null);
    }
  }
  const owners = new Map<number, string>();
  for (const [cell, owner] of claims) if (owner) owners.set(cell, owner);
  return owners;
}

export function territoryCounts(world: Readonly<World>): Map<string, number> {
  const counts = new Map<string, number>(world.players.map((p) => [p.id, 0]));
  for (const owner of territoryOwners(world).values())
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  return counts;
}

/**
 * Updates each player's territory, pays the trickle once a second, and runs
 * the dominance clock. Returns the dominant winner, if the clock ran out.
 */
export function territoryPhase(
  w: World,
  emit: (playerId: string, type: "dominating" | "dominanceBroken") => void,
): string | null {
  const counts = territoryCounts(w);
  const needed = dominanceCells(w);
  const ready: typeof w.players = [];
  for (const p of w.players) {
    p.territory = p.alive ? (counts.get(p.id) ?? 0) : 0;
    if (!p.alive) {
      p.dominanceSince = null;
      continue;
    }
    if (w.tick % RULES.ticksPerSecond === 0) {
      const income = Math.min(
        p.territory * TERRITORY.incomePerCell,
        RULES.bankCap - p.biomass,
      );
      p.biomass += income;
      p.statistics.biomassEarned += income;
    }
    const rival = Math.max(
      0,
      ...w.players
        .filter((q) => q !== p && q.alive)
        .map((q) => counts.get(q.id) ?? 0),
    );
    const dominant =
      w.players.length > 1 &&
      p.territory >= needed &&
      p.territory >= rival * DOMINANCE_LEAD;
    if (dominant && p.dominanceSince === null) {
      p.dominanceSince = w.tick;
      emit(p.id, "dominating");
    } else if (!dominant && p.dominanceSince !== null) {
      p.dominanceSince = null;
      emit(p.id, "dominanceBroken");
    }
    if (
      dominant &&
      p.dominanceSince !== null &&
      w.tick - p.dominanceSince >= TERRITORY.dominanceTicks
    )
      ready.push(p);
  }
  // With three or more players two can hold a dominant share at once: the
  // longest hold wins, then the larger territory; an exact tie plays on.
  ready.sort(
    (a, b) =>
      a.dominanceSince! - b.dominanceSince! || b.territory - a.territory,
  );
  const [first, second] = ready;
  if (!first) return null;
  if (
    second &&
    second.dominanceSince === first.dominanceSince &&
    second.territory === first.territory
  )
    return null;
  return first.id;
}
