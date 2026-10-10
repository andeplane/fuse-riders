import { OUTLINE, type Palette } from "./palette.js";

/**
 * A palette-indexed sprite: one string per row, one character per pixel, `.` transparent. `(ax, ay)` is the feet
 * anchor, the pixel that sits on the entity's floor position. Sprites face right; `flipSprite` turns them left.
 */
export interface Sprite {
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
  readonly palette: Palette;
  readonly rows: readonly string[];
}

export const CLEAR = ".";
const HEX = /^#[0-9a-f]{6}$/i;

/** Throws if the rows do not match the size, use a key the palette lacks, or the anchor is not a pixel of the sprite. */
export function validateSprite(sprite: Sprite): void {
  const { w, h, ax, ay, palette, rows } = sprite;
  const problems: string[] = [];
  if (rows.length !== h) problems.push(`${rows.length} rows for height ${h}`);
  rows.forEach((row, y) => {
    if (row.length !== w)
      problems.push(`row ${y} is ${row.length} wide, not ${w}`);
    for (const key of row)
      if (key !== CLEAR && !Object.hasOwn(palette, key))
        problems.push(`row ${y} uses ${key}, which the palette lacks`);
  });
  for (const [key, color] of Object.entries(palette))
    if (key.length !== 1 || key === CLEAR || !HEX.test(color))
      problems.push(`palette entry ${key}: ${color}`);
  if (!(ax >= 0 && ax < w && ay >= 0 && ay < h))
    problems.push(`anchor (${ax}, ${ay}) lies outside`);
  else if (!Number.isInteger(ax) || !Number.isInteger(ay))
    problems.push(`anchor (${ax}, ${ay}) is not on a pixel`);
  if (problems.length)
    throw new Error(`Invalid sprite: ${problems.join("; ")}`);
}

/** The sprite with some of its colours overridden; keys it does not use are ignored. */
export function swapPalette(sprite: Sprite, swap: Palette): Sprite {
  const palette = Object.fromEntries(
    Object.entries(sprite.palette).map(([key, color]) => [
      key,
      swap[key] ?? color,
    ]),
  );
  return { ...sprite, palette };
}

/** The sprite mirrored to face left, about its anchor: the feet stay on the same pixel. */
export function flipSprite(sprite: Sprite): Sprite {
  const rows = sprite.rows.map((row) => [...row].reverse().join(""));
  return { ...sprite, ax: sprite.w - 1 - sprite.ax, rows };
}

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (channels: number[]) =>
  "#" +
  channels.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const FLASH_TINT = [255, 120, 130];

/** The damage flash: every colour pushed toward hot pink, the outline toward a deep wine. */
export function flashPalette(palette: Palette): Palette {
  return Object.fromEntries(
    Object.entries(palette).map(([key, color]) => [
      key,
      key === OUTLINE
        ? "#3a0f24"
        : toHex(rgb(color).map((v, i) => v * 0.55 + FLASH_TINT[i]! * 0.45)),
    ]),
  );
}

/** The sprite trimmed to its opaque pixels, the anchor kept on the same pixel. */
export function cropSprite(sprite: Sprite): Sprite {
  const { rows } = sprite;
  let [x0, x1, y0, y1] = [sprite.w, -1, sprite.h, -1];
  rows.forEach((row, y) => {
    const left = row.search(/[^.]/);
    if (left < 0) return;
    [x0, x1] = [Math.min(x0, left), Math.max(x1, row.search(/[^.]\.*$/))];
    [y0, y1] = [Math.min(y0, y), y];
  });
  if (y1 < 0) return sprite;
  return {
    ...sprite,
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
    ax: sprite.ax - x0,
    ay: sprite.ay - y0,
    rows: rows.slice(y0, y1 + 1).map((row) => row.slice(x0, x1 + 1)),
  };
}
