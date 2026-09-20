import { userDocumentGame, type Platform } from "./game.js";
import { parseRating } from "./rating.js";
import { counterLike, plain } from "./result.js";
import { ACCOUNT_KEYS, type Account, type Profile } from "./settlement.js";

/**
 * Where an account's standing in a game is stored. The user document holds the shared account for every game, and
 * the legacy game's rating and totals beside it, exactly as before there were games. Every other game keeps one
 * document per account in `${prefix}-ratings`, with this id.
 */
export const ratingDocumentId = (gameId: string, uid: string): string =>
  `${gameId}:${uid}`;

/** The shared account out of a user document. Malformed fields are dropped: the account is cosmetic. */
export function parseAccount(
  platform: Platform,
  data: Record<string, unknown>,
): Account {
  const { validName, validAvatar } = platform.account;
  return {
    ...(validName(data.username) ? { username: data.username } : {}),
    ...(validName(data.name) ? { name: data.name } : {}),
    ...(validAvatar(data.avatarId) ? { avatarId: data.avatarId } : {}),
    updatedAt: counterLike(data.updatedAt) ? data.updatedAt : 0,
  };
}

/**
 * Storage boundary for one account in one game, validated before it can affect Elo or appear on a page. `user` is the
 * user document; `standing` is the game's rating document, and ignored for the legacy game, whose standing is the
 * user document itself. Undefined when neither exists. A stored rating or totals that are present but malformed
 * throw, so a settlement fails rather than overwriting them.
 */
export function parseProfile(
  platform: Platform,
  gameId: string,
  user: unknown,
  standing?: unknown,
): Profile | undefined {
  const game = platform.game(gameId);
  const inline = userDocumentGame(gameId);
  const stored = inline ? user : standing;
  if (!plain(user) && !plain(stored)) return;
  const document = plain(stored) ? stored : {};
  const rating =
    document.rating === undefined ? undefined : parseRating(document.rating);
  const totals = game.parseTotals(document);
  if ((document.rating !== undefined && !rating) || !totals)
    throw new Error("Stored player stats are incompatible");
  return {
    ...parseAccount(platform, plain(user) ? user : {}),
    ...totals,
    ...(rating ? { rating } : {}),
  };
}

/** A profile split for storage: the shared account, and the game's rating and totals. */
export function splitProfile(profile: Profile): {
  account: Account;
  standing: Record<string, unknown>;
} {
  const account: Record<string, unknown> = {},
    standing: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (key === "rank" || value === undefined) continue;
    if ((ACCOUNT_KEYS as readonly string[]).includes(key)) account[key] = value;
    else standing[key] = value;
  }
  return { account: account as unknown as Account, standing };
}

/** The fields the leaderboard and rank queries read, stored beside a rating. */
export const rankFields = (
  profile: Pick<Profile, "rating">,
): { ranked?: boolean; elo?: number } =>
  profile.rating
    ? {
        ranked: profile.rating.games > 0,
        elo: Math.round(profile.rating.value),
      }
    : {};
