/**
 * The avatar identities the simulation validates: which ids exist, in which order, and whether a value is one of
 * them. The input log folds an avatar entry only when `isAvatarId` accepts it, the checkpoint guard refuses a state
 * carrying anything else, and `repairedAvatar` seats a rider whose head is taken in the next free one *in this
 * order* — so the list is a rule, the same call as `rider-name.ts`, where the log and the checkpoint guard apply the
 * rule and therefore own it. Reordering it changes what a room seats and needs a `RULES` bump.
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
/** The head an AI rider wears, and the one a rider seated with no head at all falls back to. */
export const DEFAULT_AVATAR: AvatarId = "robot";
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATAR_IDS.some((id) => id === value);
}
