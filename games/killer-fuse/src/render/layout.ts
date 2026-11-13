/**
 * Geometry the canvas code needs but that involves no canvas: the integer scale that fits a host, which copies of a
 * sprite the horizontal wrap needs, and how a platform rectangle is cut into 8 pixel tiles.
 */

export const VIEW_WIDTH = 480,
  VIEW_HEIGHT = 270;
export const TILE = 8;

export interface Fit {
  /** Whole device pixels per art pixel, at least 1. */
  readonly scale: number;
  /** Backing-store size of the canvas. */
  readonly width: number;
  readonly height: number;
  /** CSS size and position inside the host, centred (letterboxed). */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly left: number;
  readonly top: number;
}

/**
 * The largest whole number of device pixels per art pixel that fits the host. Scaling by anything else blurs or
 * doubles rows of pixels, so the leftover is letterboxed. A host smaller than the art gets scale 1 and is cropped
 * by the page rather than shrunk.
 */
export function fitView(
  hostWidth: number,
  hostHeight: number,
  pixelRatio: number,
): Fit {
  const ratio = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
  const widthPx = Math.max(0, hostWidth) * ratio,
    heightPx = Math.max(0, hostHeight) * ratio;
  const scale = Math.max(
    1,
    Math.floor(Math.min(widthPx / VIEW_WIDTH, heightPx / VIEW_HEIGHT)),
  );
  const width = VIEW_WIDTH * scale,
    height = VIEW_HEIGHT * scale;
  const cssWidth = width / ratio,
    cssHeight = height / ratio;
  return {
    scale,
    width,
    height,
    cssWidth,
    cssHeight,
    left: (hostWidth - cssWidth) / 2,
    top: (hostHeight - cssHeight) / 2,
  };
}

/**
 * Horizontal offsets at which to draw something spanning [left, right) so it shows on both sides of the seam: 0, and
 * a screen to the right when it hangs over the left edge, a screen to the left when it hangs over the right.
 */
export function wrapOffsets(
  left: number,
  right: number,
  width = VIEW_WIDTH,
): number[] {
  const offsets = [0];
  if (left < 0) offsets.push(width);
  if (right > width) offsets.push(-width);
  return offsets;
}

export interface TilePiece {
  /** Frame name in the tile sheet. */
  readonly frame: string;
  /** Where it goes, in art pixels. */
  readonly x: number;
  readonly y: number;
  /** How much of the tile to draw, from its left and top; the last middle tile of an odd width is cut short. */
  readonly w: number;
  readonly h: number;
}

/**
 * One row of tiles for a run from `x` over `w` pixels: an end cap on each side that does not touch the screen edge
 * (a platform that reaches the edge continues across the wrap), middles between, with every fifth middle a lamp.
 */
export function tileRow(
  kind: "slab" | "track",
  x: number,
  y: number,
  w: number,
  h: number,
  width = VIEW_WIDTH,
): TilePiece[] {
  const pieces: TilePiece[] = [];
  const height = Math.min(TILE, h);
  const capLeft = x > 0 && w >= TILE * 2,
    capRight = x + w < width && w >= TILE * 2;
  const from = x + (capLeft ? TILE : 0),
    to = x + w - (capRight ? TILE : 0);
  if (capLeft) pieces.push({ frame: `${kind}Left`, x, y, w: TILE, h: height });
  for (let at = from, i = 0; at < to; at += TILE, i += 1)
    pieces.push({
      frame: i % 5 === 2 && to - at >= TILE ? `${kind}Lamp` : kind,
      x: at,
      y,
      w: Math.min(TILE, to - at),
      h: height,
    });
  if (capRight)
    pieces.push({ frame: `${kind}Right`, x: to, y, w: TILE, h: height });
  return pieces;
}

/** The filler under a floor's track row, with nodes and cells scattered by position so it is the same every frame. */
export function fillRows(
  x: number,
  y: number,
  w: number,
  h: number,
): TilePiece[] {
  const pieces: TilePiece[] = [];
  for (let j = 0; j * TILE < h; j += 1)
    for (let i = 0; i * TILE < w; i += 1)
      pieces.push({
        frame:
          (i * 7 + j * 3) % 11 === 0
            ? "middleNode"
            : (i * 5 + j) % 9 === 0
              ? "middleCell"
              : "middle",
        x: x + i * TILE,
        y: y + j * TILE,
        w: Math.min(TILE, w - i * TILE),
        h: Math.min(TILE, h - j * TILE),
      });
  return pieces;
}

/** Tiles for one solid rectangle: the first platform of a map is the floor, the rest are ledges. */
export function platformTiles(
  rect: { x: number; y: number; w: number; h: number },
  floor: boolean,
): TilePiece[] {
  if (!floor) return tileRow("slab", rect.x, rect.y, rect.w, TILE);
  return [
    ...tileRow("track", rect.x, rect.y, rect.w, rect.h),
    ...fillRows(rect.x, rect.y + TILE, rect.w, rect.h - TILE),
  ];
}
