/**
 * Fuse Volley's colours. The side pair is fuse-ui's `--fui-cyan` and `--fui-pink` (`packages/fuse-ui/src/tokens.css`),
 * copied here because a canvas cannot read a CSS custom property without the DOM.
 */
export const SIDE = ["#16e7ff", "#ff2e9d"] as const;
export const SIDE_LIGHT = ["#c4f9ff", "#ffc4e3"] as const;
export const SIDE_DEEP = ["#0a8fb3", "#b3126a"] as const;
export const SIDE_NAMES = ["CYAN", "PINK"] as const;
export const INK = "#030919";
export const NIGHT = "#0b1240";
export const DUSK = "#3a1450";
export const SAND = "#d36aa8";
export const SAND_DEEP = "#5b2a72";
export const BALL = "#ffe46b";
export const BALL_HOT = "#fff8d6";
export const NET = "#9af6ff";
export const WHITE = "#ffffff";
export const PUPIL = "#071022";
export const PIXEL_FONT = "'Press Start 2P', ui-monospace, monospace";

export const sideColor = (side: number): string => SIDE[side === 1 ? 1 : 0];

/** `#rrggbb` at an opacity, as a CSS colour. */
export function hexA(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
}
