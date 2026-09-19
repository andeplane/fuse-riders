/** Every pickup the game knows, in the one order weights, settings and statistics are read in. */
export const PICKUP_TYPES = [
  "power",
  "extraBomb",
  "stopwatch",
  "gun",
  "shell",
  "star",
  "beer",
  "ink",
  "triple",
  "five",
  "orbitShield",
  "portal",
  "gravity",
  "grip",
  "range",
  "nitro",
  "snail",
] as const;
export type PickupType = (typeof PICKUP_TYPES)[number];
