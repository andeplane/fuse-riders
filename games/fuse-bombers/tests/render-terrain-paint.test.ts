import test from "node:test";
import assert from "node:assert/strict";
import {
  carveCircle,
  createGrid,
  fillCircle,
  fillRect,
  type CellRect,
  type Grid,
} from "../src/engine/grid.js";
import { hashSeed, int, random, type RngHolder } from "../src/engine/rng.js";
import { THEMES } from "../src/render/palette.js";
import {
  GRASS_DEPTH,
  changedRect,
  clampRect,
  paintCells,
  repaintRect,
  terrainPalette,
  type TerrainPalette,
} from "../src/render/terrain-paint.js";

// The terrain layer repaints only the cells a crater changed. These tests hold that to the full repaint it stands in
// for, through the same pure painter and rectangle the layer uses, with no canvas.

const palette = (grid: Grid): TerrainPalette =>
  terrainPalette(THEMES[0]!, grid.rows);

/** A pixel per cell of the whole grid. */
function paintAll(grid: Grid, colours: TerrainPalette): Uint32Array {
  const image = new Uint32Array(grid.cols * grid.rows);
  paintCells(image, grid, colours, {
    col0: 0,
    row0: 0,
    col1: grid.cols,
    row1: grid.rows,
  });
  return image;
}

/** What the layer does after a carve: repaint `repaintRect` of it (clipped to the grid) over `image`. */
function repaintAfter(
  image: Uint32Array,
  grid: Grid,
  colours: TerrainPalette,
  carved: CellRect,
): void {
  const r = clampRect(repaintRect(carved), grid.cols, grid.rows);
  if (r.col1 <= r.col0 || r.row1 <= r.row0) return;
  const w = r.col1 - r.col0;
  const block = new Uint32Array(w * (r.row1 - r.row0));
  paintCells(block, grid, colours, r);
  for (let row = r.row0; row < r.row1; row++)
    for (let col = r.col0; col < r.col1; col++)
      image[row * grid.cols + col] =
        block[(row - r.row0) * w + (col - r.col0)] ?? 0;
}

/** The first cell where two images differ, as text, or "same". */
function firstDifference(a: Uint32Array, b: Uint32Array, cols: number): string {
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i])
      return `cell (${i % cols}, ${Math.floor(i / cols)}): ${a[i]?.toString(16)} vs ${b[i]?.toString(16)}`;
  return "same";
}

/** Rock with some indestructible veins and floating islets, so carves expose edges of every kind. */
function roughGrid(width: number, height: number, cell: number, seed: number) {
  const grid = createGrid(width, height, cell);
  const rng: RngHolder = { rng: hashSeed(seed, 11) };
  fillRect(grid, 0, height * 0.3, width, height, "rock");
  for (let i = 0; i < 8; i++)
    fillCircle(
      grid,
      random(rng) * width,
      random(rng) * height * 0.5,
      int(rng, 6, 20),
      "rock",
    );
  for (let i = 0; i < 5; i++)
    fillCircle(
      grid,
      random(rng) * width,
      height * (0.4 + random(rng) * 0.5),
      int(rng, 5, 14),
      "hard",
    );
  return { grid, rng };
}

test("repainting only what a crater touched equals repainting the whole terrain", () => {
  let carves = 0;
  for (const [width, height, cell] of [
    [256, 192, 4],
    [185, 145, 5],
  ] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      const { grid, rng } = roughGrid(width, height, cell, seed);
      const colours = palette(grid);
      const image = paintAll(grid, colours);
      for (let i = 0; i < 40; i++) {
        const carved = carveCircle(
          grid,
          random(rng) * width,
          random(rng) * height,
          int(rng, 4, 28),
        );
        if (!carved) continue;
        carves++;
        repaintAfter(image, grid, colours, carved);
        assert.equal(
          firstDifference(image, paintAll(grid, colours), grid.cols),
          "same",
          `${width}×${height}/${cell}, seed ${seed}, carve ${i}`,
        );
      }
    }
  }
  assert.ok(carves > 150, `only ${carves} carves changed cells`);
});

test("repainting where two grids differ (other carves after a rollback) equals repainting the second whole", () => {
  const { grid, rng } = roughGrid(256, 192, 4, 3);
  const colours = palette(grid),
    image = paintAll(grid, colours),
    other = structuredClone(grid);
  assert.equal(changedRect(grid, structuredClone(grid)), undefined);
  for (let i = 0; i < 6; i++) carveCircle(other, random(rng) * 256, 120, 24);
  repaintAfter(image, other, colours, changedRect(grid, other)!);
  assert.equal(firstDifference(image, paintAll(other, colours), 64), "same");
});

test("a carve changes the grass two rows below it, and repaintRect reaches that far", () => {
  // Rock under open sky with a notch cut out of its top: the cell two rows under the notch turns to grass because it
  // now sees air two rows up, a row the old one-row border did not repaint.
  const grid = createGrid(80, 80, 4);
  fillRect(grid, 0, 40, 80, 80, "rock");
  const colours = palette(grid);
  const image = paintAll(grid, colours);
  const below = (row: number) => image[row * grid.cols + 10];
  const [surface, body] = [10, 12]; // the top row of the rock, and a row clear of the grass
  assert.equal(GRASS_DEPTH, 2);
  assert.equal(below(surface), colours.top);
  assert.equal(below(surface + 1), colours.top);
  assert.notEqual(below(body), colours.top);

  const carved = carveCircle(grid, 40, 41, 4);
  assert.ok(carved);
  const stale = image.slice();
  repaintAfter(image, grid, colours, carved);
  assert.equal(
    firstDifference(image, paintAll(grid, colours), grid.cols),
    "same",
  );
  const row = carved.row1 + 1; // two rows under the carve's last row
  assert.equal(image[row * grid.cols + 10], colours.top);
  assert.notEqual(stale[row * grid.cols + 10], image[row * grid.cols + 10]);
});

test("repaintRect is the crater plus a column each side, a row above and the grass depth below", () => {
  assert.deepEqual(repaintRect({ col0: 10, row0: 20, col1: 15, row1: 25 }), {
    col0: 9,
    row0: 19,
    col1: 16,
    row1: 25 + GRASS_DEPTH,
  });
  assert.deepEqual(
    clampRect({ col0: -3, row0: -1, col1: 500, row1: 90 }, 300, 80),
    { col0: 0, row0: 0, col1: 300, row1: 80 },
  );
  const away = clampRect({ col0: 400, row0: 0, col1: 410, row1: 5 }, 300, 80);
  assert.ok(away.col1 <= away.col0, "a rectangle off the grid is empty");
});

test("air is transparent, grass tops the rock, and indestructible rock is darker", () => {
  const grid = createGrid(48, 48, 4);
  fillRect(grid, 0, 20, 48, 48, "rock");
  fillRect(grid, 20, 32, 28, 40, "hard");
  const colours = palette(grid);
  const image = paintAll(grid, colours);
  const at = (col: number, row: number) => image[row * grid.cols + col];
  assert.equal(at(3, 2), 0, "open sky stays transparent");
  assert.equal(at(3, 5), colours.top, "the surface is grass");
  assert.equal(at(3, 9), colours.rows[9], "rock inside is the body colour");
  assert.notEqual(at(5, 9), at(3, 9), "hard rock is shaded");
});
