import type { MapCanvas, MapCanvasContext } from "./curvatureMap";
import {
  CURVATURE_MAP_SIZE,
  curvatureMapDataUrl,
  curvatureMapPixels,
} from "./curvatureMap";

function pixel(
  pixels: Uint8ClampedArray,
  size: number,
  column: number,
  row: number,
): [number, number, number, number] {
  const offset = (row * size + column) * 4;
  return [
    pixels[offset] ?? -1,
    pixels[offset + 1] ?? -1,
    pixels[offset + 2] ?? -1,
    pixels[offset + 3] ?? -1,
  ];
}

describe("curvature map", () => {
  it("leaves the centre in place and pushes the corners outward, opaque throughout", () => {
    // An odd size has a pixel exactly on the centre and on each axis.
    const size = 9;
    const pixels = curvatureMapPixels(size);
    expect(pixels).toHaveLength(size * size * 4);
    const [cr, cg, cb, ca] = pixel(pixels, size, 4, 4);
    expect(Math.abs(cr - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(cg - 128)).toBeLessThanOrEqual(2);
    expect(cb).toBe(128);
    expect(ca).toBe(255);
    const [tlr, tlg] = pixel(pixels, size, 0, 0);
    expect(tlr).toBeLessThan(64);
    expect(tlg).toBeLessThan(64);
    const [brr, brg] = pixel(pixels, size, size - 1, size - 1);
    expect(brr).toBeGreaterThan(192);
    expect(brg).toBeGreaterThan(192);
    // Along the horizontal centre line only x moves.
    const [er, eg] = pixel(pixels, size, size - 1, 4);
    expect(er).toBeGreaterThan(160);
    expect(Math.abs(eg - 128)).toBeLessThanOrEqual(2);
    for (let index = 3; index < pixels.length; index += 4)
      expect(pixels[index]).toBe(255);
  });

  it("grows the offset with the radius, so the edges bend more than the middle", () => {
    const size = 16;
    const pixels = curvatureMapPixels(size);
    const nearCentre = pixel(pixels, size, 10, 8)[0];
    const farOut = pixel(pixels, size, 15, 8)[0];
    expect(farOut - 128).toBeGreaterThan((nearCentre - 128) * 3);
  });

  it("draws the map on the canvas it is given and returns its data URL", () => {
    let drawn: Uint8ClampedArray | undefined;
    let placed: [number, number] | undefined;
    const context: MapCanvasContext = {
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image, x, y) => {
        drawn = image.data;
        placed = [x, y];
      },
    };
    const canvas: MapCanvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () => "data:image/png;base64,MAP",
    };
    expect(curvatureMapDataUrl(() => canvas)).toBe("data:image/png;base64,MAP");
    expect(canvas.width).toBe(CURVATURE_MAP_SIZE);
    expect(canvas.height).toBe(CURVATURE_MAP_SIZE);
    expect(placed).toEqual([0, 0]);
    expect(drawn).toEqual(curvatureMapPixels(CURVATURE_MAP_SIZE));
  });

  it("gives up without a 2D context", () => {
    const canvas: MapCanvas = {
      width: 0,
      height: 0,
      getContext: () => null,
      toDataURL: () => "unreachable",
    };
    expect(curvatureMapDataUrl(() => canvas, 4)).toBeUndefined();
  });
});
