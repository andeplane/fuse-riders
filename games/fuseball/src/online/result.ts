import type { MatchResult } from "fuse-platform";
import type { FuseballStats } from "../platform.js";
import type { Room } from "./game.js";

/**
 * A finished match as every replica computes it, for the room service (`parseFuseballStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick — the world, the roster the match
 * started with and who was still seated — so every device writes the same bytes however seats change afterwards.
 */
export type FuseballPlayerResult = FuseballStats;

function players(room: Room): FuseballPlayerResult[] | undefined {
  const { world, decided, roster } = room;
  if (room.stage !== "over" || !world || !decided) return;
  return roster.map((entrant) => {
    const rider = world.riders[entrant.slot];
    const won = entrant.id === decided.winner;
    return {
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: won ? 1 : 0,
      // The points on the board: this rider's own goals plus the other's own goals.
      matchScoreUnits: world.score[entrant.slot],
      matchPlacement: won ? 1 : 2,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      goals: rider.goals,
      ownGoals: rider.ownGoals,
      bubbles: world.bubbles[entrant.slot].seq,
      pops: rider.pops,
    };
  });
}

/** The whole match, which credits account totals; undefined until the match is over. */
export function matchResult(
  room: Room,
): MatchResult<FuseballPlayerResult> | undefined {
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

/**
 * The same match as a rating receipt: a Fuseball match is one round, and the platform rates rounds. It carries the
 * same players and stats as the match result; only `round` tells them apart.
 */
export function roundResult(
  room: Room,
): MatchResult<FuseballPlayerResult> | undefined {
  const result = matchResult(room);
  return result && { ...result, round: 1 };
}
