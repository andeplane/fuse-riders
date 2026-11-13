/**
 * Fuseball's colours. The team pair is fuse-ui's `--fui-cyan` and `--fui-pink` (`packages/fuse-ui/src/tokens.css`),
 * copied here because a canvas cannot read a CSS custom property without the DOM; the rest are the canvas's own.
 */
export const TEAM = ["#16e7ff", "#ff2e9d"] as const;
/** A lighter, a deeper and a near-black shade of each team colour: highlights, shading and outlines. */
export const TEAM_LIGHT = ["#c4f9ff", "#ffc4e3"] as const;
export const TEAM_DEEP = ["#0a8fb3", "#b3126a"] as const;
export const TEAM_DARK = ["#075a73", "#7a1050"] as const;
export const TEAM_NAMES = ["CYAN", "MAGENTA"] as const;

/** `--fui-ink`, the page behind everything. */
export const INK = "#030919";
export const NIGHT = "#081430";
export const GRID = "#16264d";
export const SOLID = "#141f4f";
export const SOLID_DARK = "#0b1335";
/** The arena's own neon: violet, so it never reads as either team. */
export const EDGE = "#9a86ff";
export const EDGE_DIM = "#4a3fa8";
/** `--fui-yellow`: the ball and its sparks. */
export const BALL = "#ffe46b";
export const BALL_HOT = "#fff8d6";
export const CLOUD = "#aab4ff";
export const WHITE = "#ffffff";
export const VISOR = "#061023";

export const PIXEL_FONT = "'Press Start 2P', ui-monospace, monospace";

export const teamColor = (slot: number): string => TEAM[slot === 1 ? 1 : 0];

/** `#rrggbb` at an opacity, as a CSS colour. */
export function hexA(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
}
export const teamLight = (slot: number): string =>
  TEAM_LIGHT[slot === 1 ? 1 : 0];
