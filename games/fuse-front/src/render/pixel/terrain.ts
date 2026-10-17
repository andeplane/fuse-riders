/** Ground, plateaus, rivers, bridges, rocks, craters, scorch marks and trees. */
import { Img, SHADOW } from "./image.js";
import { hash, vnoise } from "./noise.js";
import type { Biome, Ramp5 } from "./palette.js";

/** Noisy biome ground with pebbles and specks over the box (x0, y0, w, h), seeded by `s`. */
export function terrain(
  img: Img,
  B: Biome,
  s: number,
  x0 = 0,
  y0 = 0,
  w = img.w,
  h = img.h,
): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const n =
        vnoise(x, y, 26, s) * 0.55 +
        vnoise(x, y, 8, s + 7) * 0.3 +
        hash(x, y, s + 3) * 0.15;
      img.px(x, y, B.base[n < 0.4 ? 0 : n < 0.52 ? 1 : n < 0.63 ? 2 : 3]);
    }
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const r = hash(x, y, s + 11);
      if (r < 0.009) {
        img.px(x, y, B.peb);
        img.px(x - 1, y - 1, B.pebHi);
      } else if (B.speck && r < B.speck.chance) {
        img.px(x, y, B.speck.colour);
        if (B.speck.above) img.px(x, y - 1, B.speck.above);
      }
    }
}

/** A lumpy shaded boulder (or bush) lit from the top left, with an optional drop shadow. */
export function blob(
  img: Img,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  P: Ramp5,
  s: number,
  shadow = true,
  rough = 0.35,
): void {
  if (shadow)
    img.ell(cx + rx * 0.35 + 1, cy + ry * 0.45 + 1, rx, ry * 0.9, SHADOW);
  for (let y = -Math.ceil(ry) - 2; y <= ry + 2; y++)
    for (let x = -Math.ceil(rx) - 2; x <= rx + 2; x++) {
      const nx = x / rx;
      const ny = y / ry;
      const d =
        Math.hypot(nx, ny) + (vnoise(cx + x, cy + y, 3, s) - 0.5) * rough;
      if (d > 1) continue;
      const l =
        -(nx * 0.6 + ny * 0.85) + (hash(cx + x, cy + y, s) - 0.5) * 0.35;
      img.px(
        cx + x,
        cy + y,
        d > 0.86
          ? P[0]
          : l > 0.75
            ? P[4]
            : l > 0.28
              ? P[3]
              : l > -0.25
                ? P[2]
                : P[1],
      );
    }
}

export function crater(
  img: Img,
  B: Biome,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  s: number,
): void {
  for (let y = -ry - 1; y <= ry + 1; y++)
    for (let x = -rx - 1; x <= rx + 1; x++) {
      const nx = x / rx;
      const ny = y / ry;
      const d = Math.hypot(nx, ny) + (hash(cx + x, cy + y, s) - 0.5) * 0.2;
      if (d > 1.15) continue;
      if (d > 0.85) img.px(cx + x, cy + y, ny > 0 ? B.crater[1] : B.crater[0]);
      else img.px(cx + x, cy + y, ny < 0 ? [0, 0, 0, 110] : [0, 0, 0, 50]);
    }
}

export function scorch(
  img: Img,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  s: number,
): void {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      const d =
        Math.hypot(x / rx, y / ry) + (vnoise(cx + x, cy + y, 3, s) - 0.5) * 0.6;
      if (d < 1)
        img.px(cx + x, cy + y, [20, 14, 10, Math.round(150 * (1 - d))]);
    }
}

/**
 * A raised plateau along the top of the image: everything left (or right) of a noisy vertical edge near `edgeX` and
 * above a noisy cliff near `yb`, with a rock cliff face and shadow below it.
 */
export function plateau(
  img: Img,
  B: Biome,
  s: number,
  side: "left" | "right",
  edgeX: number,
  yb: number,
): void {
  const ex = (y: number): number => edgeX + (vnoise(0, y, 9, s) - 0.5) * 16;
  const ey = (x: number): number => yb + (vnoise(x, 0, 11, s + 1) - 0.5) * 10;
  const inside = (x: number, y: number): boolean =>
    (side === "left" ? x < ex(y) : x >= ex(y)) && y < ey(x);
  for (let y = 0; y < yb + 20; y++)
    for (let x = 0; x < img.w; x++) {
      const e = Math.round(ey(x));
      const hin =
        side === "left"
          ? x < ex(Math.min(y, e - 1))
          : x >= ex(Math.min(y, e - 1));
      if (inside(x, y)) {
        img.px(x, y, B.lift);
        if (y === e - 1) img.px(x, y, B.rock[4]);
        continue;
      }
      if (hin && y >= e && y < e + 7) {
        const t = y - e;
        const sh = hash(x >> 1, 0, s);
        img.px(
          x,
          y,
          t === 0
            ? B.rock[3]
            : t === 6
              ? B.rock[0]
              : hash(x, y, s) < 0.06
                ? B.rock[0]
                : sh < 0.35
                  ? B.rock[1]
                  : sh < 0.8
                    ? B.rock[2]
                    : B.rock[3],
        );
        continue;
      }
      if (hin && y >= e + 7 && y < e + 10) {
        img.px(x, y, SHADOW);
        continue;
      }
      const xe = Math.round(ex(y));
      if (
        y < e + 7 &&
        (side === "left" ? x >= xe && x < xe + 3 : x < xe && x >= xe - 3)
      )
        img.px(x, y, side === "left" ? B.rock[1] : B.rock[2]);
    }
}

/** A vertical river `wid` wide whose centre at row y is `cxf(y)`, with banks and a shadow on its left. */
export function river(
  img: Img,
  B: Biome,
  s: number,
  cxf: (y: number) => number,
  wid: number,
  y0 = 0,
  y1 = img.h,
): void {
  for (let y = y0; y < y1; y++) {
    const cx = cxf(y);
    for (let x = Math.floor(cx - wid / 2 - 3); x <= cx + wid / 2 + 3; x++) {
      const dx = Math.abs(x - cx);
      if (dx <= wid / 2) {
        let c = dx < wid / 4 ? B.water[0] : B.water[1];
        if ((x + y * 3) % 9 === 0 && hash(x, y, s) < 0.6) c = B.water[2];
        if ((x + y * 5) % 23 === 0) c = B.water[3];
        if (dx > wid / 2 - 1 && hash(x, y, s + 1) < 0.5) c = B.water[3];
        img.px(x, y, c);
      } else if (dx <= wid / 2 + 2) img.px(x, y, B.bank);
      else if (x < cx && dx <= wid / 2 + 3) img.px(x, y, SHADOW);
    }
  }
}

/** A plank bridge with posts. */
export function bridge(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  img.rect(x + 2, y + h, w, 3, SHADOW);
  for (let i = 0; i < w; i++)
    for (let j = 0; j < h; j++)
      img.px(
        x + i,
        y + j,
        i % 4 === 3
          ? "#3a2410"
          : j === 0
            ? "#b88a58"
            : i % 2
              ? "#7a5030"
              : "#8a6038",
      );
  img.rect(x, y - 1, w, 1, "#2a1a0a");
  img.rect(x, y + h, w, 1, "#2a1a0a");
  for (let i = 0; i < w; i += 6) {
    img.rect(x + i, y - 3, 2, 3, "#2a1a0a");
    img.px(x + i, y - 3, "#a07040");
  }
}

export function tree(
  img: Img,
  cx: number,
  cy: number,
  r: number,
  s: number,
): void {
  img.rect(cx, cy + r - 1, 2, 3, "#3a2a14");
  blob(
    img,
    cx,
    cy,
    r,
    r * 0.85,
    ["#0e200a", "#1a3a14", "#2c5a1e", "#4a8030", "#7ab04a"],
    s,
    true,
    0.5,
  );
}
