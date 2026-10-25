/**
 * Stencils on the robots and buildings: a 3 × 5 pixel font drawn once into one shared atlas, a cell per label
 * (squad numbers, the factories' signs), so every decal of every kind is drawn by one material. Generated as data (no
 * canvas), with sharp texels to keep the pixel look. Presentation only.
 */
import * as THREE from "three";

export const LABELS = ["07", "13", "21", "S3", "ROBOTS", "MOTOR POOL"] as const;
export type Label = (typeof LABELS)[number];
/** Cells are 8 texels high and a multiple of 8 wide: glyphs 3 × 5 a texel apart, from (0, 1). */
const CELL = 8;
// prettier-ignore
const GLYPHS: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111",
  "3": "111001111001111", "7": "111001010010010", S: "111100111001111",
  B: "110101110101110", L: "100100100100111", M: "101111111101101", O: "111101101101111",
  P: "111101111100100", R: "110101110101101", T: "111010010010010", " ": "000000000000000",
};
/** Each label's cell: where it starts and how wide it is, in texels. */
const CELLS = LABELS.reduce<{ x: number; w: number }[]>((cells, label) => {
  const x = cells.length ? cells.at(-1)!.x + cells.at(-1)!.w : 0;
  return [...cells, { x, w: Math.ceil((label.length * 4) / CELL) * CELL }];
}, []);
const WIDTH = CELLS.at(-1)!.x + CELLS.at(-1)!.w;
const cell = (label: Label) => CELLS[LABELS.indexOf(label)]!;

/** The texels lit for a label: its cell's width × CELL mask, row 0 at the bottom (v = 0). */
export function labelMask(label: Label): boolean[] {
  const w = cell(label).w,
    mask = Array<boolean>(w * CELL).fill(false);
  [...label].forEach((ch, k) => {
    const rows = GLYPHS[ch]!;
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if (rows[row * 3 + col] === "1")
          mask[(5 - row) * w + k * 4 + col] = true;
  });
  return mask;
}

/** The atlas: cream stencils on transparent texels; decals alpha-test it. */
export function decalAtlas(): THREE.DataTexture {
  const data = new Uint8Array(WIDTH * CELL * 4);
  LABELS.forEach((label) => {
    const { x, w } = cell(label);
    labelMask(label).forEach((on, t) => {
      if (on) data.set([242, 237, 224, 255], (Math.floor(t / w) * WIDTH + x + (t % w)) * 4); // prettier-ignore
    });
  });
  const tex = new THREE.DataTexture(data, WIDTH, CELL);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The label's glyph box in the atlas, [u0, u1, v0, v1]: 4 texels a glyph less the last gap, 5 high. */
export function labelUv(label: Label): [number, number, number, number] {
  const { x } = cell(label);
  return [x / WIDTH, (x + label.length * 4 - 1) / WIDTH, 1 / CELL, 6 / CELL];
}

/**
 * A flag's banner, multiplied into the team colour: dark hems top and bottom and the side's emblem in the middle, a
 * dark lightning bolt in a dark ring, 32 × 20 texels with u running out from the pole.
 */
export function bannerTexture(): THREE.DataTexture {
  const w = 32,
    h = 20,
    data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - 16,
        dy = y + 0.5 - 10,
        ring = Math.abs(Math.hypot(dx, dy) - 6.5) < 0.9;
      // The bolt: a parallelogram down to the middle, then another from the middle on down, offset.
      const bolt = (dy >= 0 && dy < 5 && dx > -dy * 0.6 - 1 && dx < -dy * 0.6 + 2) || (dy < 0 && dy > -5 && dx > -dy * 0.6 - 2 && dx < -dy * 0.6 + 1); // prettier-ignore
      const dark = y < 2 || y >= h - 2 || ring || bolt;
      data.set(
        dark ? [34, 30, 28, 255] : [255, 255, 255, 255],
        (y * w + x) * 4,
      );
    }
  const tex = new THREE.DataTexture(data, w, h);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A label's width over its height as stencilled. */
export const labelAspect = (label: Label): number => (label.length * 4 - 1) / 5;
