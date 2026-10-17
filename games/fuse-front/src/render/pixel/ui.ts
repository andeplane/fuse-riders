/** Brushed-steel HUD: panels, bolts, recessed bays, spell icons, the minimap, frame tiles and the chrome logo. */
import { Img } from "./image.js";
import { hash, vnoise } from "./noise.js";
import { GOLD, METAL, TEAM, teamRamp } from "./palette.js";
import { portrait } from "./portraits.js";
import { hpBar } from "./effects.js";
import { shape, sbox } from "./shape.js";
import { tank } from "./units.js";

/** Noisy brushed steel over a box, seeded by `s`. */
export function steelFill(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
  s = 1,
): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const n =
        hash(x + i, y + j, s) * 0.5 +
        vnoise(x + i, y + j, 5, s) * 0.3 +
        hash(0, y + j, s + 2) * 0.2;
      img.px(
        x + i,
        y + j,
        n < 0.38 ? "#585c60" : n < 0.6 ? "#62666a" : "#6c7074",
      );
    }
}

/** A 2×2 rivet head with a one-pixel shadow. */
export function bolt(img: Img, x: number, y: number): void {
  img.px(x, y, "#d8dce0");
  img.px(x + 1, y, "#8a8e92");
  img.px(x, y + 1, "#8a8e92");
  img.px(x + 1, y + 1, "#2a2e32");
  img.px(x + 2, y + 2, [0, 0, 0, 90]);
}

/** A recessed dark slot, lit on its bottom and right edges. */
export function bay(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  img.rect(x, y, w, h, "#101010");
  img.rect(x + 1, y + 1, w - 2, h - 2, "#16181a");
  img.rect(x + 1, y + 1, w - 2, 1, "#26292c");
  img.rect(x + 1, y + 1, 1, h - 2, "#26292c");
  img.rect(x, y + h, w + 1, 1, "#9a9ea2");
  img.rect(x + w, y, 1, h + 1, "#9a9ea2");
}

/** Spell icons are 30×30. */
export const ICON_SIZE = 30;
export type IconDraw = (img: Img, x: number, y: number) => void;

export function iconShockwave(img: Img, x: number, y: number): void {
  img.rect(x, y, 30, 30, "#2a2014");
  for (let j = 0; j < 30; j++)
    for (let i = 0; i < 30; i++)
      if (hash(i, j, 5) < 0.2) img.px(x + i, y + j, "#3a2c1a");
  img.ring(x + 15, y + 20, 13, 6, "#f08a20", 2);
  img.ring(x + 15, y + 20, 9, 4, "#f8d838");
  img.ring(x + 15, y + 20, 5, 2, "#fffbe0");
  sbox(img, x + 10, y + 4, 10, 12, teamRamp(TEAM.red), 2);
  img.rect(x + 12, y + 7, 6, 1, "#6e1410");
  img.rect(x + 12, y + 10, 6, 1, "#6e1410");
  for (const [a, b] of [
    [3, 10],
    [26, 9],
    [6, 4],
    [24, 4],
  ] as const) {
    img.px(x + a, y + b, "#f8d838");
    img.px(x + a, y + b + 1, "#f08a20");
  }
}

export function iconRally(img: Img, x: number, y: number): void {
  img.rect(x, y, 30, 30, "#1a1414");
  shape(
    img,
    (px, py) => {
      const t = (px - x - 5) / 16;
      return t >= 0 && t <= 1 && Math.abs(py - y - 15) <= 3 + t * 8;
    },
    x + 4,
    y + 4,
    x + 22,
    y + 26,
    teamRamp(TEAM.red),
  );
  sbox(img, x + 2, y + 11, 5, 8, METAL, 1);
  img.rect(x + 7, y + 19, 3, 6, "#101010");
  for (const r of [4, 7, 10])
    for (let a = -0.9; a <= 0.9; a += 0.05)
      img.px(
        x + 22 + Math.cos(a) * r,
        y + 15 + Math.sin(a) * r * 1.2,
        r === 7 ? "#f8d838" : "#fff4a0",
      );
}

export function iconIronHide(img: Img, x: number, y: number): void {
  img.rect(x, y, 30, 30, "#141618");
  shape(
    img,
    (px, py) => {
      const dx = Math.abs(px - x - 15);
      const dy = py - y - 3;
      return (
        dy >= 0 && dy <= 24 && dx <= (dy < 12 ? 11 : 11 - (dy - 12) * 0.95)
      );
    },
    x + 2,
    y + 2,
    x + 28,
    y + 28,
    METAL,
    2,
  );
  img.rect(x + 13, y + 6, 4, 18, "#c8301c");
  img.rect(x + 7, y + 11, 16, 4, "#c8301c");
  img.rect(x + 13, y + 6, 1, 18, "#f86a40");
  for (const [a, b] of [
    [7, 6],
    [22, 6],
    [15, 25],
  ] as const)
    bolt(img, x + a, y + b);
}

export function iconOrbital(img: Img, x: number, y: number): void {
  img.rect(x, y, 30, 30, "#10141c");
  for (let i = 0; i < 12; i++)
    img.px(x + hash(i, 1, 3) * 30, y + hash(i, 2, 3) * 14, "#ffffff");
  shape(
    img,
    (px, py) => {
      const dx = Math.abs(px - x - 15);
      const dy = py - y;
      return (
        (dy >= 2 && dy <= 13 && dx <= 3) ||
        (dy > 13 && dy <= 21 && dx <= 21 - dy)
      );
    },
    x + 4,
    y + 1,
    x + 26,
    y + 22,
    GOLD,
  );
  img.ring(x + 15, y + 24, 10, 4, "#f03020", 2);
  tank(img, x + 8, y + 19, "red", { L: 14, W: 10 });
}

/** The four Brick spells in hotkey order (Q, W, E, R). */
export const SPELL_ICONS: readonly IconDraw[] = [
  iconShockwave,
  iconRally,
  iconIronHide,
  iconOrbital,
];

/**
 * A scaled copy of `src` tinted by a 6×3 grid of sector owners (`R`, `B` or neutral), with the sector grid and a white
 * camera box.
 */
export function minimap(
  img: Img,
  src: Img,
  x: number,
  y: number,
  w: number,
  h: number,
  owners: readonly string[] = ["RRRNBB", "RRRBBB", "RRNNBB"],
): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      img.px(x + i, y + j, src.sample((i * src.w) / w, (j * src.h) / h));
      const o = owners[Math.floor((j * 3) / h)]?.charAt(
        Math.floor((i * 6) / w),
      );
      img.px(
        x + i,
        y + j,
        o === "R"
          ? [200, 48, 28, 110]
          : o === "B"
            ? [42, 90, 208, 110]
            : [255, 255, 255, 30],
      );
    }
  for (let k = 1; k < 6; k++)
    for (let j = 0; j < h; j += 2)
      img.px(x + Math.round((k * w) / 6), y + j, [0, 0, 0, 120]);
  for (let k = 1; k < 3; k++)
    for (let i = 0; i < w; i += 2)
      img.px(x + i, y + Math.round((k * h) / 3), [0, 0, 0, 120]);
  img.rect(x + 22, y + 14, 18, 1, "#ffffff");
  img.rect(x + 22, y + 26, 18, 1, "#ffffff");
  img.rect(x + 22, y + 14, 1, 13, "#ffffff");
  img.rect(x + 39, y + 14, 1, 13, "#ffffff");
}

/** The 480×58 bottom HUD strip: portrait, bars, four spell slots (W cooling down, R gold), info bay and minimap of `field`. */
export function hudBottom(field: Img): Img {
  const img = new Img(480, 58);
  steelFill(img, 0, 0, 480, 58, 3);
  img.rect(0, 0, 480, 1, "#101010");
  img.rect(0, 1, 480, 1, "#b0b4b8");
  img.rect(0, 57, 480, 1, "#101010");
  for (const sx of [150, 302, 392]) {
    img.rect(sx, 2, 1, 55, "#2a2e32");
    img.rect(sx + 1, 2, 1, 55, "#9a9ea2");
  }
  for (const sx of [3, 146, 154, 298, 306, 388, 396, 475]) {
    bolt(img, sx, 4);
    bolt(img, sx, 52);
  }
  bay(img, 5, 5, 46, 48);
  portrait(img, 6, 6, "brick", "red");
  bay(img, 55, 5, 90, 48);
  hpBar(img, 70, 29, 70, 0.72);
  hpBar(img, 70, 38, 70, 0.55, "#4fb6e8");
  hpBar(img, 70, 47, 70, 0.38, "#f8d030");
  SPELL_ICONS.forEach((f, i) => {
    const bx = 158 + i * 35;
    bay(img, bx, 9, 32, 32);
    f(img, bx + 1, 10);
  });
  // Cooldown shade on W.
  img.rect(194, 10, 30, 30, [0, 0, 0, 150]);
  img.rect(194, 10, 30, 12, [0, 0, 0, 60]);
  // Gold frame on the ultimate.
  img.rect(262, 8, 34, 1, "#f8d030");
  img.rect(262, 42, 34, 1, "#f8d030");
  img.rect(262, 8, 1, 35, "#f8d030");
  img.rect(295, 8, 1, 35, "#f8d030");
  bay(img, 310, 5, 76, 48);
  bay(img, 398, 4, 78, 50);
  minimap(img, field, 399, 5, 76, 48);
  return img;
}

// prettier-ignore
const GLYPH: Readonly<Record<string, readonly string[]>> = {
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};
// prettier-ignore
const LOGO_BAND = ["#ffffff", "#ffffff", "#f0f6ff", "#d8e8f8", "#c4d8f0", "#acc4e4", "#94b0d8", "#7c98c4", "#5a7098",
  "#2a3450", "#2a3450", "#c86a20", "#e08830", "#f0a040", "#f8b850", "#fcc860", "#ffd878", "#ffe090", "#ffe8a8",
  "#fff0c0", "#fff8d8"];

/**
 * Chrome-and-gold block lettering with a dark drop shadow, for the letters of "FUSE FRONT" and spaces; other
 * characters are skipped (their advance is kept).
 */
export function logo(text: string): Img {
  const S = 3;
  const gw = 5 * S;
  const gap = 3;
  const sp = 8;
  let w = 8;
  for (const ch of text) w += ch === " " ? sp : gw + gap;
  const h = 7 * S + 8;
  const img = new Img(w, h);
  const mask = new Uint8Array(w * h);
  let cx = 3;
  for (const ch of text) {
    if (ch === " ") {
      cx += sp;
      continue;
    }
    GLYPH[ch]?.forEach((row, j) => {
      for (let i = 0; i < 5; i++)
        if (row.charAt(i) === "1")
          for (let a = 0; a < S; a++)
            for (let b = 0; b < S; b++)
              mask[(2 + j * S + b) * w + cx + i * S + a] = 1;
    });
    cx += gw + gap;
  }
  const M = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let d = 1; d <= 3; d++)
        if (M(x - d, y - d) && !M(x, y)) {
          img.px(x, y, d === 3 ? "#101010" : "#3a1c0c");
          break;
        }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (
        !M(x, y) &&
        (M(x - 1, y) ||
          M(x + 1, y) ||
          M(x, y - 1) ||
          M(x, y + 1) ||
          M(x - 1, y - 1) ||
          M(x + 1, y + 1) ||
          M(x + 1, y - 1) ||
          M(x - 1, y + 1))
      )
        img.px(x, y, "#101010");
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (M(x, y)) {
        const c = LOGO_BAND[Math.min(LOGO_BAND.length - 1, y - 2)];
        img.px(
          x,
          y,
          (!M(x - 1, y) || !M(x, y - 1)) && y - 2 > 10 ? "#fff8e0" : c,
        );
      }
  return img;
}

export type FrameKind = "steel" | "lit" | "gold" | "bay";
export const FRAME_KINDS: readonly FrameKind[] = [
  "steel",
  "lit",
  "gold",
  "bay",
];
/** Frame tiles are 12×12 nine-slice sources: 1px outline, 1px bevel, flat centre. */
export const FRAME_SIZE = 12;

const FRAME_RAMP: Readonly<
  Record<FrameKind, readonly [string, string, string, string]>
> = {
  steel: ["#101010", "#b4b8bc", "#3a3e42", "#6a6e72"],
  lit: ["#101010", "#ff9a70", "#6e1410", "#c8301c"],
  gold: ["#101010", "#fff4b0", "#8a5a10", "#e0b020"],
  bay: ["#101010", "#24272a", "#9a9ea2", "#16181a"],
};

/** A 12×12 UI frame tile; the steel one has corner rivets. */
export function frame(kind: FrameKind): Img {
  const img = new Img(12, 12);
  const [out, hi, lo, fill] = FRAME_RAMP[kind];
  img.rect(0, 0, 12, 12, fill);
  img.rect(1, 1, 10, 1, hi);
  img.rect(1, 1, 1, 10, hi);
  img.rect(1, 10, 10, 1, lo);
  img.rect(10, 1, 1, 10, lo);
  img.rect(0, 0, 12, 1, out);
  img.rect(0, 11, 12, 1, out);
  img.rect(0, 0, 1, 12, out);
  img.rect(11, 0, 1, 12, out);
  if (kind === "steel")
    for (const [a, b] of [
      [2, 2],
      [8, 2],
      [2, 8],
      [8, 8],
    ] as const) {
      img.px(a, b, "#e0e4e8");
      img.px(a + 1, b, "#8a8e92");
      img.px(a, b + 1, "#8a8e92");
      img.px(a + 1, b + 1, "#2a2e32");
    }
  return img;
}

/** A 16×16 tileable brushed-steel panel. */
export function steelTile(): Img {
  const img = new Img(16, 16);
  steelFill(img, 0, 0, 16, 16, 8);
  return img;
}
