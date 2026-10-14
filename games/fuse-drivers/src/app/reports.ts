import type { MatchResult } from "fuse-platform";
import {
  isBotId,
  matchResult,
  roundResult,
  type FuseDriversRoom,
} from "../game/index.js";
import type { FuseDriversStats } from "../platform.js";

/** One result this device owes the room service: a rated round receipt, or the whole match. */
export interface DueReport {
  /** Unique per match and round, so a report is sent once. */
  key: string;
  path: "round-results" | "results";
  result: MatchResult<FuseDriversStats>;
}

/**
 * The reports this device should send now.
 *
 * Every seated human reports what its own replica computed and the service keeps a result once a majority
 * agree, so only confirmed history may go in. A race is one round and the whole match, and the fold stops
 * stepping it once the match is over, so the result is frozen from that tick on; waiting for the confirmed
 * tick to reach the room's own tick is what proves a rollback can no longer change it.
 *
 * A device that did not race (the shared screen, a latecomer, a bot id) owes nothing.
 */
export function dueReports(
  room: FuseDriversRoom,
  me: string,
  confirmedTick: number,
  sent: ReadonlySet<string>,
): DueReport[] {
  if (!me || isBotId(me)) return [];
  if (room.stage !== "over" || confirmedTick < room.tick) return [];
  if (!room.grid.includes(me)) return [];

  const due: DueReport[] = [];
  const round = roundResult(room, room.round);
  const roundKey = `${room.matchId}:${String(room.round)}`;
  if (round && !sent.has(roundKey))
    due.push({ key: roundKey, path: "round-results", result: round });

  const match = matchResult(room);
  const matchKey = room.matchId;
  if (match && !sent.has(matchKey))
    due.push({ key: matchKey, path: "results", result: match });

  return due;
}

export interface SendOptions {
  fetch: typeof globalThis.fetch;
  roomToken?: string;
}

/**
 * Posts one report. Only a refused or failed server is worth retrying: a rejected body is this build's
 * disagreement with the service and retrying it would never start agreeing.
 */
export async function sendReport(
  url: string,
  report: DueReport,
  options: SendOptions,
): Promise<boolean> {
  try {
    const response = await options.fetch(url, {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        ...(options.roomToken
          ? { authorization: `Bearer ${options.roomToken}` }
          : {}),
      },
      body: JSON.stringify(report.result),
    });
    if (response.ok) return true;
    return !(response.status === 403 || response.status >= 500);
  } catch {
    // The network refused it; the caller keeps the report and tries again.
    return false;
  }
}
