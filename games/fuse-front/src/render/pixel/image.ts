/**
 * The RGBA image every pixel-art function draws into, plus colour parsing and the drawing primitives (pixel with
 * alpha blending, rectangles, ellipses, rings, lines, string-row sprites). Browser-safe: no Node or DOM APIs.
 */

/** Red, green, blue and alpha, each 0–255. */
export type Rgba = readonly [number, number, number, number];
/** A `#rrggbb` string or an explicit RGBA tuple. */
export type Colour = string | Rgba;
/** A sprite palette: one colour per character used in the sprite rows. */
export type SpritePalette = Readonly<Record<string, Colour>>;

const cache = new Map<string, Rgba>();

/** Parses a `#rrggbb` colour (cached) or returns an RGBA tuple unchanged. */
export function rgba(c: Colour): Rgba {
  if (typeof c !== "string") return c;
  let v = cache.get(c);
  if (!v) {
    const h = c.replace("#", "");
    v = [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      255,
    ];
    cache.set(c, v);
  }
  return v;
}

/** The translucent black every ground shadow uses. */
export const SHADOW: Rgba = [0, 0, 0, 85];

export class Img {
  readonly d: Uint8ClampedArray;

  /**
   * A transparent w×h image, or a view over an existing RGBA buffer of exactly w×h×4 bytes (such as a Canvas
   * `ImageData.data`) so drawing lands in it directly.
   */
  constructor(
    readonly w: number,
    readonly h: number,
    data?: Uint8ClampedArray,
  ) {
    if (data && data.length !== w * h * 4)
      throw new RangeError(
        `Img ${w}x${h} needs ${w * h * 4} bytes, got ${data.length}`,
      );
    this.d = data ?? new Uint8ClampedArray(w * h * 4);
  }

  /** Plots one pixel (coordinates are floored), alpha-blending translucent colours. A missing colour draws nothing. */
  px(x: number, y: number, colour: Colour | null | undefined): void {
    if (!colour) return;
    const c = rgba(colour);
    this.over(Math.floor(x), Math.floor(y), c[0], c[1], c[2], c[3]);
  }

  /** Source-over composites one colour onto the pixel at integer (x, y); out of bounds draws nothing. */
  private over(
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
  ): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.d;
    if (alpha >= 255) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      return;
    }
    // Straight (non-premultiplied) alpha, as in Canvas ImageData: over a transparent pixel the colour is the source's.
    const sa = alpha / 255;
    const da = ((d[i + 3] ?? 0) / 255) * (1 - sa);
    const oa = sa + da;
    if (oa <= 0) return;
    d[i] = (r * sa + (d[i] ?? 0) * da) / oa;
    d[i + 1] = (g * sa + (d[i + 1] ?? 0) * da) / oa;
    d[i + 2] = (b * sa + (d[i + 2] ?? 0) * da) / oa;
    d[i + 3] = oa * 255;
  }

  /** A filled w×h rectangle with its top-left at (x, y). */
  rect(x: number, y: number, w: number, h: number, c: Colour): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }

  /** A filled ellipse. */
  ell(cx: number, cy: number, rx: number, ry: number, c: Colour): void {
    for (let y = -Math.ceil(ry); y <= ry; y++)
      for (let x = -Math.ceil(rx); x <= rx; x++)
        if ((x * x) / (rx * rx + 0.01) + (y * y) / (ry * ry + 0.01) <= 1)
          this.px(cx + x, cy + y, c);
  }

  /** An ellipse outline, optionally dashed every `dash` pixels and shifted by `phase` dashes. */
  ring(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: Colour,
    dash = 0,
    phase = 0,
  ): void {
    const m = Math.max(rx, ry);
    const step = 0.4 / m;
    let lastX = NaN;
    let lastY = NaN;
    for (let t = 0; t < Math.PI * 2; t += step) {
      if (dash && Math.floor((t * m) / dash + phase) % 2) continue;
      const x = Math.round(cx + Math.cos(t) * rx);
      const y = Math.round(cy + Math.sin(t) * ry);
      if (x !== lastX || y !== lastY) {
        this.px(x, y, c);
        lastX = x;
        lastY = y;
      }
    }
  }

  /** A Bresenham line between rounded endpoints. */
  line(x0: number, y0: number, x1: number, y1: number, c: Colour): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) {
        e += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        e += dx;
        y0 += sy;
      }
    }
  }

  /** Draws string rows, one character per pixel; `.` and characters missing from the palette are transparent. */
  sprite(
    x: number,
    y: number,
    rows: readonly string[],
    pal: SpritePalette,
    flip = false,
  ): void {
    const w = spriteWidth(rows);
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row.charAt(i);
        if (ch === ".") continue;
        const c = pal[ch];
        if (!c) continue;
        this.px(x + (flip ? w - 1 - i : i), y + j, c);
      }
    });
  }

  /** Composites another image's non-transparent pixels at (x, y). */
  blit(src: Img, x: number, y: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const k = (j * src.w + i) * 4;
        const a = src.d[k + 3] ?? 0;
        if (a)
          this.over(
            x + i,
            y + j,
            src.d[k] ?? 0,
            src.d[k + 1] ?? 0,
            src.d[k + 2] ?? 0,
            a,
          );
      }
  }

  /** The colour at the clamped pixel (x, y), with its alpha forced to 255. */
  sample(x: number, y: number): Rgba {
    x = Math.max(0, Math.min(this.w - 1, Math.floor(x)));
    y = Math.max(0, Math.min(this.h - 1, Math.floor(y)));
    const k = (y * this.w + x) * 4;
    return [this.d[k] ?? 0, this.d[k + 1] ?? 0, this.d[k + 2] ?? 0, 255];
  }
}

/** The width of the widest sprite row. */
export function spriteWidth(rows: readonly string[]): number {
  return Math.max(...rows.map((r) => r.length));
}
