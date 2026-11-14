/**
 * Turns a sprite's hue, pixel by pixel: the art is painted with one cyan accent and each roster slot gets its own
 * colour at load. Done on the pixels because `ctx.filter` is missing on some phones. Greys (the graphite, the
 * whites) have no hue and stay as they are; alpha is untouched.
 */
export function shiftHue(pixels: Uint8ClampedArray, degrees: number): void {
  const turn = (((degrees % 360) + 360) % 360) / 60;
  if (turn === 0) return;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const r = pixels[i]!,
      g = pixels[i + 1]!,
      b = pixels[i + 2]!;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      chroma = max - min;
    if (chroma === 0) continue;
    let hue =
      max === r
        ? ((g - b) / chroma + 6) % 6
        : max === g
          ? (b - r) / chroma + 2
          : (r - g) / chroma + 4;
    hue = (hue + turn) % 6;
    // HSV back to RGB with the value and chroma it had.
    const x = chroma * (1 - Math.abs((hue % 2) - 1));
    const [r1, g1, b1] =
      hue < 1
        ? [chroma, x, 0]
        : hue < 2
          ? [x, chroma, 0]
          : hue < 3
            ? [0, chroma, x]
            : hue < 4
              ? [0, x, chroma]
              : hue < 5
                ? [x, 0, chroma]
                : [chroma, 0, x];
    pixels[i] = Math.round(r1 + min);
    pixels[i + 1] = Math.round(g1 + min);
    pixels[i + 2] = Math.round(b1 + min);
  }
}
