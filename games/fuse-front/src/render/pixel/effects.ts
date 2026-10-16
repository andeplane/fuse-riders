/** Explosions, smoke, tracers, flames, selection rings and health bars. */
import { type Colour, Img } from "./image.js";
import { hash } from "./noise.js";

/** A rising column of `n` smoke puffs starting at (x, y), jittered by `seed`. */
export function puffs(img: Img, x: number, y: number, n = 4, seed = 1): void {
  for (let i = 0; i < n; i++) {
    const px = x + i * 3 + Math.round(hash(i, 0, seed) * 3);
    const py = y - i * 4;
    const r = 2 + i * 0.9;
    img.ell(px, py, r, r * 0.85, [70, 70, 70, 170 - i * 30]);
    img.ell(px - 1, py - 1, r * 0.5, r * 0.4, [150, 150, 150, 120 - i * 20]);
  }
}

/** A fireball of radius `r` with smoke and sparks. */
export function boom(
  img: Img,
  cx: number,
  cy: number,
  r: number,
  s: number,
): void {
  for (let i = 0; i < 6; i++) {
    const a = hash(i, 1, s) * 6.28;
    const d = r * (0.6 + hash(i, 2, s) * 0.6);
    img.ell(
      cx + Math.cos(a) * d,
      cy + Math.sin(a) * d * 0.7 - r * 0.3,
      r * 0.55,
      r * 0.45,
      [60, 56, 52, 190],
    );
    img.ell(
      cx + Math.cos(a) * d - 1,
      cy + Math.sin(a) * d * 0.7 - r * 0.3 - 1,
      r * 0.25,
      r * 0.2,
      [140, 136, 128, 150],
    );
  }
  for (let y = -Math.ceil(r) - 1; y <= r + 1; y++)
    for (let x = -Math.ceil(r) - 1; x <= r + 1; x++) {
      const d =
        Math.hypot(x, y * 1.2) / r + (hash(cx + x, cy + y, s) - 0.5) * 0.35;
      const c =
        d < 0.3
          ? "#fffbe0"
          : d < 0.55
            ? "#f8d838"
            : d < 0.8
              ? "#f08a20"
              : d < 1.0
                ? "#c43410"
                : null;
      img.px(cx + x, cy + y, c);
    }
  for (let i = 0; i < 10; i++) {
    const a = hash(i, 3, s) * 6.28;
    const d = r * (1.2 + hash(i, 4, s) * 0.9);
    img.px(
      cx + Math.cos(a) * d,
      cy + Math.sin(a) * d * 0.8,
      i % 2 ? "#f8d838" : "#3a2a1a",
    );
  }
}

/** A dashed bullet trail from (x0, y0) to (x1, y1). */
export function tracer(
  img: Img,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: Colour = "#fff4a0",
): void {
  const n = Math.hypot(x1 - x0, y1 - y0);
  for (let i = 0; i < n; i++) {
    if (i % 5 > 2) continue;
    img.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
}

/** A flamethrower cone `len` pixels long pointing right (dir 1) or left (dir -1). */
export function flame(
  img: Img,
  x: number,
  y: number,
  dir: number,
  len: number,
): void {
  for (let i = 0; i < len; i++) {
    const w = 1 + i * 0.35;
    for (let j = -w; j <= w; j++) {
      const d = Math.abs(j) / w;
      const c = d < 0.35 ? "#fffbe0" : d < 0.7 ? "#f8d838" : "#f08a20";
      if (hash(i, j, x) < 0.85) img.px(x + dir * i, y + j, c);
    }
  }
}

/** A selection ellipse with a dark drop line. */
export function selRing(
  img: Img,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c: Colour = "#f8d030",
): void {
  img.ring(cx, cy, rx, ry, "#101010");
  img.ring(cx, cy - 1, rx, ry, c);
}

/** A `w`-pixel bar filled to `frac`. */
export function hpBar(
  img: Img,
  x: number,
  y: number,
  w: number,
  frac: number,
  col: Colour = "#6ad83a",
): void {
  const fill = Math.round(w * Math.min(1, Math.max(0, frac || 0)));
  img.rect(x - 1, y - 1, w + 2, 4, "#101010");
  img.rect(x, y, w, 2, "#3a1010");
  img.rect(x, y, fill, 2, col);
  img.rect(x, y, fill, 1, "#b8ff90");
}
