import type Phaser from "phaser";
import type { CellRect, TerrainView, TickEvent } from "../engine/index.js";
import type { Theme } from "./palette.js";
import {
  clampRect,
  paintCells,
  repaintRect,
  terrainPalette,
  type TerrainPalette,
} from "./terrain-paint.js";

const KEY = "terrain";

/**
 * The destructible map as one canvas texture with a pixel per terrain cell (1200 × 675 on the temple), drawn scaled
 * up by the cell size so it covers the world. Rock takes the theme's ground colours with strata, indestructible rock
 * a darker shade, rock under open sky the theme's grass or sand and every other edge a dark outline (the pixels are
 * `terrain-paint.ts`). Each frame it repaints only the cells the `crater` events changed and the neighbours whose
 * colour depends on them (`repaintRect`), and all of it when it missed a carve.
 */
export class TerrainLayer {
  private texture: Phaser.Textures.CanvasTexture | null = null;
  private readonly image: Phaser.GameObjects.Image;
  private palette: TerrainPalette | null = null;
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
    this.palette = terrainPalette(theme, grid.rows);
    this.paint(grid, { col0: 0, row0: 0, col1: grid.cols, row1: grid.rows });
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
      this.paint(grid, repaintRect(e));
      carves++;
    }
    // Each carve that changes cells bumps the version once and reports one crater.
    if (this.version + carves !== grid.version)
      this.paint(grid, { col0: 0, row0: 0, col1: grid.cols, row1: grid.rows });
    this.version = grid.version;
    texture.refresh();
  }

  /** Paints the cells of `rect` (clamped to the grid) into the texture. */
  private paint(grid: TerrainView, rect: CellRect): void {
    const palette = this.palette;
    const texture = this.texture;
    if (!palette || !texture) return;
    const r = clampRect(rect, grid.cols, grid.rows);
    if (r.col1 <= r.col0 || r.row1 <= r.row0) return;
    const image = texture.context.createImageData(
      r.col1 - r.col0,
      r.row1 - r.row0,
    );
    paintCells(new Uint32Array(image.data.buffer), grid, palette, r);
    texture.context.putImageData(image, r.col0, r.row0);
  }
}
