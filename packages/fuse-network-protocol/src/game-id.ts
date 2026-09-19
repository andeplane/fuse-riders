/**
 * Which game a room serves. One room service hosts every game, and a room code means one game at a time: a room is
 * created for a game, and a member asking for another game is refused.
 */
export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const validGameId = (value: unknown): value is string =>
  typeof value === "string" && GAME_ID_PATTERN.test(value);
/**
 * The game of a room created or joined without a `gameId`. Every client from before rooms carried a game was a Fuse
 * Riders client, so an absent `gameId` means this one, in both directions of the rollout.
 */
export const LEGACY_GAME_ID = "fuse-riders";
