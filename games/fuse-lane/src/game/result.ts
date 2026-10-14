import type { MatchResult } from "fuse-platform";
import type { FuseLaneStats } from "../platform.js";
import { MAX_NET_WORTH } from "./basics.js";
import { active, playerOrder, type FuseLaneRoom } from "./room.js";
import { degrees, netWorth, progress } from "./state.js";

/** One player's result as `fuse-platform` stores it (`parseFuseLaneStats` is its boundary). */
export type FuseLanePlayerResult = FuseLaneStats;

/**
 * The finished match as every replica computes it, or undefined before it is over. Placement is the room's ranking
 * (winners first, by overshoot then net worth; the rest by goal progress); `matchScoreUnits` is goal progress in
 * percent. A player not seated and present when the match ended left early.
 */
export function matchResult(
  room: FuseLaneRoom,
): MatchResult<FuseLanePlayerResult> | undefined {
  if (room.stage !== "over" || room.ranking.length === 0) return;
  const economy = room.economy;
  const present = (id: string) => active(room.seats.get(id));
  const rows = playerOrder(room).map((id) => {
    const player = room.players[id]!,
      entry = room.roster[id]!;
    return {
      playerId: id,
      name: entry.name,
      slot: entry.slot,
      roundsPlayed: 1,
      roundWins: room.winners.includes(id) ? 1 : 0,
      matchScoreUnits: Math.round(progress(player, economy) * 100),
      matchPlacement: room.ranking.indexOf(id) + 1,
      earlyExits: present(id) ? 0 : 1,
      weeks: Math.max(1, player.finished || room.week),
      // Clamped to what `parseFuseLaneStats` accepts, so a fortune never gets the whole result refused.
      netWorth: Math.min(
        MAX_NET_WORTH,
        Math.max(0, Math.round(netWorth(player, economy))),
      ),
      degrees: degrees(player),
      shifts: player.shifts,
    };
  });
  return {
    matchId: room.matchId,
    length: 1,
    winnerId: room.winners[0]!,
    finishers: rows
      .filter(
        (row) => !room.seats.get(row.playerId)?.bot && present(row.playerId),
      )
      .map((row) => row.playerId)
      .sort(),
    players: rows.sort(
      (a, b) => a.slot - b.slot || (a.playerId < b.playerId ? -1 : 1),
    ),
  };
}
