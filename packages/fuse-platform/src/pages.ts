import type { MatchRecord } from "./result.js";

/** One page of an account's match query, newest first: each document parsed (undefined if unreadable) with its `endedAt`. */
export type HistoryPage = {
  record: MatchRecord | undefined;
  endedAt: unknown;
}[];

/** Pages the legacy game's history query may read to fill one page when other games' matches are interleaved. */
export const LEGACY_HISTORY_PASSES = 5;

/**
 * Fills one history page of `gameId` from a query that may also return other games' records: the legacy game's
 * records from before games carry no gameId, so its query cannot filter on one and keeps its own here. Reads at most
 * `passes` pages, each strictly older than the last document read; an unreadable record is skipped rather than
 * hiding the rest.
 *
 * Known limit: an account with more than about `passes × limit` newer matches of other games gets a short page, which
 * the client reads as the end of its legacy history. Backfilling `gameId` onto legacy records removes the limit and
 * must happen before a second game is live (docs/design/multi-game.md).
 */
export async function collectHistory(
  page: (cursor: number | undefined) => Promise<HistoryPage>,
  gameId: string,
  before: number | undefined,
  limit: number,
  passes = LEGACY_HISTORY_PASSES,
): Promise<MatchRecord[]> {
  const found: MatchRecord[] = [];
  let cursor = before;
  for (let pass = 0; pass < passes; pass++) {
    const docs = await page(cursor);
    for (const { record } of docs)
      if (record?.gameId === gameId) found.push(record);
    const last = docs.at(-1)?.endedAt;
    if (
      found.length >= limit ||
      docs.length < limit ||
      typeof last !== "number"
    )
      break;
    cursor = last;
  }
  return found.slice(0, limit);
}
