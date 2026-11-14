import type { MatchResult } from "fuse-platform";
import type { FuseSurgeStats } from "../platform.js";
import type { Room } from "./game.js";

/**
 * A finished match as every replica computes it, for the room service (`parseFuseSurgeStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick — the world, the roster the match
 * started with and who was still seated — so every device writes the same bytes however seats change afterwards.
 *
 * The platform rates rounds, and a Fuse Surge match reports as one: its rounds are the engine's, and a rider's
 * round wins are its score. Riders level on wins share a place, so a drawn match has several firsts.
 */
export type FuseSurgePlayerResult = FuseSurgeStats;

function players(room: Room): FuseSurgePlayerResult[] | undefined {
  const { world, decided, roster } = room;
  if (room.stage !== "over" || !world || !decided) return;
  return roster.map((entrant) => {
    const rider = world.riders[entrant.slot]!;
    const ahead = world.riders.filter((other) => other.wins > rider.wins);
    const won = ahead.length === 0;
    return {
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: won ? 1 : 0,
      matchScoreUnits: rider.wins,
      matchPlacement: ahead.length + 1,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      points: rider.wins,
      dodges: rider.dodges,
      hits: rider.taken,
    };
  });
}

/** The whole match, which credits account totals; undefined until the match is over. */
export function matchResult(
  room: Room,
): MatchResult<FuseSurgePlayerResult> | undefined {
  const list = players(room);
  if (!list || !room.decided) return;
  return {
    matchId: room.matchId,
    length: 1,
    // A drawn match has several winners: the placements say who.
    ...(room.decided.winners.length === 1
      ? { winnerId: room.decided.winners[0]! }
      : {}),
    finishers: [...room.decided.finishers],
    players: list,
  };
}

/** The same match as a rating receipt: a match is one round to the platform, which rates rounds. */
export function roundResult(
  room: Room,
): MatchResult<FuseSurgePlayerResult> | undefined {
  const result = matchResult(room);
  return result && { ...result, round: 1 };
}
