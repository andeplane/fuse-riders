import {
  emptyCombat,
  KILL_METHODS,
  parseCombat,
  type CombatStats,
} from "../engine/combat-stats.js";
import { WEAPONS } from "../engine/shot-log.js";
import type { MatchPlayerStats } from "../engine/match-stats.js";
export const GAME_GROUPS = ["human", "mixed", "practice"] as const;
export type GameGroup = (typeof GAME_GROUPS)[number];
export function gameGroup(
  players: readonly Pick<MatchPlayerStats, "playerId">[],
): GameGroup {
  const humans = players.filter((p) => !p.playerId.startsWith("bot:")).length;
  return humans < 2
    ? "practice"
    : humans === players.length
      ? "human"
      : "mixed";
}
export const CAREER_SUMS = [
  "matches",
  "wins",
  "rounds",
  "roundWins",
  "kills",
  "deaths",
  "distance",
  "survival",
  "bombs",
  "pickups",
  "portals",
  "bounces",
  "invulnerable",
  "placeSum",
  "fieldScore",
  "opponents",
  "detailMatches",
  "humanKills",
  "aiKills",
  "humanDeaths",
  "aiDeaths",
] as const;
export interface CareerStats extends Record<
  (typeof CAREER_SUMS)[number],
  number
> {
  placements: number[];
  bestKills: number;
  longestLife: number;
  furthestMatch: number;
  combat: CombatStats;
}
export type CareerBuckets = Record<GameGroup, CareerStats>;
export const emptyCareer = (): CareerStats => ({
  ...(Object.fromEntries(CAREER_SUMS.map((k) => [k, 0])) as Record<
    (typeof CAREER_SUMS)[number],
    number
  >),
  placements: Array.from({ length: 128 }, () => 0),
  bestKills: 0,
  longestLife: 0,
  furthestMatch: 0,
  combat: emptyCombat(),
});
export const emptyBuckets = (): CareerBuckets => ({
  human: emptyCareer(),
  mixed: emptyCareer(),
  practice: emptyCareer(),
});
export function mergeCareer(
  target: CareerStats,
  source: CareerStats,
): CareerStats {
  for (const key of CAREER_SUMS) target[key] += source[key];
  target.placements = target.placements.map(
    (n, i) => n + (source.placements[i] ?? 0),
  );
  target.bestKills = Math.max(target.bestKills, source.bestKills);
  target.longestLife = Math.max(target.longestLife, source.longestLife);
  target.furthestMatch = Math.max(target.furthestMatch, source.furthestMatch);
  for (const key of KILL_METHODS) {
    target.combat.kills[key] += source.combat.kills[key];
    target.combat.deaths[key] += source.combat.deaths[key];
  }
  for (const kind of ["human", "ai"] as const)
    for (const key of KILL_METHODS) {
      target.combat.versus[kind].kills[key] +=
        source.combat.versus[kind].kills[key];
      target.combat.versus[kind].deaths[key] +=
        source.combat.versus[kind].deaths[key];
    }
  for (const key of WEAPONS) target.combat.uses[key] += source.combat.uses[key];
  target.combat.roundPlaces = target.combat.roundPlaces.map(
    (n, i) => n + source.combat.roundPlaces[i]!,
  );
  target.combat.selfDeaths += source.combat.selfDeaths;
  return target;
}
export function careerFor(
  player: MatchPlayerStats,
  players: readonly MatchPlayerStats[],
): CareerStats {
  const stats = emptyCareer();
  Object.assign(stats, {
    matches: 1,
    wins: Number(player.matchPlacement === 1),
    rounds: player.roundsPlayed,
    roundWins: player.roundWins,
    kills: player.eliminations,
    deaths: Object.values(player.deathsByCause).reduce((a, b) => a + b, 0),
    distance: player.distanceUnits,
    survival: player.survivalTicks,
    bombs: player.bombsPlaced,
    pickups: player.pickupsCollected,
    portals: player.portalTransits,
    bounces: player.wallBounces,
    invulnerable: player.invulnerableTicks,
    placeSum: player.matchPlacement,
    bestKills: player.eliminations,
    longestLife: player.longestSurvivalTicks,
    furthestMatch: player.distanceUnits,
  });
  stats.placements[player.matchPlacement - 1] = 1;
  for (const opponent of players)
    if (opponent.playerId !== player.playerId) {
      stats.opponents++;
      stats.fieldScore +=
        player.matchPlacement < opponent.matchPlacement
          ? 1
          : player.matchPlacement === opponent.matchPlacement
            ? 0.5
            : 0;
    }
  if (player.combat) {
    stats.detailMatches = 1;
    stats.combat = structuredClone(player.combat);
    stats.combat.victims = {};
    stats.combat.killers = {};
    for (const [id, n] of Object.entries(player.combat.victims))
      stats[id.startsWith("bot:") ? "aiKills" : "humanKills"] += n;
    for (const [id, n] of Object.entries(player.combat.killers))
      stats[id.startsWith("bot:") ? "aiDeaths" : "humanDeaths"] += n;
  }
  return stats;
}
/** Fail closed on malformed aggregate documents; absent means tracking has not started. */
export function parseBuckets(raw: unknown): CareerBuckets | undefined {
  if (!raw || typeof raw !== "object") return;
  const result = emptyBuckets();
  for (const group of GAME_GROUPS) {
    const value = (raw as Record<string, unknown>)[group];
    if (!value || typeof value !== "object") return;
    const data = value as Record<string, unknown>,
      combat = parseCombat(data.combat);
    if (
      !combat ||
      ![...CAREER_SUMS, "bestKills", "longestLife", "furthestMatch"].every(
        (k) =>
          typeof data[k] === "number" &&
          Number.isFinite(data[k]) &&
          (data[k] as number) >= 0 &&
          (data[k] as number) <= Number.MAX_SAFE_INTEGER,
      )
    )
      return;
    if (
      !Array.isArray(data.placements) ||
      data.placements.length !== 128 ||
      !data.placements.every((n) => Number.isSafeInteger(n) && n >= 0)
    )
      return;
    result[group] = {
      ...Object.fromEntries(
        [...CAREER_SUMS, "bestKills", "longestLife", "furthestMatch"].map(
          (key) => [key, data[key]],
        ),
      ),
      combat,
      placements: [...data.placements],
    } as unknown as CareerStats;
  }
  return result;
}
