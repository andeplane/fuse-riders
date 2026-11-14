import type { MatchResult } from "fuse-platform";
import type { FuseVolleyStats } from "../platform.js";
import { teamOfSlot, type Room } from "./game.js";

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
  const format = world.format,
    kings = format === "2v2v2";
  /** A team's points: its side's, or three teams of two, its own. */
  const pointsOf = (team: number): number =>
    kings ? world.points[team]! : world.score[team === 1 ? 1 : 0];
  const winning = teamOfSlot(winner.slot, format);
  return roster.map((entrant) => {
    const blob = world.blobs[entrant.slot]!,
      team = teamOfSlot(entrant.slot, format);
    // Every blob of the winning team wins, and each reports its team's points. Three teams of two, the other two place
    // second and third by points, level ones both second.
    const won = team === winning,
      points = pointsOf(team);
    const ahead = kings
      ? [0, 1, 2].filter(
          (other) =>
            other !== team && other !== winning && pointsOf(other) > points,
        ).length
      : 0;
    return {
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: won ? 1 : 0,
      matchScoreUnits: points,
      matchPlacement: won ? 1 : 2 + ahead,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      points,
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
    // Teams have several winners: the placements say who.
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
