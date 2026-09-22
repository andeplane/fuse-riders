import { LEGACY_GAME_ID } from "./game.js";
import { counterLike, plain } from "./result.js";

/** A stored match record as a backfill sees it: its document id and raw fields. */
export interface StoredMatch {
  id: string;
  data: Record<string, unknown>;
}

/**
 * The match records of one page that predate games: no `gameId` field. Each reads as the legacy game's already, so
 * writing `gameId: LEGACY_GAME_ID` onto them changes no meaning; it only lets the legacy game's history query filter
 * on the field like every other game. A record with any `gameId`, valid or not, is left for its reader to judge.
 */
export function legacyMatchIds(page: readonly StoredMatch[]): string[] {
  return page.filter((match) => !("gameId" in match.data)).map((m) => m.id);
}

/** The field a backfill writes onto each of `legacyMatchIds`. */
export const LEGACY_GAME_FIELD = { gameId: LEGACY_GAME_ID } as const;

/** One record the feed backfill stamps, and the `feedAt` to write onto it. */
export interface FeedStamp {
  id: string;
  feedAt: number;
}

/**
 * The records of one page that earned a place in the public feed but predate the field that carries it: games
 * confirmed before `feedAt` existed. They are invisible in EVERYONE and visible in YOURS, because the feed query
 * orders by `feedAt` while a player's own history orders by `endedAt` — and Firestore returns no document that
 * lacks the field it is asked to order by, so the page comes back empty rather than failing.
 *
 * The predicate is confirmation's own, unchanged (`GameHistory.submit` in `history.ts`): a confirmed whole game,
 * never a round receipt, that an account owns a seat in or that two riders attested. `feedAt` is stamped from
 * `endedAt`, exactly as confirmation stamps it, so a backfilled row sorts and pages like one confirmed today and
 * is still dated by when the game ended. A record that already carries any `feedAt`, valid or not, is left for its
 * reader to judge, which also makes the backfill safe to repeat.
 *
 * A record from before games carry a `gameId` needs `legacyMatchIds` too: the feed filters on `gameId` first.
 */
export function feedlessMatchStamps(page: readonly StoredMatch[]): FeedStamp[] {
  return page.flatMap(({ id, data }) => {
    if ("feedAt" in data || data.status !== "confirmed") return [];
    // The parser holds confirmed and `endedAt` to each other, so a confirmed record without one is unreadable
    // anyway; stamping it would only invent a feed position for a row no reader accepts.
    if (!counterLike(data.endedAt)) return [];
    if (!plain(data.result) || data.result.round !== undefined) return [];
    const accounts = plain(data.uidByPlayer)
      ? Object.keys(data.uidByPlayer).length
      : 0;
    const attesters = Array.isArray(data.attesters) ? data.attesters.length : 0;
    if (accounts === 0 && attesters < 2) return [];
    return [{ id, feedAt: data.endedAt }];
  });
}
