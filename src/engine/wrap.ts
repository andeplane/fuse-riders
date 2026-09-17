/**
 * Geometry for a board whose edges are open: what leaves one side arrives on the other, so the arena is a torus.
 *
 * State always holds positions inside the board. A step is computed unwrapped — it may end just past an edge — and
 * is folded back only when it is committed, so every swept test in between still sees one straight segment. Whatever
 * can reach across an edge is tested once more per edge it reaches, shifted by a whole board: `wrapImages` says which.
 */
import { clipTrailSegment } from "./trail-clipping.js";
import type { TrailSegment } from "./primitives.js";

export interface WrapOffset {
  dx: number;
  dy: number;
}
export const NO_WRAP: readonly WrapOffset[] = Object.freeze([
  Object.freeze({ dx: 0, dy: 0 }),
]);

/** Folds a coordinate into [0, size). */
export function wrapCoordinate(value: number, size: number): number {
  const folded = value - Math.floor(value / size) * size;
  // A tiny negative folds to exactly `size` in floating point; the far edge is the near one.
  return folded >= size ? 0 : folded;
}

/** The shortest signed way from one coordinate to another on a ring of `size`. */
export function wrapDelta(delta: number, size: number): number {
  return delta - Math.round(delta / size) * size;
}

/**
 * Every shift by whole boards that brings part of this box onto the board, the box's own place first. A box wholly
 * inside has one image; one hanging over an edge has two, and over a corner four.
 */
export function wrapImages(
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): WrapOffset[] {
  const shiftsX = [
    0,
    ...(minX < 0 ? [width] : []),
    ...(maxX > width ? [-width] : []),
  ];
  const shiftsY = [
    0,
    ...(minY < 0 ? [height] : []),
    ...(maxY > height ? [-height] : []),
  ];
  return shiftsY.flatMap((dy) => shiftsX.map((dx) => ({ dx, dy })));
}

/**
 * The pieces of an unwrapped segment that lie on the board, in the order they were travelled. One piece unless the
 * segment crosses an edge; the pieces on either side of a crossing end and begin on opposite edges.
 */
export function splitWrappedSegment(
  segment: TrailSegment,
  width: number,
  height: number,
): TrailSegment[] {
  const bounds = { minX: 0, minY: 0, maxX: width, maxY: height };
  const images = wrapImages(
    width,
    height,
    Math.min(segment.x1, segment.x2),
    Math.min(segment.y1, segment.y2),
    Math.max(segment.x1, segment.x2),
    Math.max(segment.y1, segment.y2),
  );
  if (images.length === 1) return [segment];
  const along = (piece: TrailSegment, dx: number, dy: number): number =>
    (piece.x1 - dx - segment.x1) * (segment.x2 - segment.x1) +
    (piece.y1 - dy - segment.y1) * (segment.y2 - segment.y1);
  return images
    .flatMap(({ dx, dy }) => {
      const piece = clipTrailSegment(
        {
          ...segment,
          x1: segment.x1 + dx,
          y1: segment.y1 + dy,
          x2: segment.x2 + dx,
          y2: segment.y2 + dy,
        },
        bounds,
      );
      // A piece that is only the point where the segment touches an edge or a corner is no trail at all.
      return piece && (piece.x1 !== piece.x2 || piece.y1 !== piece.y2)
        ? [{ piece, order: along(piece, dx, dy) }]
        : [];
    })
    .sort((a, b) => a.order - b.order)
    .map(({ piece }) => piece);
}
