import type { MatchResult } from "fuse-platform";
import {
  isBotId,
  matchResult,
  type FuseLanePlayerResult,
  type FuseLaneRoom,
} from "../game/index.js";

/** The one result this device owes the room service: the whole match. */
export interface DueReport {
  /** Unique per match, so a report is sent once. */
  key: string;
  path: "results";
  result: MatchResult<FuseLanePlayerResult>;
}

/**
 * The reports this device should send now. Every seated human reports what its own replica computed, and the service
 * keeps a result once a majority agree, so only confirmed history goes in: the match once the confirmed tick reaches
 * the tick it ended at (`phaseEnd` once it is over), when no rollback can change it. A device that did not finish the
 * match (the shared screen, a latecomer, a bot id) owes nothing.
 */
export function dueReports(
  room: FuseLaneRoom,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!me || isBotId(me) || room.stage !== "over") return [];
  const key = `${room.matchId}:match`;
  if (sent.has(key) || room.phaseEnd > confirmedTick) return [];
  const result = matchResult(room);
  return result?.finishers.includes(me)
    ? [{ key, path: "results", result }]
    : [];
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
