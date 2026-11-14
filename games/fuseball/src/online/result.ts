import type { MatchResult } from "fuse-platform";
import { MOST_BUBBLES } from "../basics.js";
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
  return roster.map((entrant, index) => {
    const rider = world.riders[index],
      bubble = world.bubbles[index];
    const won = entrant.slot === decided.side;
    return {
      playerId: entrant.id,
      name: entrant.name,
      // The rider's place in the match: even places are one side, odd the other.
      slot: index,
      roundsPlayed: 1,
      roundWins: won ? 1 : 0,
      // The points on the side's board: its riders' goals plus the other side's own goals.
      matchScoreUnits: world.score[entrant.slot],
      matchPlacement: won ? 1 : 2,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      goals: rider?.goals ?? 0,
      ownGoals: rider?.ownGoals ?? 0,
      // The world's counters are cosmetic and wrap; a result stops counting at what the service accepts.
      bubbles: Math.min(bubble?.seq ?? 0, MOST_BUBBLES),
      pops: Math.min(rider?.pops ?? 0, MOST_BUBBLES),
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
