// Accepted identity values belong to this game's checkpoint/log contract.
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
export const isAvatar = (value: unknown): value is string =>
  typeof value === "string" && AVATAR_IDS.some((id) => id === value);
