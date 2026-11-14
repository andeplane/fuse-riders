import type { MatchResult } from "fuse-platform";
import type { FuseVolleyStats } from "../platform.js";
import { sideOf, type Room } from "./game.js";

/**
 * A finished match as every replica computes it, for the room service (`parseFuseVolleyStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick — the world, the roster the match
 * started with and who was still seated — so every device writes the same bytes however seats change afterwards.
 */
export type FuseVolleyPlayerResult = FuseVolleyStats;

function players(room: Room): FuseVolleyPlayerResult[] | undefined {
  const { world, decided, roster } = room;
  if (room.stage !== "over" || !world || !decided) return;
  const winner = roster.find((entrant) => entrant.id === decided.winner);
  if (!winner) return;
  return roster.map((entrant) => {
    const blob = world.blobs[entrant.slot]!,
      side = sideOf(entrant.slot);
    // Doubles: both blobs of the winning side win, and each reports its side's points.
    const won = side === sideOf(winner.slot);
    return {
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: won ? 1 : 0,
      matchScoreUnits: world.score[side],
      matchPlacement: won ? 1 : 2,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      points: world.score[side],
      hits: blob.hits,
    };
  });
}

/** The whole match, which credits account totals; undefined until the match is over. */
export function matchResult(
  room: Room,
): MatchResult<FuseVolleyPlayerResult> | undefined {
  const list = players(room);
  if (!list || !room.decided) return;
  return {
    matchId: room.matchId,
    length: 1,
    // Doubles has two winners: the placements say who.
    ...(list.length === 2 ? { winnerId: room.decided.winner } : {}),
    finishers: [...room.decided.finishers],
    players: list,
  };
}

/** The same match as a rating receipt: a match is one round, and the platform rates rounds. */
export function roundResult(
  room: Room,
): MatchResult<FuseVolleyPlayerResult> | undefined {
  const result = matchResult(room);
  return result && { ...result, round: 1 };
}
