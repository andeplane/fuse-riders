import type { MatchResult } from "fuse-platform";
import {
  STEPS_PER_TICK,
  matchResult,
  roundResult,
  type KillerFusePlayerResult,
  type Room,
} from "../online/index.js";

/** One result this device owes the room service: a rated round receipt, or the whole match. */
export interface DueReport {
  /** Unique per match and round, so a report is sent once. */
  key: string;
  path: "round-results" | "results";
  result: MatchResult<KillerFusePlayerResult>;
}

/**
 * The reports this device should send now. Every seated human reports what its own replica computed, and the service
 * keeps a result once a majority agree, so only confirmed history goes in: a game once the confirmed tick reaches the
 * tick it was recorded at (a rollback cannot change it after that), and the set once its last game is confirmed.
 * `confirmedTick` is the runtime's, on the game clock: `STEPS_PER_TICK` to a log tick.
 * A device that did not play the game (the shared screen, a watcher, a latecomer) owes nothing, and neither does
 * anyone for a game the platform cannot rate (`roundResult` is undefined when six people played it).
 */
export function dueReports(
  room: Room,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!me) return [];
  const due: DueReport[] = [];
  for (const record of room.results) {
    const key = `${room.matchId}:${record.round}`;
    if (
      sent.has(key) ||
      record.tick * STEPS_PER_TICK > confirmedTick ||
      !record.present.includes(me)
    )
      continue;
    const result = roundResult(room, record.round);
    if (result) due.push({ key, path: "round-results", result });
  }
  const last = room.results.at(-1),
    key = `${room.matchId}:match`;
  if (
    room.stage === "over" &&
    last &&
    last.tick * STEPS_PER_TICK <= confirmedTick &&
    !sent.has(key)
  ) {
    const result = matchResult(room);
    if (result?.finishers.includes(me))
      due.push({ key, path: "results", result });
  }
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
