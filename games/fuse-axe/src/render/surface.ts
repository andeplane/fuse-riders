/**
 * The renderer's one surface factory. Everything the renderer pre-paints once (sprites, shadows, the backdrop's static
 * layers) goes into a surface from an injected `MakeSurface`: in the browser a canvas and its 2D context with smoothing
 * off, made at the composition root (`src/app/main.ts`); in tests a typed fake that records what was painted.
 */

/** The part of a 2D context that paints flat pixels. A canvas's context is one, and so is a test's fake. */
export interface PixelPaint {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/** An offscreen surface: the image the renderer draws, and the paint that fills it. */
export interface Surface<Image> {
  readonly image: Image;
  readonly paint: PixelPaint;
  /**
   * Optional fast path for a whole buffer of pixels (`width` × `height` RGBA, rows top to bottom), such as a canvas's
   * `putImageData`. Without it `paintPixels` replays the buffer through `paint`, which draws the same pixels.
   */
  putPixels?(rgba: Uint8ClampedArray<ArrayBuffer>): void;
}

/** Makes a transparent surface `width` × `height` pixels. */
export type MakeSurface<Image> = (
  width: number,
  height: number,
) => Surface<Image>;

const hex = (value: number) => value.toString(16).padStart(2, "0");

/** Paints an RGBA buffer `width` pixels wide: one rectangle per run of a colour along a row, transparent ones skipped. */
export function paintPixels(
  paint: PixelPaint,
  width: number,
  rgba: Uint8ClampedArray,
): void {
  const height = rgba.length / 4 / width;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width;) {
      const at = row + x * 4;
      const [r, g, b, a] = [
        rgba[at]!,
        rgba[at + 1]!,
        rgba[at + 2]!,
        rgba[at + 3]!,
      ];
      let end = x + 1;
      for (let next = at + 4; end < width; end++, next += 4)
        if (
          rgba[next] !== r ||
          rgba[next + 1] !== g ||
          rgba[next + 2] !== b ||
          rgba[next + 3] !== a
        )
          break;
      if (a) {
        paint.fillStyle =
          a === 255
            ? `#${hex(r)}${hex(g)}${hex(b)}`
            : `rgba(${r}, ${g}, ${b}, ${a / 255})`;
        paint.fillRect(x, y, end - x, 1);
      }
      x = end;
    }
  }
}

/** A surface holding an RGBA buffer, through the surface's fast path when it has one. */
export function pixelSurface<Image>(
  make: MakeSurface<Image>,
  width: number,
  height: number,
  rgba: Uint8ClampedArray<ArrayBuffer>,
): Image {
  const surface = make(width, height);
  if (surface.putPixels) surface.putPixels(rgba);
  else paintPixels(surface.paint, width, rgba);
  return surface.image;
}
