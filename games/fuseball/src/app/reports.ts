import type { MatchResult } from "fuse-platform";
import { isBotId } from "../basics.js";
import type { Room } from "../online/game.js";
import {
  matchResult,
  roundResult,
  type FuseballPlayerResult,
} from "../online/result.js";

/** One result this device owes the room service: the match as a rating receipt, or as the whole match. */
export interface DueReport {
  /** Unique per match and kind, so a report is sent once. */
  key: string;
  path: "round-results" | "results";
  result: MatchResult<FuseballPlayerResult>;
}

/**
 * The reports this device should send now. Every rider still seated at the end reports what its own replica computed,
 * and the service keeps a result once enough of them agree, so only confirmed history goes in: nothing is due until
 * the confirmed game clock (`runtime.confirmedTick()`) reaches the tick the match was decided on, after which no
 * rollback can change it. A Fuseball match is one round, so it is owed twice: as round 1, which the platform rates,
 * and as the whole match, which credits totals. A device that did not finish the match (the shared screen, a watcher,
 * a rider who left, a bot id) owes nothing; `sent` holds the keys already sent.
 */
export function dueReports(
  room: Room,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  const decided = room.decided;
  if (
    !me ||
    isBotId(me) ||
    room.stage !== "over" ||
    !decided ||
    decided.clock > confirmedTick ||
    !decided.finishers.includes(me)
  )
    return [];
  const due: DueReport[] = [];
  const round = roundResult(room),
    match = matchResult(room);
  const roundKey = `${room.matchId}:1`,
    matchKey = `${room.matchId}:match`;
  if (round && !sent.has(roundKey))
    due.push({ key: roundKey, path: "round-results", result: round });
  if (match && !sent.has(matchKey))
    due.push({ key: matchKey, path: "results", result: match });
  return due;
}

export interface ReportTransport {
  fetch: typeof fetch;
  /** The room capability that proves which seat is reporting. */
  roomToken: string;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Best effort: a lost report costs one history entry and never disturbs the game. Every device reports at the same
 * moment and their writes land on one record, so a 503 (a lost race), a 403 (the socket is reconnecting) and a dropped
 * connection are retried; any other refusal is final.
 */
export async function sendReport(
  url: string,
  report: DueReport,
  transport: ReportTransport,
  attempts = 3,
): Promise<"confirmed" | "pending" | "failed"> {
  const wait =
    transport.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await wait(500 * 2 ** attempt);
    try {
      const response = await transport.fetch(url, {
        method: "POST",
        body: JSON.stringify({ result: report.result }),
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${transport.roomToken}`,
        },
      });
      if (response.ok) {
        const body = (await response.json()) as { status?: unknown };
        return body.status === "confirmed" ? "confirmed" : "pending";
      }
      if (response.status !== 403 && response.status < 500) return "failed";
    } catch {
      /* offline or a dropped keepalive: try again */
    }
  }
  return "failed";
}
