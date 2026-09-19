import type { PickupType } from "../engine/game.js";

/** The power-ups' names in ROOM SETTINGS, on the landing page and in a room. */
export const PICKUP_LABELS: Record<PickupType, string> = {
  stopwatch: "Shorter fuse",
  extraBomb: "Extra Bomb",
  power: "Power",
  triple: "Triple shot",
  five: "Five shot",
  gun: "Gun",
  shell: "Shell",
  beer: "Beer",
  ink: "Ink",
  orbitShield: "Shield",
  portal: "Portal",
  star: "Star",
  grip: "Grip",
  range: "Range",
  nitro: "Nitro",
  snail: "Snail",
  gravity: "Gravity",
};
