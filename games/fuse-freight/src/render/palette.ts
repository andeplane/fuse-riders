/**
 * Each seat's colour, the same five every Fuse game gives P1–P5: cyan, magenta, lime, orange, violet. Loose cargo is
 * wood and brass, so a neutral cart never reads as anyone's.
 */
export const SEAT_COLORS = [
  "#27e3ff",
  "#ff3fb8",
  "#86ff3c",
  "#ffa22b",
  "#b58bff",
] as const;
/** A darker shade of each, for cabs, wagon sides and outlines. */
export const SEAT_SHADES = [
  "#0b7fb8",
  "#a4127a",
  "#3c9d12",
  "#b8580a",
  "#6a3fcc",
] as const;
export const SEAT_NAMES = [
  "CYAN",
  "MAGENTA",
  "LIME",
  "ORANGE",
  "VIOLET",
] as const;

export const seatColor = (slot: number): string =>
  SEAT_COLORS[((slot % 5) + 5) % 5]!;
export const seatShade = (slot: number): string =>
  SEAT_SHADES[((slot % 5) + 5) % 5]!;

/** The depot's own colours. */
export const DEPOT = {
  night: "#070b1c",
  floor: "#1b2436",
  floorLight: "#232e44",
  grout: "#121a29",
  wall: "#2a2530",
  wallTop: "#3a3140",
  brass: "#e0a53c",
  brassDark: "#8a5a1c",
  brassLight: "#ffd77a",
  lamp: "#ffc45a",
  hazard: "#f2b632",
  iron: "#11131c",
  wood: "#8a5a2e",
  woodDark: "#5a3718",
  woodLight: "#c58a4a",
  crate: "#d19a4e",
  crateDark: "#8f5e25",
  steam: "#dfe6f2",
  water: "#0a1630",
} as const;

export function hexA(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
