import type { PickupType } from './game.js';

export type MatchDeathCause = 'wall' | 'trail' | 'explosion' | 'rider';

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
  playerId: string;
  name: string;
  slot: number;
  color: string;
  roundsPlayed: number;
  roundWins: number;
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
  blastPickups: number;
  starPickups: number;
  beerPickups: number;
  inkPickups: number;
  triplePickups: number;
  fivePickups: number;
  targetPickups: number;

  shieldPickups: number;
  portalPickups: number;
  portalTransits: number;
  invulnerableTicks: number;
  wallBounces: number;
  earlyExits: number;
}

export interface MatchPlayerStatsState extends Omit<MatchPlayerStats, 'matchPlacement'> {
  currentRoundSurvivalTicks: number;
}

export type MatchStatsState = Map<string, MatchPlayerStatsState>;

export function beginMatchParticipant(stats: MatchStatsState, identity: MatchPlayerIdentity): void {
  const existing = stats.get(identity.id);
  if (existing) {
    existing.name = identity.name;
    existing.slot = identity.slot;
    existing.color = identity.color;
    existing.currentRoundSurvivalTicks = 0;
    return;
  }
  stats.set(identity.id, {
    playerId: identity.id,
    name: identity.name,
    slot: identity.slot,
    color: identity.color,
    roundsPlayed: 0,
    roundWins: 0,
    roundsDrawn: 0,
    survivalTicks: 0,
    longestSurvivalTicks: 0,
    distanceUnits: 0,
    bombsPlaced: 0,
    bombsExploded: 0,
    eliminations: 0,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 },
    pickupsCollected: 0,
    blastPickups: 0,
    starPickups: 0,
    beerPickups: 0, inkPickups: 0,
    triplePickups: 0,
    fivePickups: 0, targetPickups: 0,

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
  if (!Number.isFinite(distanceUnits) || distanceUnits < 0) throw new RangeError('distanceUnits must be finite and non-negative');
  const entry = requireEntry(stats, playerId);
  entry.survivalTicks += 1;
  entry.currentRoundSurvivalTicks += 1;
  entry.distanceUnits += distanceUnits;
  if (invulnerable) entry.invulnerableTicks += 1;
  if (bounced) entry.wallBounces += 1;
}

export function recordBombPlaced(stats: MatchStatsState, playerId: string): void {
  requireEntry(stats, playerId).bombsPlaced += 1;
}

export function recordBombExploded(stats: MatchStatsState, playerId: string): void {
  requireEntry(stats, playerId).bombsExploded += 1;
}

export function recordPickup(
  stats: MatchStatsState,
  playerId: string,
  type: PickupType,
): void {
  const entry = requireEntry(stats, playerId);
  entry.pickupsCollected += 1;
  if (type === 'target') entry.targetPickups += 1;
  else if (type === 'blast') entry.blastPickups += 1;
  else if (type === 'star') entry.starPickups += 1;
  else if (type === 'ink') entry.inkPickups += 1;
  else if (type === 'beer') entry.beerPickups += 1;
  else if (type === 'five') entry.fivePickups += 1;
  else if (type === 'triple') entry.triplePickups += 1;
  else if (type === 'orbitShield') entry.shieldPickups += 1;
  else if (type === 'portal') entry.portalPickups += 1;
}

export function recordPortalTransit(stats: MatchStatsState, playerId: string): void {
  requireEntry(stats, playerId).portalTransits += 1;
}

export function recordDeath(
  stats: MatchStatsState,
  playerId: string,
  cause: MatchDeathCause,
  creditedPlayerId?: string,
): void {
  const victim = requireEntry(stats, playerId);
  const credited = creditedPlayerId !== undefined && creditedPlayerId !== playerId
    ? requireEntry(stats, creditedPlayerId)
    : undefined;
  victim.deathsByCause[cause] += 1;
  if (credited) credited.eliminations += 1;
}

export function recordEarlyExit(stats: MatchStatsState, playerId: string): void {
  requireEntry(stats, playerId).earlyExits += 1;
}

export function finalizeMatchStatsRound(
  stats: MatchStatsState,
  participantIds: readonly string[],
  winnerId?: string,
): void {
  const uniqueIds = new Set(participantIds);
  if (uniqueIds.size !== participantIds.length) throw new Error('Round participants must have unique ids');
  if (winnerId !== undefined && !uniqueIds.has(winnerId)) throw new Error('Round winner must be a participant');
  const entries = participantIds.map((playerId) => requireEntry(stats, playerId));
  const draw = winnerId === undefined;
  for (const entry of entries) {
    entry.roundsPlayed += 1;
    if (entry.playerId === winnerId) entry.roundWins += 1;
    if (draw) entry.roundsDrawn += 1;
    entry.longestSurvivalTicks = Math.max(entry.longestSurvivalTicks, entry.currentRoundSurvivalTicks);
    entry.currentRoundSurvivalTicks = 0;
  }
}

export function snapshotMatchStats(stats: ReadonlyMap<string, MatchPlayerStatsState>): MatchPlayerStats[] {
  const ordered = [...stats.values()].sort((a, b) => b.roundWins - a.roundWins || a.slot - b.slot || a.playerId.localeCompare(b.playerId));
  let priorWins: number | undefined;
  let placement = 0;
  return ordered.map((entry, index) => {
    if (entry.roundWins !== priorWins) placement = index + 1;
    priorWins = entry.roundWins;
    return {
      playerId: entry.playerId,
      name: entry.name,
      slot: entry.slot,
      color: entry.color,
      roundsPlayed: entry.roundsPlayed,
      roundWins: entry.roundWins,
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
      blastPickups: entry.blastPickups,
      starPickups: entry.starPickups,
      beerPickups: entry.beerPickups,
      inkPickups: entry.inkPickups,
      triplePickups: entry.triplePickups, fivePickups: entry.fivePickups, targetPickups: entry.targetPickups,

      shieldPickups: entry.shieldPickups,
      portalPickups: entry.portalPickups,
      portalTransits: entry.portalTransits,
      invulnerableTicks: entry.invulnerableTicks,
      wallBounces: entry.wallBounces,
      earlyExits: entry.earlyExits,
    };
  });
}

function requireEntry(stats: ReadonlyMap<string, MatchPlayerStatsState>, playerId: string): MatchPlayerStatsState {
  const entry = stats.get(playerId);
  if (!entry) throw new Error(`unknown match participant: ${playerId}`);
  return entry;
}
