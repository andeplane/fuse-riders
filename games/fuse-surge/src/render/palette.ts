/**
 * Fuse Surge's colours. The first four lane colours are fuse-ui's cyan, pink, yellow and lime
 * (`packages/fuse-ui/src/tokens.css`), copied here because a canvas cannot read a CSS custom property without the DOM.
 */
export const LANE = [
  "#16e7ff",
  "#ff2e9d",
  "#ffe46b",
  "#b6ff4d",
  "#ff9a4a",
] as const;
export const LANE_LIGHT = [
  "#c4f9ff",
  "#ffc4e3",
  "#fff6c9",
  "#e6ffc2",
  "#ffd9bd",
] as const;
export const LANE_DEEP = [
  "#0a7f9c",
  "#a3175f",
  "#a8902c",
  "#5f9418",
  "#a8501c",
] as const;
export const LANE_NAMES = ["CYAN", "PINK", "GOLD", "LIME", "AMBER"] as const;
export const INK = "#030919";
export const NIGHT = "#060d2b";
export const DECK = "#0d1b45";
export const DECK_LINE = "#2b4a8c";
export const DECK_FACE = "#081233";
/** A low surge (jump it) and a high one (duck it). */
export const SURGE_LOW = "#ff5b4a";
export const SURGE_HIGH = "#a98bff";
export const SURGE_CORE = "#fff6ea";
export const PIT = "#ff2e9d";
export const PIT_DEEP = "#3b0f6b";
export const GATE = "#7df2c8";
export const DANGER = "#ff4d5e";
export const WHITE = "#ffffff";
export const TEXT = "#eefaff";
export const TEXT_DIM = "#7c93b8";
export const PIXEL_FONT = "'Press Start 2P', ui-monospace, monospace";

export const laneColor = (slot: number): string => LANE[slot % LANE.length]!;
export const laneLight = (slot: number): string =>
  LANE_LIGHT[slot % LANE_LIGHT.length]!;
export const laneDeep = (slot: number): string =>
  LANE_DEEP[slot % LANE_DEEP.length]!;
export const laneName = (slot: number): string =>
  LANE_NAMES[slot % LANE_NAMES.length]!;

/** `#rrggbb` at an opacity, as a CSS colour. */
export function hexA(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
}
