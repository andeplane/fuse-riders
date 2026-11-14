/**
 * Geometry the canvas code needs but that involves no canvas: the integer scale that fits a host, which copies of a
 * sprite the horizontal wrap needs, and how a map's rectangles are cut into tiles.
 */

export const VIEW_WIDTH = 480,
  VIEW_HEIGHT = 270;

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
  /** The picture is shown shrunk from the next whole scale to fill the host, so it must be smoothed. */
  readonly smooth: boolean;
}

/** A whole scale that covers less of the host than this, each way, wastes too much of a small window. */
export const FILL = 0.85;

/**
 * The largest whole number of device pixels per art pixel that fits the host: scaling by anything else doubles some
 * rows of pixels, so the leftover is letterboxed. When that would leave more than a sixth of the window empty (a
 * 1280 by 720 window fits 2.67), the picture is drawn at the next whole scale up and shown shrunk to fill the host,
 * smoothed (`smooth`) so no row is dropped. A host smaller than the art (a phone held upright) gets the art at scale
 * 1 shrunk to fit it, smoothed too: the whole arena always shows. A host with no size yet gets scale 1.
 */
export function fitView(
  hostWidth: number,
  hostHeight: number,
  pixelRatio: number,
): Fit {
  const ratio = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
  const widthPx = Math.max(0, hostWidth) * ratio,
    heightPx = Math.max(0, hostHeight) * ratio;
  const exact = Math.min(widthPx / VIEW_WIDTH, heightPx / VIEW_HEIGHT);
  const whole = Math.max(1, Math.floor(exact));
  const shrunk = exact > 0 && exact < 1;
  const smooth = shrunk || (exact > 1 && whole / exact < FILL);
  const scale = smooth && !shrunk ? whole + 1 : whole;
  const shown = smooth ? exact : whole;
  const cssWidth = (VIEW_WIDTH * shown) / ratio,
    cssHeight = (VIEW_HEIGHT * shown) / ratio;
  return {
    scale,
    width: VIEW_WIDTH * scale,
    height: VIEW_HEIGHT * scale,
    cssWidth,
    cssHeight,
    left: (hostWidth - cssWidth) / 2,
    top: (hostHeight - cssHeight) / 2,
    smooth,
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
  /** The part of the tile to draw: its offset inside the tile and its size. */
  readonly sx: number;
  readonly sy: number;
  readonly w: number;
  readonly h: number;
}

/** One stretch of a run of tiles: an end cap or a middle, and which part of its tile shows. */
export interface Span {
  readonly part: "start" | "middle" | "end";
  readonly at: number;
  readonly offset: number;
  readonly size: number;
  /** Position among the middles, for sprinkling variants. */
  readonly index: number;
}

/**
 * Cuts `length` pixels from `from` into tile-sized stretches: a start cap, middles, and an end cap laid last with
 * its far edge on the run's (so the middle before it is cut short, never the cap). A run shorter than two tiles is
 * the near half of the start cap and the far half of the end cap. `capStart` and `capEnd` say whether the run ends
 * there at all: one that leaves the screen carries on across the wrap and gets middles to its edge.
 */
export function spans(
  from: number,
  length: number,
  tile: number,
  capStart = true,
  capEnd = true,
): Span[] {
  if (length <= 0) return [];
  const out: Span[] = [];
  const caps = (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  if (caps === 2 && length < tile * 2) {
    const near = Math.ceil(length / 2),
      far = length - near;
    out.push({ part: "start", at: from, offset: 0, size: near, index: 0 });
    if (far > 0)
      out.push({
        part: "end",
        at: from + near,
        offset: tile - far,
        size: far,
        index: 0,
      });
    return out;
  }
  const start = capStart ? Math.min(tile, length) : 0;
  const end = capEnd ? Math.min(tile, length - start) : 0;
  if (start > 0)
    out.push({ part: "start", at: from, offset: 0, size: start, index: 0 });
  const stop = from + length - end;
  for (let at = from + start, index = 0; at < stop; at += tile, index += 1)
    out.push({
      part: "middle",
      at,
      offset: 0,
      size: Math.min(tile, stop - at),
      index,
    });
  if (end > 0)
    out.push({
      part: "end",
      at: stop,
      offset: tile - end,
      size: end,
      index: 0,
    });
  return out;
}

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TileSheet {
  /** Side of a square tile. */
  readonly tile: number;
  /** Whether the sheet has a frame of that name. */
  has(frame: string): boolean;
  /** Rows of that frame with anything drawn in them, counted from its top. */
  rows(frame: string): number;
}

/** Every how many middles a lamp goes, and which one of each group. */
const LAMP_EVERY = 5,
  LAMP_AT = 2;

/**
 * Tiles for one solid rectangle of a map, chosen by its shape alone: a rectangle taller than a tile is a block of
 * top, middle and bottom rows; a thin one that reaches the bottom of the screen is the ground (`track`); any other
 * is a floating platform: `ledge` when the sheet has it and its art is thick enough, else `slab`. A thin piece is
 * drawn as tall as its art is, so a fringe under a slab's solid rows hangs below the rectangle.
 */
export function platformTiles(
  rect: TileRect,
  sheet: TileSheet,
  width = VIEW_WIDTH,
  height = VIEW_HEIGHT,
): TilePiece[] {
  const { tile } = sheet;
  const columns = spans(
    rect.x,
    rect.w,
    tile,
    rect.x > 0,
    rect.x + rect.w < width,
  );
  const pick = (name: string, fallback: string): string =>
    sheet.has(name) ? name : fallback;
  if (rect.h > tile) {
    const names = {
      start: { start: "topLeft", middle: "top", end: "topRight" },
      middle: { start: "left", middle: "middle", end: "right" },
      end: { start: "bottomLeft", middle: "bottom", end: "bottomRight" },
    } as const;
    return spans(rect.y, rect.h, tile).flatMap((row) =>
      columns.map((column) => ({
        frame: pick(names[row.part][column.part], "middle"),
        x: column.at,
        y: row.at,
        sx: column.offset,
        sy: row.offset,
        w: column.size,
        h: row.size,
      })),
    );
  }
  const ground = rect.y + rect.h >= height;
  const kind = ground
    ? "track"
    : sheet.has("ledge") && sheet.rows("ledge") >= rect.h
      ? "ledge"
      : "slab";
  const rows = Math.min(tile, Math.max(rect.h, sheet.rows(kind)));
  const caps = { start: `${kind}Left`, end: `${kind}Right` } as const;
  return columns.map((column) => ({
    frame:
      column.part === "middle"
        ? column.index % LAMP_EVERY === LAMP_AT && column.size === tile
          ? pick(`${kind}Lamp`, kind)
          : kind
        : pick(caps[column.part], kind),
    x: column.at,
    y: rect.y,
    sx: column.offset,
    sy: 0,
    w: column.size,
    h: rows,
  }));
}
