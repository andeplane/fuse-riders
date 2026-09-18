import { createHash } from "node:crypto";
import { validCode } from "fuse-network-be";
import {
  LEGACY_GAME_ID,
  type AccountRules,
  type AnyGame,
  type GameRegistration,
  type PlayerResult,
  type Platform,
} from "./game.js";
import { MAX_RATED_PLAYERS, parseRating, type RatingPoint } from "./rating.js";
import { validUid } from "./identity.js";

/** Exactly what every device computes identically. Anything a player can still change on the recap screen stays out, or honest reports would differ. */
export interface MatchResult<P extends PlayerResult = PlayerResult> {
  matchId: string;
  /** Present only for rating receipts; these never credit whole-game career history. */
  round?: number;
  length: number;
  winnerId?: string;
  finishers: string[];
  players: P[];
}
export interface MatchRecord<P extends PlayerResult = PlayerResult> {
  /** The game the match was played in. A stored record without one is a `LEGACY_GAME_ID` match. */
  gameId: string;
  ratingScope?: string;
  ratings?: Record<string, RatingPoint>;
  rivalryPairs?: string[];
  version: 1;
  id: string;
  roomCode: string;
  status: "pending" | "confirmed";
  result: MatchResult<P>;
  /** Peer ids of the players who reported exactly this result. */
  attesters: string[];
  /** Accounts, by the seat each one proved it held. Only a player's own verified sign-in can put it here. */
  uidByPlayer: Record<string, string>;
  /** Cosmetic and self-reported, so outside the agreed result: each player's avatar as that player's own device last saw it. */
  avatars: Record<string, string>;
  /** Accounts of a confirmed match, for the history query. Empty until confirmation. */
  participantUids: string[];
  createdAt: number;
  endedAt?: number;
  /** Absent once a confirmed match belongs to an account: that is the history nothing cleans up. */
  expiresAt?: number;
}

export const MAX_ROUNDS = 99;
export const MAX_MATCH_PARTICIPANTS = 128; // Matches retain past players, like the checkpoint history.

export const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const counterLike = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const count = (value: unknown, most = Number.MAX_SAFE_INTEGER): boolean =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;

/** A seat's peer id, or one of the game's bots. */
export const validPlayerId = (game: AnyGame, id: unknown): id is string =>
  typeof id === "string" && (/^[a-f0-9]{24}$/.test(id) || game.isBot(id));
export const humansOf = (game: AnyGame, result: MatchResult): string[] =>
  result.players
    .map((player) => player.playerId)
    .filter((id) => !game.isBot(id));
/**
 * How many players must agree. A player who quit mid-match is gone before the recap and can never report, so counting
 * them would leave a two-player match with one leaver pending forever. Finishers are frozen at the final tick,
 * not inferred from early-exit eliminations or the live recap roster. Past players can link but cannot supply a deciding vote.
 */
export const attestationsNeeded = (result: MatchResult): number =>
  Math.floor(result.finishers.length / 2) + 1;

/** What the platform requires of every player, after the game has parsed its stats. */
function validPlayer(
  game: AnyGame,
  account: AccountRules,
  player: PlayerResult,
  rounds: number,
): boolean {
  return (
    validPlayerId(game, player.playerId) &&
    // The account name rule: a stored name is one an account could carry.
    account.validName(player.name) &&
    count(player.slot) &&
    count(player.roundsPlayed, rounds) &&
    count(player.roundWins, rounds) &&
    counterLike(player.matchScoreUnits) &&
    count(player.matchPlacement, MAX_MATCH_PARTICIPANTS) &&
    player.matchPlacement >= 1 &&
    count(player.earlyExits)
  );
}

/** Runtime boundary for a reported result and for a stored one: unknown fields are refused, not ignored. */
export function parseMatchResult<P extends PlayerResult>(
  game: GameRegistration<P, object, unknown>,
  account: AccountRules,
  raw: unknown,
): MatchResult<P> | undefined {
  if (
    !plain(raw) ||
    !Object.keys(raw).every((key) =>
      [
        "matchId",
        "round",
        "length",
        "winnerId",
        "finishers",
        "players",
      ].includes(key),
    )
  )
    return;
  const {
    matchId,
    round,
    length,
    winnerId,
    finishers,
    players: rawPlayers,
  } = raw;
  if (
    round !== undefined &&
    (!Number.isSafeInteger(round) ||
      (round as number) < 1 ||
      (round as number) > 1_000_000 ||
      length !== 1)
  )
    return;
  if (typeof matchId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(matchId))
    return;
  if (
    !Number.isSafeInteger(length) ||
    (length as number) < 1 ||
    (length as number) > MAX_ROUNDS
  )
    return;
  if (
    !Array.isArray(rawPlayers) ||
    rawPlayers.length < 1 ||
    rawPlayers.length > MAX_MATCH_PARTICIPANTS ||
    (round !== undefined && rawPlayers.length > MAX_RATED_PLAYERS)
  )
    return;
  const players: P[] = [];
  for (const entry of rawPlayers) {
    const player = game.parseStats(entry, length as number);
    if (!player || !validPlayer(game, account, player, length as number))
      return;
    players.push(player);
  }
  const ids = new Set(players.map((player) => player.playerId));
  if (ids.size !== players.length) return;
  if (game.validField && !game.validField(players)) return;
  if (players.some((player) => player.matchPlacement > players.length)) return;
  if (
    winnerId !== undefined &&
    (typeof winnerId !== "string" || !ids.has(winnerId))
  )
    return;
  if (
    !Array.isArray(finishers) ||
    finishers.length > MAX_RATED_PLAYERS ||
    new Set(finishers).size !== finishers.length ||
    !finishers.every(
      (id) => typeof id === "string" && ids.has(id) && !game.isBot(id),
    )
  )
    return;
  players.sort((a, b) => a.slot - b.slot || (a.playerId < b.playerId ? -1 : 1));
  return {
    matchId,
    ...(round === undefined ? {} : { round: round as number }),
    length: length as number,
    finishers: [...finishers].sort(),
    ...(winnerId === undefined ? {} : { winnerId }),
    players,
  };
}

/** Storage boundary for a match record of any registered game; a record of an unregistered game does not parse. */
export function parseMatchRecord(
  platform: Platform,
  raw: unknown,
): MatchRecord | undefined {
  if (
    !plain(raw) ||
    raw.version !== 1 ||
    typeof raw.id !== "string" ||
    !/^[a-f0-9]{40}$/.test(raw.id) ||
    typeof raw.roomCode !== "string" ||
    !validCode(raw.roomCode)
  )
    return;
  // No backfill: every record from before match records carried a game is the legacy game's.
  const gameId = raw.gameId ?? LEGACY_GAME_ID;
  const game =
    typeof gameId === "string" ? platform.games.get(gameId) : undefined;
  if (!game) return;
  if (raw.status !== "pending" && raw.status !== "confirmed") return;
  const result = parseMatchResult(game, platform.account, raw.result);
  if (
    !result ||
    !counterLike(raw.createdAt) ||
    (raw.endedAt !== undefined && !counterLike(raw.endedAt)) ||
    (raw.expiresAt !== undefined && !counterLike(raw.expiresAt))
  )
    return;
  if ((raw.status === "confirmed") !== (raw.endedAt !== undefined)) return;
  const humans = new Set(humansOf(game, result));
  if (
    !Array.isArray(raw.attesters) ||
    raw.attesters.length > humans.size ||
    !raw.attesters.every((id) => typeof id === "string" && humans.has(id))
  )
    return;
  if (
    !plain(raw.uidByPlayer) ||
    !Object.entries(raw.uidByPlayer).every(
      ([id, uid]) => humans.has(id) && validUid(uid),
    )
  )
    return;
  if (
    !plain(raw.avatars) ||
    !Object.entries(raw.avatars).every(
      ([id, avatar]) => humans.has(id) && platform.account.validAvatar(avatar),
    )
  )
    return;
  if (
    !Array.isArray(raw.participantUids) ||
    raw.participantUids.length > humans.size ||
    !raw.participantUids.every(validUid)
  )
    return;
  if (
    raw.ratingScope !== undefined &&
    (typeof raw.ratingScope !== "string" ||
      !/^[a-f0-9]{40}$/.test(raw.ratingScope))
  )
    return;
  const ratings: Record<string, RatingPoint> = {};
  if (raw.ratings !== undefined) {
    if (!plain(raw.ratings) || Object.keys(raw.ratings).length > humans.size)
      return;
    for (const [id, point] of Object.entries(raw.ratings)) {
      if (!humans.has(id) || !plain(point)) return;
      const parsed = parseRating({
        value: point.after,
        peak: point.after,
        games: 1,
        points: [point],
      });
      if (!parsed || parsed.points[0]!.match !== raw.id) return;
      ratings[id] = parsed.points[0]!;
    }
  }
  if (
    raw.rivalryPairs !== undefined &&
    (!Array.isArray(raw.rivalryPairs) ||
      raw.rivalryPairs.length > 8128 ||
      !raw.rivalryPairs.every(
        (p) => typeof p === "string" && /^[a-f0-9]{24}:[a-f0-9]{24}$/.test(p),
      ))
  )
    return;
  // Rebuilt rather than passed through, so a storage-only field (Firestore's cleanupAt) never rides along into a rewrite.
  return {
    gameId: game.id,
    ...(raw.ratingScope ? { ratingScope: raw.ratingScope as string } : {}),
    ...(raw.ratings ? { ratings } : {}),
    ...(raw.rivalryPairs
      ? { rivalryPairs: [...raw.rivalryPairs] as string[] }
      : {}),
    version: 1,
    id: raw.id,
    roomCode: raw.roomCode,
    status: raw.status,
    result,
    attesters: [...raw.attesters] as string[],
    uidByPlayer: { ...raw.uidByPlayer } as Record<string, string>,
    avatars: { ...raw.avatars } as Record<string, string>,
    participantUids: [...raw.participantUids] as string[],
    createdAt: raw.createdAt,
    ...(raw.endedAt === undefined ? {} : { endedAt: raw.endedAt }),
    ...(raw.expiresAt === undefined ? {} : { expiresAt: raw.expiresAt }),
  };
}

/** Where a record lives: the room's incarnation keeps a reused room code apart, the hash keeps differing results apart. */
export function matchRecordId(
  incarnation: string,
  result: MatchResult,
): string {
  return createHash("sha256")
    .update(JSON.stringify([incarnation, result]))
    .digest("hex")
    .slice(0, 40);
}
