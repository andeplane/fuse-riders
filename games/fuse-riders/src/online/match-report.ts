import type { AvatarId } from "../engine/avatar-id.js";
import { BOT_ID_PREFIX } from "../engine/bot-controller.js";
import {
  beginMatchParticipant,
  snapshotMatchStats,
  type MatchPlayerStats,
  type MatchStatsState,
} from "../engine/match-stats.js";
import { SOLO_RATING_PLAYER_ID } from "fuse-platform/rating";
import type { DecidedRound } from "../engine/shot-log.js";

/**
 * What a device tells the room service when a match ends. The service keeps a result once a majority of its riders
 * sent the same one, so `result` holds only what every device computes identically and what the match froze when it
 * began: nothing local (a clock), nothing the host can still change while the recap is up (the room's settings), and
 * nothing a rider can (their avatar, sent beside it). Devices open the recap at different moments.
 */
export interface MatchReport {
  result: {
    matchId: string;
    round?: number;
    length: number;
    winnerId?: string;
    finishers: string[];
    players: MatchPlayerStats[];
  };
  avatarId?: AvatarId;
}
export interface FinishedMatch {
  matchId: string;
  matchLength: number;
  matchWinnerId?: string;
  matchFinishers?: readonly string[];
  matchStats: readonly MatchPlayerStats[];
  players: ReadonlyArray<{ id: string; avatarId: AvatarId }>;
}

/** Undefined when this device has nothing to report: it did not ride (a TV, a latecomer) or its id is not a room seat. */
export function buildMatchReport(
  match: FinishedMatch,
  riderId: string,
): MatchReport | undefined {
  if (
    !match.matchFinishers ||
    riderId.startsWith(BOT_ID_PREFIX) ||
    !match.matchStats.some((entry) => entry.playerId === riderId)
  )
    return undefined;
  const avatarId = match.players.find(
    (player) => player.id === riderId,
  )?.avatarId;
  return {
    result: {
      matchId: match.matchId,
      length: match.matchLength,
      ...(match.matchWinnerId === undefined
        ? {}
        : { winnerId: match.matchWinnerId }),
      finishers: match.matchFinishers
        .filter((id) => !id.startsWith(BOT_ID_PREFIX))
        .sort(),
      players: match.matchStats.map((entry) => structuredClone(entry)),
    },
    ...(avatarId === undefined ? {} : { avatarId }),
  };
}

/** A confirmed individual round, independent of whole-game participation and career totals. */
export function buildRoundReport(
  decision: DecidedRound | undefined,
  riderId: string,
  confirmedTick: number,
): MatchReport | undefined {
  if (
    !decision?.rating ||
    decision.tick > confirmedTick ||
    riderId.startsWith(BOT_ID_PREFIX) ||
    !decision.rating.standings.some((p) => p.playerId === riderId)
  )
    return;
  const stats: MatchStatsState = new Map();
  for (const p of decision.rating.standings)
    beginMatchParticipant(stats, {
      id: p.playerId,
      name: p.name,
      slot: p.slot,
      color: p.color,
    });
  const players = snapshotMatchStats(stats).map((p) => {
    const standing = decision.rating!.standings.find(
      (s) => s.playerId === p.playerId,
    )!;
    return {
      ...p,
      roundsPlayed: 1,
      matchPlacement: standing.place,
      matchScoreUnits: standing.scoreUnits,
    };
  });
  return {
    result: {
      matchId: decision.matchId,
      round: decision.round,
      length: 1,
      finishers: decision.rating.finishers.map((id) =>
        id === "solo" ? SOLO_RATING_PLAYER_ID : id,
      ),
      players: players.map((p) =>
        p.playerId === "solo" ? { ...p, playerId: SOLO_RATING_PLAYER_ID } : p,
      ),
    },
  };
}

export interface ReportTransport {
  fetch: typeof fetch;
  /** The room capability that proves which seat is reporting. */
  roomToken: string;
  /**
   * This rider's sign-in, or undefined for a guest. A report is sent either way, so friends who are signed in keep
   * theirs. Throwing means "signed in, but the token could not be had just now": round reports wait and retry;
   * career reports can go in unlinked and be resent to link the account.
   */
  identityToken: () => Promise<string | undefined>;
  /** Waits between attempts; injected so tests do not sleep. */
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
}

const ATTEMPTS = 3;
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best effort by design: a lost report costs one history entry and must never disturb the recap the rider is
 * looking at. Both credentials travel as headers, so neither can end up in a URL, a referrer or a server log.
 *
 * Every rider reports in the same instant and their writes land on one record, so the service can answer 503 to
 * the losers of that race. Those, and a dropped connection, are retried with jitter; a refusal (4xx) is final,
 * except 403: a rider whose room socket dropped is not a member until it reconnects a moment later. A signed-in
 * rider whose report went in unlinked is retried too: the sign-in keys were unreachable, not the rider wrong.
 */
export async function sendMatchReport(
  url: string,
  report: MatchReport,
  transport: ReportTransport,
): Promise<"confirmed" | "pending" | "failed"> {
  const wait = transport.wait ?? pause,
    random = transport.random ?? Math.random;
  let outcome: "confirmed" | "pending" | "failed" = "failed";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt) await wait(500 * 2 ** attempt + random() * 1000);
    try {
      let tokenFailed = false;
      const identity = await transport.identityToken().catch(() => {
        tokenFailed = true;
        return undefined;
      });
      if (tokenFailed && report.result.round !== undefined) continue;
      const payload = JSON.stringify(report);
      const response = await transport.fetch(url, {
        method: "POST",
        body: payload,
        keepalive: new TextEncoder().encode(payload).byteLength <= 60_000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${transport.roomToken}`,
          ...(identity ? { "X-Fuse-Identity": identity } : {}),
        },
      });
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 403 &&
        response.status !== 408 &&
        response.status !== 429
      )
        return outcome;
      if (!response.ok) continue;
      const body = (await response.json()) as {
        status?: unknown;
        linked?: unknown;
      };
      outcome = body.status === "confirmed" ? "confirmed" : "pending";
      if (!tokenFailed && (!identity || body.linked === true)) return outcome;
    } catch {
      /* offline or a dropped keepalive: try again */
    }
  }
  return outcome;
}
