/**
 * Squad numbers stencilled on the robots: a 3 × 5 pixel font drawn once into one shared atlas, a cell per label, so
 * every decal of every kind is drawn by one material. Generated as data (no canvas), with sharp texels to keep the
 * pixel look. Presentation only.
 */
import * as THREE from "three";

export const LABELS = ["07", "13", "21", "S3"] as const;
export type Label = (typeof LABELS)[number];
/** A cell is 8 × 8 texels: two 3 × 5 glyphs a texel apart, from (0, 1). */
const CELL = 8;
// prettier-ignore
const GLYPHS: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111",
  "3": "111001111001111", "7": "111001010010010", S: "111100111001111",
};

/** The texels lit for a label: a CELL × CELL mask, row 0 at the bottom (v = 0). */
export function labelMask(label: Label): boolean[] {
  const mask = Array<boolean>(CELL * CELL).fill(false);
  [...label].forEach((ch, k) => {
    const rows = GLYPHS[ch]!;
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if (rows[row * 3 + col] === "1")
          mask[(5 - row) * CELL + k * 4 + col] = true;
  });
  return mask;
}

/** The atlas: cream stencils on transparent texels; decals alpha-test it. */
export function decalAtlas(): THREE.DataTexture {
  const w = CELL * LABELS.length,
    data = new Uint8Array(w * CELL * 4);
  LABELS.forEach((label, i) =>
    labelMask(label).forEach((on, t) => {
      if (on) data.set([242, 237, 224, 255], ((t >> 3) * w + i * CELL + (t & 7)) * 4); // prettier-ignore
    }),
  );
  const tex = new THREE.DataTexture(data, w, CELL);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The label's glyph box in the atlas, [u0, u1, v0, v1]: 7 × 5 texels. */
export function labelUv(label: Label): [number, number, number, number] {
  const i = LABELS.indexOf(label),
    w = CELL * LABELS.length;
  return [(i * CELL) / w, (i * CELL + 7) / w, 1 / CELL, 6 / CELL];
}
