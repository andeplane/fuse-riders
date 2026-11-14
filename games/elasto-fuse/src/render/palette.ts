/**
 * Elasto Fuse's colours. The accents are fuse-ui's `--fui-cyan`, `--fui-pink` and `--fui-yellow`
 * (`packages/fuse-ui/src/tokens.css`), copied here because a canvas cannot read a CSS custom property without the DOM.
 */
export const CYAN = "#16e7ff";
export const PINK = "#ff2e9d";
export const GOLD = "#ffe46b";
export const WHITE = "#ffffff";
export const INK = "#030919";
export const GROUND = "#070d26";
export const GROUND_TRACE = "#12306a";
export const GRAPHITE = "#141b33";
export const GRAPHITE_LIGHT = "#2a3558";
export const DUSK_TOP = "#050a24";
export const DUSK_MID = "#2a1458";
export const DUSK_LOW = "#7a1f6e";
export const HORIZON = "#ff7a59";
export const PIXEL_FONT = "'Press Start 2P', ui-monospace, monospace";

/** Each roster slot's hue in degrees: cyan, pink, gold, green, violet. */
export const SLOT_HUES = [187, 327, 49, 135, 265] as const;
/** The hue the sprites are painted in; a slot's sprites are turned from here to its own. */
export const SPRITE_HUE = SLOT_HUES[0];
export const SLOT_COLORS = [CYAN, PINK, GOLD, "#4dff7c", "#a47bff"] as const;
export const SLOT_NAMES = ["CYAN", "PINK", "GOLD", "GREEN", "VIOLET"] as const;

const slotIndex = (slot: number): number =>
  ((Math.trunc(slot) % SLOT_COLORS.length) + SLOT_COLORS.length) %
  SLOT_COLORS.length;
export const slotColor = (slot: number): string =>
  SLOT_COLORS[slotIndex(slot)]!;
export const slotName = (slot: number): string => SLOT_NAMES[slotIndex(slot)]!;
/** How far a slot's sprites are turned from the painted cyan, in degrees. */
export const slotHueShift = (slot: number): number =>
  (SLOT_HUES[slotIndex(slot)]! - SPRITE_HUE + 360) % 360;

/** `#rrggbb` at an opacity, as a CSS colour. */
export function hexA(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
}
