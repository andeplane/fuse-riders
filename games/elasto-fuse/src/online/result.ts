import type { MatchResult } from "fuse-platform";
import { MOST_DEATHS } from "../basics.js";
import type { ElastoFuseStats } from "../platform.js";
import { order, type Room } from "./game.js";

/**
 * A finished match as every replica computes it, for the room service (`parseElastoFuseStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick (the standings, the roster the
 * match started with and who was still seated), so every device writes the same bytes however seats change afterwards.
 */
export type ElastoFusePlayerResult = ElastoFuseStats;

function players(room: Room): ElastoFusePlayerResult[] | undefined {
  const { decided, roster, standings } = room;
  if (room.stage !== "over" || !decided) return;
  const places = order(standings);
  return roster.map((entrant) => {
    const standing = standings[entrant.slot]!,
      placement = places.indexOf(entrant.slot) + 1;
    return {
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: placement === 1 ? 1 : 0,
      matchScoreUnits: standing.points,
      matchPlacement: placement,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      points: standing.points,
      finishes: standing.finishes,
      deaths: Math.min(standing.deaths, MOST_DEATHS),
    };
  });
}

/** The whole match, which credits account totals; undefined until the match is over. */
export function matchResult(
  room: Room,
): MatchResult<ElastoFusePlayerResult> | undefined {
  const list = players(room);
  if (!list || !room.decided) return;
  return {
    matchId: room.matchId,
    length: 1,
    winnerId: room.decided.winner,
    finishers: [...room.decided.finishers],
    players: list,
  };
}

/** The same match as a rating receipt: a match is one round to the platform, however many levels it raced. */
export function roundResult(
  room: Room,
): MatchResult<ElastoFusePlayerResult> | undefined {
  const result = matchResult(room);
  return result && { ...result, round: 1 };
}
