import type Phaser from "phaser";
import {
  cellHard,
  cellSolid,
  type TerrainView,
  type TickEvent,
} from "../engine/index.js";
import type { Theme } from "./palette.js";

const KEY = "terrain";

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

/**
 * The destructible map as one canvas texture with a pixel per terrain cell (1200 × 675 on the temple), drawn scaled
 * up by the cell size so it covers the world. Rock takes the theme's ground colours with strata, indestructible rock
 * a darker shade, rock under open sky the theme's grass or sand and every other edge a dark outline. Each frame it
 * repaints only the cells the `crater` events changed (with a one-cell border, whose edges may change), and all of
 * it when it missed a carve.
 */
export class TerrainLayer {
  private texture: Phaser.Textures.CanvasTexture | null = null;
  private readonly image: Phaser.GameObjects.Image;
  private theme: Theme | null = null;
  /** Body colour per row (ground gradient top to bottom). */
  private rows = new Uint32Array(0);
  private version = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.image = scene.add.image(0, 0, "__DEFAULT").setOrigin(0, 0);
    this.image.setDepth(depth).setVisible(false);
  }

  /** Start a new round: size the texture to the grid and paint all of it. */
  reset(grid: TerrainView, theme: Theme): void {
    const textures = this.scene.textures;
    // Kept across scene restarts: the texture manager is global to the game.
    let texture = textures.exists(KEY)
      ? (textures.get(KEY) as Phaser.Textures.CanvasTexture)
      : textures.createCanvas(KEY, grid.cols, grid.rows);
    if (!texture) throw new Error("could not create the terrain texture");
    if (texture.width !== grid.cols || texture.height !== grid.rows)
      texture = texture.setSize(grid.cols, grid.rows);
    this.texture = texture;
    this.image.setTexture(KEY).setScale(grid.cell).setVisible(true);
    this.theme = theme;
    this.rows = Uint32Array.from({ length: grid.rows }, (_, row) =>
      groundAt(theme, row / Math.max(1, grid.rows - 1)),
    );
    this.paint(grid, 0, 0, grid.cols, grid.rows);
    this.version = grid.version;
    texture.refresh();
  }

  /** Repaints what this frame's `crater` events changed; everything if the grid changed some other way. */
  update(grid: TerrainView, events: readonly TickEvent[]): void {
    const texture = this.texture;
    if (!texture || grid.version === this.version) return;
    let carves = 0;
    for (const e of events) {
      if (e.type !== "crater") continue;
      this.paint(grid, e.col0 - 1, e.row0 - 1, e.col1 + 1, e.row1 + 1);
      carves++;
    }
    // Each carve that changes cells bumps the version once and reports one crater.
    if (this.version + carves !== grid.version)
      this.paint(grid, 0, 0, grid.cols, grid.rows);
    this.version = grid.version;
    texture.refresh();
  }

  /** Paints cells [`col0`, `col1`) × [`row0`, `row1`), clamped to the grid. */
  private paint(
    grid: TerrainView,
    col0: number,
    row0: number,
    col1: number,
    row1: number,
  ): void {
    const theme = this.theme;
    const texture = this.texture;
    if (!theme || !texture) return;
    const [c0, r0] = [Math.max(0, col0), Math.max(0, row0)];
    const [c1, r1] = [Math.min(grid.cols, col1), Math.min(grid.rows, row1)];
    if (c1 <= c0 || r1 <= r0) return;
    const image = texture.context.createImageData(c1 - c0, r1 - r0);
    const out = new Uint32Array(image.data.buffer);
    const top = pixel(theme.top);
    const outline = pixel(theme.outline);
    let i = 0;
    for (let row = r0; row < r1; row++) {
      const body = this.rows[row] ?? 0;
      for (let col = c0; col < c1; col++, i++) {
        if (!cellSolid(grid, col, row)) continue;
        // Grass two cells deep, so it still reads with the whole world in view.
        const open =
          !cellSolid(grid, col, row - 1) || !cellSolid(grid, col, row - 2);
        const edge =
          open ||
          !cellSolid(grid, col - 1, row) ||
          !cellSolid(grid, col + 1, row) ||
          !cellSolid(grid, col, row + 1);
        const strata = (row + Math.round(2 * Math.sin(col / 23))) % 11 === 0;
        const rock = strata ? shade(body, 0.8) : body;
        if (cellHard(grid, col, row))
          out[i] = edge ? outline : shade(rock, 0.55);
        else out[i] = open ? top : edge ? outline : rock;
      }
    }
    texture.context.putImageData(image, c0, r0);
  }
}
