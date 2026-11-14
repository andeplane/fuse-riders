/**
 * The displacement map behind the CRT's optional curvature. `feDisplacementMap` moves each
 * output pixel by `scale * (channel - 0.5)`, red for x and green for y, so a map whose red
 * grows with the horizontal distance from the centre (times the squared radius) and whose
 * green does the same vertically makes the picture bulge like a tube: edges are pushed out
 * and the corners sample past the picture, which rounds them off into the black bezel.
 */
export const CURVATURE_MAP_SIZE = 64;

/** Displacement in filter pixels at the corners; subtle, so text stays readable. */
export const CURVATURE_SCALE = 36;

/** The RGBA bytes of a `size` by `size` map, row-major, each pixel opaque. */
export function curvatureMapPixels(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    const ny = ((row + 0.5) / size) * 2 - 1;
    for (let column = 0; column < size; column += 1) {
      const nx = ((column + 0.5) / size) * 2 - 1;
      const radius2 = nx * nx + ny * ny;
      // r² reaches 2 at the corners, so dividing by 2 keeps the offset within [-1, 1].
      const dx = (nx * radius2) / 2;
      const dy = (ny * radius2) / 2;
      const offset = (row * size + column) * 4;
      pixels[offset] = Math.round(128 + dx * 127);
      pixels[offset + 1] = Math.round(128 + dy * 127);
      pixels[offset + 2] = 128;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

/** The slice of a 2D canvas the map needs, so a test can hand in a fake. */
export type MapCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): MapCanvasContext | null;
  toDataURL(): string;
};

export type MapCanvasContext = {
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
};

/**
 * The map as a data URL for `feImage`, drawn on a canvas; undefined when the canvas cannot
 * draw (no 2D context, as in tests or a locked-down browser), in which case there is no curvature.
 */
export function curvatureMapDataUrl(
  createCanvas: () => MapCanvas,
  size = CURVATURE_MAP_SIZE,
): string | undefined {
  const canvas = createCanvas();
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const image = context.createImageData(size, size);
  image.data.set(curvatureMapPixels(size));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
