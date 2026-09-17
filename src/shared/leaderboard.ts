export const POINT_UNIT = 60;

const MAX_PARTICIPANTS = 5;

export interface SessionLeaderboardEntry {
  id: string;
  name: string;
  totalScoreUnits: number;
  roundsPlayed: number;
  roundWins: number;
  matchWins: number;
}

export interface RoundParticipant {
  id: string;
  name: string;
  /** Undefined means the rider survived the round. */
  eliminatedAtTick?: number;
}

export interface RoundPlacement {
  playerId: string;
  name: string;
  place: number;
  scoreUnits: number;
}

/** Rank a round without changing the participant input. Later elimination wins. */
export function rankRound(
  participants: readonly RoundParticipant[],
): RoundPlacement[] {
  if (participants.length < 2 || participants.length > MAX_PARTICIPANTS) {
    throw new RangeError("A round has two to five participants");
  }
  const ids = new Set<string>();
  for (const participant of participants) {
    if (!participant.id || ids.has(participant.id))
      throw new Error("Round participants must have unique ids");
    if (
      participant.eliminatedAtTick !== undefined &&
      (!Number.isSafeInteger(participant.eliminatedAtTick) ||
        participant.eliminatedAtTick < 0)
    ) {
      throw new RangeError(
        "eliminatedAtTick must be a non-negative safe integer",
      );
    }
    ids.add(participant.id);
  }

  const ordered = participants
    .map((participant, index) => ({ participant, index }))
    .sort((a, b) => {
      const aTick = a.participant.eliminatedAtTick ?? Number.POSITIVE_INFINITY;
      const bTick = b.participant.eliminatedAtTick ?? Number.POSITIVE_INFINITY;
      return bTick - aTick || a.index - b.index;
    });

  const placements: RoundPlacement[] = [];
  for (let start = 0; start < ordered.length;) {
    const startTick =
      ordered[start]!.participant.eliminatedAtTick ?? Number.POSITIVE_INFINITY;
    let end = start + 1;
    while (end < ordered.length) {
      const endTick =
        ordered[end]!.participant.eliminatedAtTick ?? Number.POSITIVE_INFINITY;
      if (endTick !== startTick) break;
      end += 1;
    }
    const firstPlace = start + 1;
    // Only strictly earlier deaths count. A sole survivor earns the win bonus;
    // same-tick deaths and multiple timeout survivors never outlast each other.
    const bonus = startTick === Number.POSITIVE_INFINITY && end === 1 ? 1 : 0;
    const scoreUnits = (ordered.length - end + bonus) * POINT_UNIT;
    for (let index = start; index < end; index += 1) {
      const { participant } = ordered[index]!;
      placements.push({
        playerId: participant.id,
        name: participant.name,
        place: firstPlace,
        scoreUnits,
      });
    }
    start = end;
  }
  return placements;
}

export function applyRoundScores(
  entries: Map<string, SessionLeaderboardEntry>,
  placements: readonly RoundPlacement[],
  winnerId?: string,
  matchWinnerId?: string,
): void {
  const seen = new Set<string>();
  for (const placement of placements) {
    if (!placement.playerId || seen.has(placement.playerId))
      throw new Error("Round placements must have unique ids");
    if (
      !Number.isInteger(placement.place) ||
      placement.place < 1 ||
      placement.place > MAX_PARTICIPANTS
    ) {
      throw new RangeError("Round placement must be between one and five");
    }
    if (
      !Number.isSafeInteger(placement.scoreUnits) ||
      placement.scoreUnits < 0
    ) {
      throw new RangeError(
        "Round score units must be a non-negative safe integer",
      );
    }
    seen.add(placement.playerId);
  }
  if (winnerId !== undefined && !seen.has(winnerId))
    throw new Error("Round winner must be a participant");
  if (matchWinnerId !== undefined && matchWinnerId !== winnerId) {
    throw new Error("Match winner must also be the round winner");
  }

  for (const placement of placements) {
    const current = entries.get(placement.playerId) ?? {
      id: placement.playerId,
      name: placement.name,
      totalScoreUnits: 0,
      roundsPlayed: 0,
      roundWins: 0,
      matchWins: 0,
    };
    current.name = placement.name;
    current.totalScoreUnits += placement.scoreUnits;
    current.roundsPlayed += 1;
    if (placement.playerId === winnerId) current.roundWins += 1;
    if (placement.playerId === matchWinnerId) current.matchWins += 1;
    entries.set(current.id, current);
  }
}

export function sortedLeaderboard(
  entries: ReadonlyMap<string, SessionLeaderboardEntry>,
): SessionLeaderboardEntry[] {
  return [...entries.values()]
    .map((entry) => ({ ...entry }))
    .sort(
      (a, b) =>
        b.totalScoreUnits - a.totalScoreUnits ||
        b.matchWins - a.matchWins ||
        a.id.localeCompare(b.id),
    );
}
