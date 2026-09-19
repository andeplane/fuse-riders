import { diceRegistration } from "dice/platform";
import {
  ACCOUNT_RULES,
  fuseRiders,
  type MatchRecord,
  type UserProfile,
} from "fuse-riders-game/platform";
import {
  Platform,
  parseMatchRecord as parsePlatformRecord,
  parseProfile as parsePlatformProfile,
} from "fuse-platform";

/**
 * The service's `platform`: the account rules every game shares and every registered game. Each game owns its
 * registration: Fuse Riders' is `games/fuse-riders/src/platform.ts`, Pig's `games/dice/src/platform.ts`.
 */

/** Every game this repo can serve; Fuse Riders is always served, the others when a service enables them. */
export const GAMES = [fuseRiders, diceRegistration] as const;

/**
 * The games named by `EXTRA_GAME_IDS` (comma-separated), beside Fuse Riders. Cloud Run serves only Fuse Riders until
 * the operator sets it (docs/online/GCP-DEPLOY.md: a second game goes live after the match-record backfill). An id
 * this repo has no registration for is a configuration error, not a game to skip.
 */
export function extraGameIds(value: string | undefined): string[] {
  const ids = [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  for (const id of ids)
    if (id === fuseRiders.id || !GAMES.some((game) => game.id === id))
      throw new Error(
        `EXTRA_GAME_IDS names ${JSON.stringify(id)}, which is not an extra game`,
      );
  return ids;
}
/** Fuse Riders plus the named extra games. The room service is configured with the same ids. */
export const platformFor = (extra: readonly string[]): Platform =>
  new Platform(
    ACCOUNT_RULES,
    GAMES.filter(
      (game) => game.id === fuseRiders.id || extra.includes(game.id),
    ),
  );
/** Every game: what the dev service hosts and what a stored record may name. */
export const platform = platformFor(GAMES.map((game) => game.id));

/** A stored record of any registered game; one without a `gameId` reads as Fuse Riders'. */
export const parseMatchRecord = (raw: unknown): MatchRecord | undefined =>
  parsePlatformRecord(platform, raw) as MatchRecord | undefined;
/** The user document, validated before it can affect Elo or appear on a page. */
export const parseProfile = (data: unknown): UserProfile | undefined =>
  parsePlatformProfile(platform, fuseRiders.id, data) as
    UserProfile | undefined;
