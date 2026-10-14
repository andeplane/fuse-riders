// How the terrain's cells become pixels, as pure functions over a `TerrainView` and a plain pixel buffer, so the
// layer's incremental repaints can be checked against a full one without Phaser or a canvas.
import {
  cellHard,
  cellSolid,
  type CellRect,
  type TerrainView,
} from "../engine/index.js";
import type { Theme } from "./palette.js";

/**
 * Rock this many cells deep under open sky is grass (or sand): the colour of a cell depends on the `GRASS_DEPTH`
 * cells above it, so a carve changes cells that many rows below it as well.
 */
export const GRASS_DEPTH = 2;

/** How far from a cell `paintCells` looks: a column to either side, `GRASS_DEPTH` rows up and one row down. */
const LOOKS = { side: 1, up: GRASS_DEPTH, down: 1 } as const;

/** The colours `paintCells` uses: a body colour per row, the grass colour and the outline colour (ABGR pixels). */
export interface TerrainPalette {
  readonly rows: Uint32Array;
  readonly top: number;
  readonly outline: number;
}

/** `#rrggbb` → a pixel for a little-endian `Uint32Array` view of `ImageData` (ABGR), at `alpha`. */
function pixel(hex: string, alpha = 255): number {
  const v = Number.parseInt(hex.slice(1, 7), 16);
  return ((alpha << 24) | ((v & 0xff) << 16) | (v & 0xff00) | (v >>> 16)) >>> 0;
}

/** A pixel scaled toward black by `k` (0..1). */
function shade(p: number, k: number): number {
  const f = (shift: number) => Math.round(((p >>> shift) & 0xff) * k) << shift;
  return ((p & 0xff000000) | f(16) | f(8) | f(0)) >>> 0;
}

/** Linear blend of the theme's ground stops at `u` in [0, 1]. */
function groundAt(theme: Theme, u: number): number {
  const stops = theme.ground.map((c) => pixel(c));
  const at = Math.min(stops.length - 1.001, u * (stops.length - 1));
  const [a, b, t] = [stops[Math.floor(at)]!, stops[Math.ceil(at)]!, at % 1];
  const mix = (shift: number) =>
    Math.round(((a >>> shift) & 0xff) * (1 - t) + ((b >>> shift) & 0xff) * t) <<
    shift;
  return (0xff000000 | mix(16) | mix(8) | mix(0)) >>> 0;
}

/** The theme's colours for a grid of `rows` rows: the ground gradient runs top to bottom. */
export function terrainPalette(theme: Theme, rows: number): TerrainPalette {
  return {
    rows: Uint32Array.from({ length: rows }, (_, row) =>
      groundAt(theme, row / Math.max(1, rows - 1)),
    ),
    top: pixel(theme.top),
    outline: pixel(theme.outline),
  };
}

/**
 * The cells whose pixels can change when the cells of `carved` do: `carved` and every cell that looks at one of them
 * (see `LOOKS`: a cell a row above looks one down, a cell up to `GRASS_DEPTH` rows below looks up), unclamped.
 * Repainting this rectangle after a carve equals repainting the whole terrain.
 */
export function repaintRect(carved: CellRect): CellRect {
  return {
    col0: carved.col0 - LOOKS.side,
    row0: carved.row0 - LOOKS.down,
    col1: carved.col1 + LOOKS.side,
    row1: carved.row1 + LOOKS.up,
  };
}

/** The rows in which two grids of one size differ, every column, or undefined when they are the same. */
export function changedRect(
  a: TerrainView,
  b: TerrainView,
): CellRect | undefined {
  let first = -1,
    last = -1;
  for (let i = 0; i < b.solid.length; i++)
    if (a.solid[i] !== b.solid[i] || a.hard[i] !== b.hard[i])
      [first, last] = [first < 0 ? i : first, i];
  const row = (bit: number) => Math.floor(bit / b.cols);
  if (first >= 0)
    return {
      col0: 0,
      row0: row(32 * first),
      col1: b.cols,
      row1: row(32 * last + 31) + 1,
    };
}

/** `rect` clipped to a `cols` × `rows` grid; empty (`col1 <= col0` or `row1 <= row0`) when nothing is left. */
export function clampRect(
  rect: CellRect,
  cols: number,
  rows: number,
): CellRect {
  return {
    col0: Math.max(0, rect.col0),
    row0: Math.max(0, rect.row0),
    col1: Math.min(cols, rect.col1),
    row1: Math.min(rows, rect.row1),
  };
}

/**
 * Writes the pixel of each cell of `rect` (already inside the grid) into `out`, row by row from `out[0]`, so `out`
 * holds `(col1 - col0) * (row1 - row0)` pixels. Rock takes the palette's body colour with strata, indestructible rock a
 * darker shade, rock under open sky `top`, every other edge `outline`, and air stays transparent.
 */
export function paintCells(
  out: Uint32Array,
  grid: TerrainView,
  palette: TerrainPalette,
  rect: CellRect,
): void {
  let i = 0;
  for (let row = rect.row0; row < rect.row1; row++) {
    const body = palette.rows[row] ?? 0;
    for (let col = rect.col0; col < rect.col1; col++, i++) {
      if (!cellSolid(grid, col, row)) {
        out[i] = 0;
        continue;
      }
      // Grass `GRASS_DEPTH` cells deep, so it still reads with the whole world in view.
      let open = false;
      for (let up = 1; up <= GRASS_DEPTH; up++)
        open ||= !cellSolid(grid, col, row - up);
      const edge =
        open ||
        !cellSolid(grid, col - 1, row) ||
        !cellSolid(grid, col + 1, row) ||
        !cellSolid(grid, col, row + 1);
      const strata = (row + Math.round(2 * Math.sin(col / 23))) % 11 === 0;
      const rock = strata ? shade(body, 0.8) : body;
      if (cellHard(grid, col, row))
        out[i] = edge ? palette.outline : shade(rock, 0.55);
      else out[i] = open ? palette.top : edge ? palette.outline : rock;
    }
  }
}
