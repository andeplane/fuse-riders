import { LEGACY_GAME_ID } from "./game.js";

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
