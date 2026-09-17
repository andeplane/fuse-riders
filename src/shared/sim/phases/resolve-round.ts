import type { TickContext } from "../context.js";
import {
  type GameState,
  type PlayerId,
  sortedBombs,
  sortedPlayers,
} from "../../state.js";
import {
  MATCH_WINNER_TICKS,
  MAX_PLAYERS,
  ROUND_DRAW_TICK,
  ROUND_OVER_TICKS,
} from "../../tuning.js";
import { REPLAY_PAUSE_TICKS, roundHasMoment } from "../../moments.js";
import {
  type RoundParticipant,
  type RoundPlacement,
  applyRoundScores,
  rankRound,
} from "../../leaderboard.js";
import {
  compareMatchScores,
  finalizeMatchStatsRound,
} from "../../match-stats.js";
import { decideRound } from "../../shot-log.js";

/**
 * The round ends when one rider or none is left, or when the clock draws it. Placements, scores, the match winner, the
 * decided round's shot log and rating standings are all settled here, on the tick of the last elimination.
 */
export function resolveRound(ctx: TickContext): void {
  const { state, events, elapsed } = ctx;
  if (state.phase !== "playing") return;
  const alive = sortedPlayers(state).filter((player) => player.alive);
  if (alive.length > 1 && elapsed < ROUND_DRAW_TICK) return;

  // Everything that can throw is computed before any mutation, so a rejected round
  // cannot leave the state half-updated and re-throwing on every later step (#19).
  const winner = alive.length === 1 ? alive[0] : undefined;
  const winnerId = winner?.id;
  const placements = state.roundScored
    ? undefined
    : rankRound(seatedParticipants(state));
  const scores = new Map(
    placements?.map((placement) => [placement.playerId, placement.scoreUnits]),
  );
  const fixedEnd = state.round >= (state.settings?.length ?? 5);
  const ranking = [...state.matchStats.values()]
    .map((entry) => ({
      ...entry,
      matchScoreUnits:
        entry.matchScoreUnits + (scores.get(entry.playerId) ?? 0),
      roundWins: entry.roundWins + (entry.playerId === winnerId ? 1 : 0),
    }))
    .sort(compareMatchScores);
  const champions = fixedEnd
    ? ranking
        .filter((entry) => compareMatchScores(entry, ranking[0]!) === 0)
        .map((entry) => entry.playerId)
    : [];
  const matchWinnerId = champions.length === 1 ? champions[0] : undefined;

  if (winner) winner.roundWins += 1;
  state.roundWinnerId = winnerId;
  if (matchWinnerId !== undefined || fixedEnd)
    state.matchWinnerId = matchWinnerId;
  scoreRoundOnce(state, placements, winnerId, champions);
  events.push(
    winnerId === undefined
      ? { type: "roundEnded" }
      : { type: "roundEnded", winnerId },
  );
  // A round with a highlight pauses longer so every screen can replay it before the next countdown or the recap (ADR 044).
  const pause = roundHasMoment(state) ? REPLAY_PAUSE_TICKS : 0;
  // Nothing in this round can kill any more; bombs still in the air are cleared by the next round's start.
  const inFlight = new Set(
    sortedBombs(state).flatMap((bomb) =>
      bomb.shot === undefined || bomb.shell?.gun ? [] : [bomb.shot],
    ),
  );
  state.decidedRound = decideRound(
    state.matchId,
    state.round,
    state.tick,
    state.shots,
    inFlight,
  );
  state.decidedRound.rating = {
    finishers: [...state.roundParticipants.keys()]
      .filter(
        (id) => state.players.get(id)?.connected && !id.startsWith("bot:"),
      )
      .sort(),
    standings: state.roundPlacements.map((placement) => {
      const identity = state.matchStats.get(placement.playerId)!;
      return { ...placement, slot: identity.slot, color: identity.color };
    }),
  };
  if (matchWinnerId !== undefined || fixedEnd) {
    state.matchFinishers = [...state.players.values()]
      .filter((player) => player.connected && state.matchStats.has(player.id))
      .map((player) => player.id)
      .sort();
    state.phase = "matchOver";
    state.phaseEndsAtTick =
      state.tick + ROUND_OVER_TICKS + pause + MATCH_WINNER_TICKS;
    events.push({
      type: "matchEnded",
      ...(matchWinnerId ? { winnerId: matchWinnerId } : {}),
    });
    return;
  }
  state.phase = "roundOver";
  state.phaseEndsAtTick = state.tick + ROUND_OVER_TICKS + pause;
}

/**
 * The round's riders in seat order, the order `prepareRound` entered them in. `rankRound` lists riders that share a
 * place in the order it is given, and the placements are state peers compare, so that order cannot be left to how a
 * restored Map happened to be built. Nobody is unseated while a round is in play; the id keeps the sort total anyway.
 */
function seatedParticipants(state: GameState): RoundParticipant[] {
  const seats = new Map(
    sortedPlayers(state).map((player, seat) => [player.id, seat]),
  );
  return [...state.roundParticipants.values()].sort(
    (a, b) =>
      (seats.get(a.id) ?? MAX_PLAYERS) - (seats.get(b.id) ?? MAX_PLAYERS) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function scoreRoundOnce(
  state: GameState,
  placements: RoundPlacement[] | undefined,
  winnerId?: PlayerId,
  champions: readonly PlayerId[] = [],
): void {
  if (state.roundScored || !placements) return;
  applyRoundScores(state.leaderboard, placements, winnerId);
  for (const champion of champions) creditMatchWin(state, champion);
  finalizeMatchStatsRound(
    state.matchStats,
    [...state.roundParticipants.keys()],
    winnerId,
    placements,
  );
  state.roundPlacements = placements;
  state.roundScored = true;
}

/** Credit a match win to a leaderboard entry, creating it when the winner sat out this round. */
function creditMatchWin(state: GameState, matchWinnerId: PlayerId): void {
  const entry = state.leaderboard.get(matchWinnerId) ?? {
    id: matchWinnerId,
    name: state.players.get(matchWinnerId)?.name ?? matchWinnerId,
    totalScoreUnits: 0,
    roundsPlayed: 0,
    roundWins: 0,
    matchWins: 0,
  };
  entry.matchWins += 1;
  state.leaderboard.set(entry.id, entry);
}
