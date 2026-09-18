import type { MatchResult, PlayerResult } from "fuse-platform";
import type { DiceRoom } from "./rules.js";

/** One player's result as `fuse-platform` stores it: the fields it reads itself, plus the points they banked. */
export interface DicePlayerResult extends PlayerResult {
  /** Points banked in the rounds reported, summed over rounds. */
  points: number;
}

/** 1 plus the number of players strictly ahead; ties share a place. */
function placements<T>(items: T[], better: (a: T, b: T) => boolean): number[] {
  return items.map(
    (item) => 1 + items.filter((other) => better(other, item)).length,
  );
}

/**
 * The finished match as every replica computes it, or undefined before the match is over. Placement is by round wins,
 * then points; `matchScoreUnits` is the round wins. A player no longer seated (or absent) when the deciding round was
 * decided left early. Who finished and who left are read from that round's record, frozen at the tick it was decided,
 * so every device writes the same receipt however seats change afterwards.
 */
export function matchResult(
  room: DiceRoom,
): MatchResult<DicePlayerResult> | undefined {
  const decided = room.history.at(-1);
  if (room.stage !== "over" || !room.winner || !decided) return;
  const seated = new Set(decided.present);
  const rows = Object.entries(room.roster)
    .map(([id, entry]) => ({
      id,
      ...entry,
      wins: room.wins[id] ?? 0,
      points: room.history.reduce(
        (sum, record) => sum + (record.scores[id] ?? 0),
        0,
      ),
    }))
    .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1));
  const places = placements(
    rows,
    (a, b) => a.wins > b.wins || (a.wins === b.wins && a.points > b.points),
  );
  return {
    matchId: room.matchId,
    length: room.history.length,
    winnerId: room.winner,
    finishers: decided.finishers,
    players: rows.map((row, index) => ({
      playerId: row.id,
      name: row.name,
      slot: row.slot,
      roundsPlayed: room.played[row.id] ?? 0,
      roundWins: row.wins,
      matchScoreUnits: row.wins,
      matchPlacement: places[index]!,
      earlyExits: seated.has(row.id) ? 0 : 1,
      points: row.points,
    })),
  };
}

/**
 * One decided round as a rating receipt (`round` set, `length` 1): its players are those who played it, placed by the
 * points they had banked when it was decided. Undefined for a round not decided in this match.
 */
export function roundResult(
  room: DiceRoom,
  round: number,
): MatchResult<DicePlayerResult> | undefined {
  const record = room.history.find((entry) => entry.round === round);
  if (!record) return;
  const rows = Object.entries(record.scores)
    .map(([id, points]) => ({ id, points, ...room.roster[id]! }))
    .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1));
  const places = placements(rows, (a, b) => a.points > b.points);
  return {
    matchId: room.matchId,
    round,
    length: 1,
    winnerId: record.winnerId,
    finishers: record.finishers.filter((id) =>
      Object.hasOwn(record.scores, id),
    ),
    players: rows.map((row, index) => ({
      playerId: row.id,
      name: row.name,
      slot: row.slot,
      roundsPlayed: 1,
      roundWins: row.id === record.winnerId ? 1 : 0,
      matchScoreUnits: row.points,
      matchPlacement: places[index]!,
      earlyExits: 0,
      points: row.points,
    })),
  };
}
