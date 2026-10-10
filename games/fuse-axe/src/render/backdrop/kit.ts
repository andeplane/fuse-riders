/** The two calls a stage's animated effects make: enough of a 2D context to paint flat pixels. */
export interface Brush {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/**
 * A pixel buffer a static layer is painted into once. Painters work in screen rows, so `y` is the row on the
 * 320 × 180 screen and the buffer holds rows `top` to `top + height − 1`; anything outside it is dropped.
 */
export class Raster {
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;

  constructor(
    readonly width: number,
    readonly top: number,
    readonly height: number,
  ) {
    this.rgba = new Uint8ClampedArray(width * height * 4);
  }

  /** One opaque pixel of colour `0xrrggbb`. */
  px(x: number, y: number, rgb: number): void {
    const row = y - this.top;
    if (x < 0 || x >= this.width || row < 0 || row >= this.height) return;
    const i = (row * this.width + x) * 4;
    this.rgba[i] = rgb >> 16;
    this.rgba[i + 1] = (rgb >> 8) & 255;
    this.rgba[i + 2] = rgb & 255;
    this.rgba[i + 3] = 255;
  }

  rect(x: number, y: number, width: number, height: number, rgb: number) {
    for (let j = y; j < y + height; j++)
      for (let i = x; i < x + width; i++) this.px(i, j, rgb);
  }
}

/** A static layer: painted once at `width` = 320 + how far it scrolls, then blitted at its parallax rate. */
export interface LayerArt {
  /** How far the layer moves per pixel of camera, as `[numerator, denominator]`: 0 stands still, 1 is the floor. */
  readonly rate: readonly [number, number];
  /** The first screen row the layer covers, and how many rows. */
  readonly top: number;
  readonly height: number;
  paint(raster: Raster): void;
}

/** One stage's backdrop: the art itself, kept apart from the machinery that pre-renders and scrolls it. */
export interface StageArt {
  /** Behind the heroes, far to near. */
  readonly back: readonly LayerArt[];
  /** In front of the heroes. */
  readonly front: LayerArt;
  /** Draws what moves (flames, embers) over the back layers; `camX` is the floor's offset, `frame` counts 60 Hz steps. */
  animate(brush: Brush, camX: number, frame: number): void;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The 4 × 4 ordered-dither threshold at a pixel, in (0, 1). */
export const bayer = (x: number, y: number) =>
  (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

/** Picks between neighbouring colours of a ramp at `t` in [0, 1], dithered so bands blend without new colours. */
export function dither(
  ramp: readonly number[],
  t: number,
  x: number,
  y: number,
): number {
  const f = Math.max(0, Math.min(ramp.length - 1.001, t * (ramp.length - 1)));
  const i = Math.floor(f);
  return ramp[i + (f - i > bayer(x, y) ? 1 : 0)]!;
}

/** A cosmetic hash of two integers into [0, 1): the same village on every device, and no Math.random. */
export function hash(a: number, b: number): number {
  let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
