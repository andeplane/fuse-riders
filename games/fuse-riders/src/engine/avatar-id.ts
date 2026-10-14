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
  "mushroom",
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
/** The head an AI rider wears, and the one a rider seated with no head at all falls back to. */
export const DEFAULT_AVATAR: AvatarId = "robot";
/**
 * The AI riders' head, and theirs alone. Every AI wears it and they share it (ADR 027), which is exactly why no human
 * may: a room where a person and an AI both wear the robot cannot be read, and that is what happened whenever someone
 * joined before the host added one — the room handed out heads in `AVATAR_IDS` order, the human took the first, and the
 * AI arrived in the same one a moment later. A human is given and allowed the rest (`RIDER_AVATAR_IDS`), and the
 * `mushroom` is what fills the place the robot used to hold in the picker.
 */
export const BOT_AVATAR: AvatarId = "robot";
/** The heads a human rider may be given or choose: every id but the AI's. */
export const RIDER_AVATAR_IDS: readonly AvatarId[] = AVATAR_IDS.filter(
  (id) => id !== BOT_AVATAR,
);
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATAR_IDS.some((id) => id === value);
}
/** Whether a human rider may wear this head: an id, and not the AI's. */
export function isRiderAvatarId(value: unknown): value is AvatarId {
  return isAvatarId(value) && value !== BOT_AVATAR;
}
