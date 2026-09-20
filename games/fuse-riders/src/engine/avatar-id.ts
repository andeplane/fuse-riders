/**
 * The avatar identities the simulation validates: which ids exist, which one a rider joins with, and whether a value
 * is one of them. The input log folds an avatar entry only when `isAvatarId` accepts it and the checkpoint guard
 * refuses a state carrying anything else, so the vocabulary is the engine's own — the same call as `rider-name.ts`,
 * where the log and the checkpoint guard apply the rule and therefore own it.
 *
 * How an avatar is labelled and drawn is not the engine's: `games/fuse-riders/src/shared/avatars.ts` keeps the labels
 * and the sprite-sheet cells, and takes its order from `AVATAR_IDS` so the atlas cannot drift from this list.
 */
export const AVATAR_IDS = [
  "robot",
  "cat",
  "fox",
  "alien",
  "astronaut",
  "skull",
  "octopus",
  "dragon",
  "owl",
  "slime",
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
export const DEFAULT_AVATAR: AvatarId = "robot";
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATAR_IDS.some((id) => id === value);
}
