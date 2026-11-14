/**
 * How big the art is, measured rather than assumed: where a sheet's first frame has paint, and from that how tall
 * each kind of thing stands over its anchor. Labels, effects and the snail's mouth are placed from these numbers, so
 * a redrawn Queen or gate moves them without a line of code changing.
 */
import type { ArtManifest, SheetDef } from "./manifest.js";

/** The painted part of a frame in cell coordinates, edges included. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The bounds of every pixel that is not clear in RGBA `data` of a `width` by `height` frame; null when all are. */
export function opaqueBox(
  data: ArrayLike<number>,
  width: number,
  height: number,
): Box | null {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  return right < 0 ? null : { left, top, right, bottom };
}

type Cell = Pick<SheetDef, "anchor" | "frameWidth">;

/** Rows from the anchor row up to the highest painted one, both counted; the whole cell above the anchor if unknown. */
export const heightOver = (def: Cell, box: Box | null): number =>
  def.anchor[1] - (box?.top ?? 0) + 1;

/** Columns from the anchor column to the front-most painted one (the art faces right). */
export const frontOf = (def: Cell, box: Box | null): number =>
  (box?.right ?? def.frameWidth - 1) - def.anchor[0];

/** Heights over the feet in art pixels, and how far the snail's mouth is ahead of its anchor. */
export interface Sizes {
  readonly worker: number;
  readonly warrior: number;
  readonly queen: number;
  readonly gate: number;
  readonly snail: number;
  readonly snailFront: number;
}

/** `box` gives the painted bounds of a sheet's first frame, or null when it cannot be measured. */
export function sizesOf(
  manifest: ArtManifest,
  box: (id: string) => Box | null,
): Sizes {
  const height = (id: string): number => {
    const def = manifest.assets[id];
    return def ? heightOver(def, box(id)) : 0;
  };
  const snail = manifest.assets.snail;
  return {
    worker: height("worker-cyan"),
    warrior: height("warrior-cyan"),
    queen: height("queen-cyan"),
    gate: height("gate-warrior"),
    snail: height("snail"),
    snailFront: snail ? frontOf(snail, box("snail")) : 0,
  };
}
