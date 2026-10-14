/** Each seat's colour, as in the concept art: cyan, magenta, lime, orange, violet. */
export const SEAT_COLORS = [
  "#27e3ff",
  "#ff3fb8",
  "#86ff3c",
  "#ffa22b",
  "#b58bff",
] as const;
/** A darker shade of each, for helmets, tails and outlines. */
export const SEAT_SHADES = [
  "#0b7fb8",
  "#a4127a",
  "#3c9d12",
  "#b8580a",
  "#6a3fcc",
] as const;

export const seatColor = (slot: number): string =>
  SEAT_COLORS[((slot % 5) + 5) % 5]!;
export const seatShade = (slot: number): string =>
  SEAT_SHADES[((slot % 5) + 5) % 5]!;

export const PICKUP_COLORS = {
  shield: "#3fa8ff",
  triple: "#ffd23f",
  shock: "#c06bff",
  turbo: "#5dff8a",
  scramble: "#ff5fc8",
} as const;

export const PICKUP_LABELS = {
  shield: "SHIELD",
  triple: "TRIPLE SHOT",
  shock: "SHOCKWAVE",
  turbo: "TURBO",
  scramble: "SCRAMBLE",
} as const;
