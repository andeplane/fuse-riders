import type { MatchResult } from "fuse-platform";
import type { KillerFuseStats } from "../platform.js";
import { teamOfSlot } from "./basics.js";
import { noStats, type GameRecord, type Room } from "./game.js";

/**
 * What a room reports to `fuse-platform`: each decided game as a rating receipt, and the finished set as the match.
 * Both name people only (a slot a bot played is nobody's result) and are built from the game records, frozen at the
 * tick each game was recorded on, so every device writes the same bytes however seats change afterwards.
 *
 * Killer Fuse is a team game and the platform rates a free-for-all: every player of the winning team is placed first
 * and every player of the losing team after all of them, so teammates tie and each winner beats each loser.
 */
export type KillerFusePlayerResult = KillerFuseStats;

/** The platform rates and attests at most this many players of one result (`MAX_RATED_PLAYERS`). */
export const MAX_REPORTED = 5;

/** Where a loser stands: behind every winner, and never past the last place there is. */
const loserPlace = (winners: number, players: number): number =>
  Math.min(players, 1 + Math.max(1, winners));
/** The people of a record with the slot each sat in. */
const crewRows = (record: GameRecord) =>
  record.crew.flatMap((id, slot) => (id ? [{ id, slot }] : []));
/** The lowest-slot person on the team that won the record's game: the result's `winnerId`, where one exists. */
const winnerOf = (record: GameRecord): string | undefined =>
  crewRows(record).find((row) => teamOfSlot(row.slot) === record.team)?.id;

/**
 * Game `round` of the set as a rating receipt (`round` set, `length` 1). Undefined for a game not decided in this
 * set, and for one six people played: the platform takes at most five players in a receipt, so a full room of people
 * is not rated game by game.
 */
export function roundResult(
  room: Room,
  round: number,
): MatchResult<KillerFusePlayerResult> | undefined {
  const record = room.results.find((entry) => entry.round === round);
  if (!record) return;
  const rows = crewRows(record);
  if (rows.length > MAX_REPORTED) return;
  const winners = rows.filter((row) => teamOfSlot(row.slot) === record.team);
  const winnerId = winnerOf(record);
  return {
    matchId: room.matchId,
    round,
    length: 1,
    ...(winnerId ? { winnerId } : {}),
    finishers: record.present,
    players: rows.map(({ id, slot }) => {
      const won = teamOfSlot(slot) === record.team ? 1 : 0;
      return {
        playerId: id,
        name: room.roster[id]!.name,
        slot,
        roundsPlayed: 1,
        roundWins: won,
        matchScoreUnits: won,
        matchPlacement: won ? 1 : loserPlace(winners.length, rows.length),
        earlyExits: record.present.includes(id) ? 0 : 1,
        won,
        kills: 0,
        deaths: 0,
        berries: 0,
      };
    }),
  };
}

/**
 * The finished set as every replica computes it, or undefined before it is over. Its players are everyone who sat
 * through the end of one of its games, in the slot they last held; the winners are the people of the deciding game's
 * winning team. Someone not connected when that game was recorded left early. The platform lets at most five players
 * attest, so of six the first five by slot are the finishers.
 */
export function matchResult(
  room: Room,
): MatchResult<KillerFusePlayerResult> | undefined {
  const decided = room.results.at(-1);
  if (room.stage !== "over" || !decided) return;
  const winners = new Set(
    crewRows(decided)
      .filter((row) => teamOfSlot(row.slot) === decided.team)
      .map((row) => row.id),
  );
  const rows = Object.entries(room.roster)
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1));
  const winnerId = winnerOf(decided);
  return {
    matchId: room.matchId,
    length: room.results.length,
    ...(winnerId ? { winnerId } : {}),
    finishers: rows
      .filter((row) => decided.present.includes(row.id))
      .slice(0, MAX_REPORTED)
      .map((row) => row.id)
      .sort(),
    players: rows.map((row) => {
      const stats = room.stats[row.id] ?? noStats();
      return {
        playerId: row.id,
        name: row.name,
        slot: row.slot,
        roundsPlayed: stats.games,
        roundWins: stats.gameWins,
        matchScoreUnits: stats.gameWins,
        matchPlacement: winners.has(row.id)
          ? 1
          : loserPlace(winners.size, rows.length),
        earlyExits: decided.present.includes(row.id) ? 0 : 1,
        won: winners.has(row.id) ? 1 : 0,
        kills: stats.kills,
        deaths: stats.deaths,
        berries: stats.berries,
      };
    }),
  };
}
