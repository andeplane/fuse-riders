import {
  emptyCombat,
  type CombatStats,
  type KillMethod,
} from "./combat-stats.js";
import type { RoundPlacement } from "./leaderboard.js";
import type { PickupType } from "./pickup-types.js";
import { PICKUPS } from "./pickups.js";

export type MatchDeathCause = "wall" | "trail" | "explosion" | "rider";

export interface MatchDeathCounts {
  wall: number;
  trail: number;
  explosion: number;
  rider: number;
}

export interface MatchPlayerIdentity {
  id: string;
  name: string;
  slot: number;
  color: string;
}

export interface MatchPlayerStats {
  combat?: CombatStats;
  playerId: string;
  name: string;
  slot: number;
  color: string;
  roundsPlayed: number;
  roundWins: number;
  matchScoreUnits: number;
  roundsDrawn: number;
  matchPlacement: number;
  survivalTicks: number;
  longestSurvivalTicks: number;
  distanceUnits: number;
  bombsPlaced: number;
  bombsExploded: number;
  eliminations: number;
  deathsByCause: MatchDeathCounts;
  pickupsCollected: number;
  powerPickups: number;
  starPickups: number;
  beerPickups: number;
  inkPickups: number;
  triplePickups: number;
  fivePickups: number;
  /** Target Bomb is gone; the counter stays because stored match results are validated field by field. */
  targetPickups: number;

  shieldPickups: number;
  portalPickups: number;
  portalTransits: number;
  invulnerableTicks: number;
  wallBounces: number;
  earlyExits: number;
}

export interface MatchPlayerStatsState extends Omit<
  MatchPlayerStats,
  "matchPlacement"
> {
  currentRoundSurvivalTicks: number;
}

/**
 * Statistics observe a match; they never stop one. Every recorder below is called from inside a tick (`recordFacts`),
 * where a throw would abandon the tick half-way, so a rider the match never seated — which only a damaged state can
 * produce — is simply not counted (issue #253, C8). `finalizeMatchStatsRound` skips an unseated id the same way and
 * keeps its other two rejections: duplicate participant ids, and a winner who is not a participant.
 */
export type MatchStatsState = Map<string, MatchPlayerStatsState>;

export function beginMatchParticipant(
  stats: MatchStatsState,
  identity: MatchPlayerIdentity,
): void {
  const existing = stats.get(identity.id);
  if (existing) {
    existing.name = identity.name;
    existing.slot = identity.slot;
    existing.color = identity.color;
    existing.currentRoundSurvivalTicks = 0;
    return;
  }
  stats.set(identity.id, {
    combat: emptyCombat(),
    playerId: identity.id,
    name: identity.name,
    slot: identity.slot,
    color: identity.color,
    roundsPlayed: 0,
    roundWins: 0,
    matchScoreUnits: 0,
    roundsDrawn: 0,
    survivalTicks: 0,
    longestSurvivalTicks: 0,
    distanceUnits: 0,
    bombsPlaced: 0,
    bombsExploded: 0,
    eliminations: 0,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 },
    pickupsCollected: 0,
    powerPickups: 0,
    starPickups: 0,
    beerPickups: 0,
    inkPickups: 0,
    triplePickups: 0,
    fivePickups: 0,
    targetPickups: 0,

    shieldPickups: 0,
    portalPickups: 0,
    portalTransits: 0,
    invulnerableTicks: 0,
    wallBounces: 0,
    earlyExits: 0,
    currentRoundSurvivalTicks: 0,
  });
}

export function recordSurvivalTick(
  stats: MatchStatsState,
  playerId: string,
  distanceUnits: number,
  invulnerable: boolean,
  bounced: boolean,
): void {
  const entry = stats.get(playerId);
  if (!entry) return;
  entry.survivalTicks += 1;
  entry.currentRoundSurvivalTicks += 1;
  // A distance that is not a distance is dropped rather than added: one NaN would poison the total for the match.
  if (Number.isFinite(distanceUnits) && distanceUnits >= 0)
    entry.distanceUnits += distanceUnits;
  if (invulnerable) entry.invulnerableTicks += 1;
  if (bounced) entry.wallBounces += 1;
}

export function recordBombPlaced(
  stats: MatchStatsState,
  playerId: string,
): void {
  const entry = stats.get(playerId);
  if (entry) entry.bombsPlaced += 1;
}

export function recordBombExploded(
  stats: MatchStatsState,
  playerId: string,
): void {
  const entry = stats.get(playerId);
  if (entry) entry.bombsExploded += 1;
}

export function recordPickup(
  stats: MatchStatsState,
  playerId: string,
  type: PickupType,
): void {
  const entry = stats.get(playerId);
  if (!entry) return;
  entry.pickupsCollected += 1;
  const stat = PICKUPS[type].stat;
  if (stat) entry[stat] += 1;
}

export function recordPortalTransit(
  stats: MatchStatsState,
  playerId: string,
): void {
  const entry = stats.get(playerId);
  if (entry) entry.portalTransits += 1;
}

export function recordDeath(
  stats: MatchStatsState,
  playerId: string,
  cause: MatchDeathCause,
  creditedPlayerId?: string,
  method: KillMethod = cause === "explosion" ? "unknown" : cause,
): void {
  const victim = stats.get(playerId);
  const credited =
    creditedPlayerId !== undefined && creditedPlayerId !== playerId
      ? stats.get(creditedPlayerId)
      : undefined;
  if (victim) victim.deathsByCause[cause] += 1;
  if (victim?.combat) {
    victim.combat.deaths[method] += 1;
    if (credited)
      victim.combat.versus[
        credited.playerId.startsWith("bot:") ? "ai" : "human"
      ].deaths[method] += 1;
    if (credited)
      victim.combat.killers[credited.playerId] =
        (victim.combat.killers[credited.playerId] ?? 0) + 1;
    if (creditedPlayerId === playerId) victim.combat.selfDeaths += 1;
  }
  if (credited) {
    credited.eliminations += 1;
    if (credited.combat) {
      credited.combat.kills[method] += 1;
      credited.combat.versus[
        playerId.startsWith("bot:") ? "ai" : "human"
      ].kills[method] += 1;
      credited.combat.victims[playerId] =
        (credited.combat.victims[playerId] ?? 0) + 1;
    }
  }
}

export function recordEarlyExit(
  stats: MatchStatsState,
  playerId: string,
): void {
  const entry = stats.get(playerId);
  if (entry) entry.earlyExits += 1;
}

export function finalizeMatchStatsRound(
  stats: MatchStatsState,
  participantIds: readonly string[],
  winnerId?: string,
  placements: readonly RoundPlacement[] = [],
): void {
  const uniqueIds = new Set(participantIds);
  if (uniqueIds.size !== participantIds.length)
    throw new Error("Round participants must have unique ids");
  if (winnerId !== undefined && !uniqueIds.has(winnerId))
    throw new Error("Round winner must be a participant");
  const entries = participantIds.flatMap(
    (playerId) => stats.get(playerId) ?? [],
  );
  const scores = new Map<string, number>();
  for (const placement of placements) {
    if (
      !uniqueIds.has(placement.playerId) ||
      scores.has(placement.playerId) ||
      !Number.isSafeInteger(placement.scoreUnits) ||
      placement.scoreUnits < 0
    )
      throw new Error("Invalid round score");
    scores.set(placement.playerId, placement.scoreUnits);
  }
  const draw = winnerId === undefined;
  for (const entry of entries) {
    const place = placements.find((p) => p.playerId === entry.playerId)?.place;
    if (entry.combat && place !== undefined)
      entry.combat.roundPlaces[place - 1]! += 1;
    entry.roundsPlayed += 1;
    entry.matchScoreUnits += scores.get(entry.playerId) ?? 0;
    if (entry.playerId === winnerId) entry.roundWins += 1;
    if (draw) entry.roundsDrawn += 1;
    entry.longestSurvivalTicks = Math.max(
      entry.longestSurvivalTicks,
      entry.currentRoundSurvivalTicks,
    );
    entry.currentRoundSurvivalTicks = 0;
  }
}

/** Competitive ties use points, then round wins; display ordering never decides a winner. */
export function compareMatchScores(
  a: Pick<MatchPlayerStats, "matchScoreUnits" | "roundWins">,
  b: Pick<MatchPlayerStats, "matchScoreUnits" | "roundWins">,
): number {
  return b.matchScoreUnits - a.matchScoreUnits || b.roundWins - a.roundWins;
}

export function snapshotMatchStats(
  stats: ReadonlyMap<string, MatchPlayerStatsState>,
): MatchPlayerStats[] {
  const ordered = [...stats.values()].sort(
    (a, b) =>
      compareMatchScores(a, b) ||
      a.slot - b.slot ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
  let prior: MatchPlayerStatsState | undefined;
  let placement = 0;
  return ordered.map((entry, index) => {
    if (!prior || compareMatchScores(entry, prior) !== 0) placement = index + 1;
    prior = entry;
    return {
      ...(entry.combat ? { combat: structuredClone(entry.combat) } : {}),
      playerId: entry.playerId,
      name: entry.name,
      slot: entry.slot,
      color: entry.color,
      roundsPlayed: entry.roundsPlayed,
      roundWins: entry.roundWins,
      matchScoreUnits: entry.matchScoreUnits,
      roundsDrawn: entry.roundsDrawn,
      matchPlacement: placement,
      survivalTicks: entry.survivalTicks,
      longestSurvivalTicks: entry.longestSurvivalTicks,
      distanceUnits: entry.distanceUnits,
      bombsPlaced: entry.bombsPlaced,
      bombsExploded: entry.bombsExploded,
      eliminations: entry.eliminations,
      deathsByCause: { ...entry.deathsByCause },
      pickupsCollected: entry.pickupsCollected,
      powerPickups: entry.powerPickups,
      starPickups: entry.starPickups,
      beerPickups: entry.beerPickups,
      inkPickups: entry.inkPickups,
      triplePickups: entry.triplePickups,
      fivePickups: entry.fivePickups,
      targetPickups: entry.targetPickups,

      shieldPickups: entry.shieldPickups,
      portalPickups: entry.portalPickups,
      portalTransits: entry.portalTransits,
      invulnerableTicks: entry.invulnerableTicks,
      wallBounces: entry.wallBounces,
      earlyExits: entry.earlyExits,
    };
  });
}
