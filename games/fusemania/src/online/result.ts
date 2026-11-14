import type { MatchResult } from "fuse-platform";
import { MOST_RATING } from "../basics.js";
import {
  BOO,
  GOOD,
  GREAT,
  MARVELOUS,
  MISS,
  PERFECT,
  ranking,
  rating,
  type Library,
} from "../engine/index.js";
import type { FusemaniaStats } from "../platform.js";
import type { Room } from "./game.js";

/**
 * A finished match as every replica computes it, for the room service (`parseFusemaniaStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick (the world, the roster the match
 * started with and who was still seated), so every device writes the same bytes however seats change afterwards.
 */
export type FusemaniaPlayerResult = FusemaniaStats;

function players(
  library: Library,
  room: Room,
): FusemaniaPlayerResult[] | undefined {
  const { decided, roster, world } = room;
  if (room.stage !== "over" || !decided || !world) return;
  const places = ranking(library, world);
  return roster.map((entrant) => {
    const player = world.players[entrant.slot]!,
      placement = places.indexOf(entrant.slot) + 1,
      counts = player.counts;
    const score = Math.min(
      MOST_RATING,
      rating(library.steps(world.song, player.chart)!, player.score),
    );
    return {
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: placement === 1 ? 1 : 0,
      matchScoreUnits: score,
      matchPlacement: placement,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      rating: score,
      combo: player.best,
      marvelous: counts[MARVELOUS]!,
      perfect: counts[PERFECT]!,
      great: counts[GREAT]!,
      steps:
        counts[MARVELOUS]! +
        counts[PERFECT]! +
        counts[GREAT]! +
        counts[GOOD]! +
        counts[BOO]!,
      misses: counts[MISS]!,
    };
  });
}

/** The whole match, which credits account totals; undefined until the match is over. */
export function matchResult(
  library: Library,
  room: Room,
): MatchResult<FusemaniaPlayerResult> | undefined {
  const list = players(library, room);
  if (!list || !room.decided) return;
  return {
    matchId: room.matchId,
    length: 1,
    winnerId: room.decided.winner,
    finishers: [...room.decided.finishers],
    players: list,
  };
}

/** The same match as a rating receipt: a match is one round to the platform. */
export function roundResult(
  library: Library,
  room: Room,
): MatchResult<FusemaniaPlayerResult> | undefined {
  const result = matchResult(library, room);
  return result && { ...result, round: 1 };
}
