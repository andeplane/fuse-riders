/**
 * Fusemania's colours. The accents are fuse-ui's `--fui-cyan`, `--fui-pink` and `--fui-yellow`
 * (`packages/fuse-ui/src/tokens.css`), copied here because a canvas cannot read a CSS custom property without the DOM.
 */
export const BACKGROUND = "#04091a";
export const CYAN = "#16e7ff";
export const PINK = "#ff2e9d";
export const GOLD = "#ffe46b";
export const GREEN = "#4dff7c";
export const VIOLET = "#a47bff";
export const ORANGE = "#ff8a2e";
export const RED = "#ff3b4f";
export const WHITE = "#ffffff";
export const INK = "#030919";
export const TEXT = "#eefaff";
export const MUTED = "#7c93b8";
export const LINE = "#365477";
export const PIXEL_FONT = "'Press Start 2P', ui-monospace, monospace";

/** Each rider slot's accent. */
export const SLOT_COLORS = [CYAN, PINK, GOLD, GREEN, VIOLET] as const;
export const slotColor = (slot: number): string =>
  SLOT_COLORS[
    ((Math.trunc(slot) % SLOT_COLORS.length) + SLOT_COLORS.length) %
      SLOT_COLORS.length
  ]!;

/**
 * A note's colour by where in the beat it falls: 4ths, 8ths, 12ths (triplets), 16ths, finer (24ths and 32nds), and
 * anything off that grid.
 */
export const QUANT_COLORS = [
  "#ff2e6e",
  "#2e9bff",
  "#b45cff",
  "#ffe46b",
  "#4dff7c",
  "#9aa7c7",
] as const;
export const QUANTS = QUANT_COLORS.length;

/** Which of `QUANT_COLORS` a note on `beat` takes. */
export function quantOf(beat: number): number {
  const part = beat - Math.floor(beat);
  const on = (division: number): boolean => {
    const steps = part * division;
    return Math.abs(steps - Math.round(steps)) < 0.02;
  };
  if (on(1)) return 0;
  if (on(2)) return 1;
  if (on(3)) return 2;
  if (on(4)) return 3;
  if (on(6) || on(8)) return 4;
  return 5;
}

/**
 * Each judgment's colour, by its number: Marvelous ice, Perfect gold, Great green, Good blue, Boo magenta, Miss red,
 * a hold kept, one dropped, a mine.
 */
export const JUDGMENT_COLORS = [
  "#bff6ff",
  "#ffe14d",
  "#4dff7c",
  "#3d9dff",
  "#d24dff",
  "#ff3b4f",
  "#7dffd0",
  "#ff3b4f",
  "#ff8a2e",
] as const;
/**
 * A combo's colour, by the worst judgment in it: white while every step was a Marvelous, yellow once a Perfect is in
 * it, green once a Great is. Anything else (no combo, a value this build does not know) is white.
 */
export const COMBO_COLORS = [WHITE, "#ffe14d", "#4dff7c"] as const;
export const comboColor = (worst: number): string =>
  COMBO_COLORS[worst] ?? WHITE;
/** How long one blink of the combo takes, and how far it dims between two. */
export const COMBO_BLINK_MS = 280;
export const COMBO_BLINK_DIM = 0.45;
/** The combo's opacity at `songMs`: full for the first half of each blink, dimmed for the second. */
export const comboBlink = (songMs: number): number =>
  (((songMs % COMBO_BLINK_MS) + COMBO_BLINK_MS) % COMBO_BLINK_MS) * 2 <
  COMBO_BLINK_MS
    ? 1
    : COMBO_BLINK_DIM;
/** What a Marvelous shimmers through. */
export const SHIMMER = ["#ffffff", "#bff6ff", "#ffc8f2", "#fff3a8"] as const;
/** What a starred rider's targets cycle through. */
export const RAINBOW = [0, 3, 4, 1, 2] as const;

/** `#rrggbb` at an opacity, as a CSS colour. */
export function hexA(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
}

const fonts = new Map<number, string>();
/** The pixel font at a size in device pixels (whole pixels; cached, so a frame builds no strings). */
export function pixelFont(size: number): string {
  const px = Math.max(1, Math.round(size));
  let font = fonts.get(px);
  if (!font) {
    font = `${px}px ${PIXEL_FONT}`;
    if (fonts.size < 256) fonts.set(px, font);
  }
  return font;
}

const PLACES = ["1ST", "2ND", "3RD", "4TH", "5TH"] as const;
/** "1ST" for 1, and so on. */
export const placeName = (place: number): string =>
  PLACES[place - 1] ?? `${place}TH`;
