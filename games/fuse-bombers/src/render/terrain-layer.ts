import type Phaser from "phaser";
import type { TerrainView } from "../engine/index.js";
import { groundMaterial } from "./art.js";
import type { Theme } from "./palette.js";

/** Grass/sand survives only where the surface is still within this many px of the original ground. */
const UNTOUCHED = 1.5;
/** Extra columns redrawn around a change, so the outline strokes join up. */
const MARGIN = 8;

/**
 * The destructible ground as one canvas texture. Each frame it diffs the engine's height map against the copy it
 * last drew and repaints only the changed column range: ground material below the surface, grass/sand along
 * untouched stretches and a dark outline everywhere, so craters read as bare earth.
 */
export class TerrainLayer {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private material: HTMLCanvasElement | null = null;
  private theme: Theme | null = null;
  private drawn = new Float64Array(0);
  private original = new Float64Array(0);
  private version = -1;

  constructor(
    scene: Phaser.Scene,
    width: number,
    height: number,
    depth: number,
  ) {
    // Kept across scene restarts: the texture manager is global to the game.
    const texture = scene.textures.exists("terrain")
      ? (scene.textures.get("terrain") as Phaser.Textures.CanvasTexture)
      : scene.textures.createCanvas("terrain", width, height);
    if (!texture) throw new Error("could not create the terrain texture");
    this.texture = texture;
    scene.add.image(0, 0, "terrain").setOrigin(0, 0).setDepth(depth);
  }

  /** Start a new round: remember the untouched surface and repaint everything. */
  reset(terrain: TerrainView, theme: Theme): void {
    if (theme !== this.theme)
      this.material = groundMaterial(theme, terrain.width, terrain.height);
    this.theme = theme;
    this.original = Float64Array.from(terrain.surface);
    this.drawn = Float64Array.from(terrain.surface);
    this.version = terrain.version;
    this.paint(terrain, 0, terrain.width - 1);
  }

  update(terrain: TerrainView): void {
    if (terrain.version === this.version) return;
    this.version = terrain.version;
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < terrain.width; x++) {
      const y = terrain.surface[x] ?? 0;
      if (y === this.drawn[x]) continue;
      this.drawn[x] = y;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    if (x0 >= 0) this.paint(terrain, x0, x1);
  }

  private paint(terrain: TerrainView, from: number, to: number): void {
    const theme = this.theme;
    const material = this.material;
    if (!theme || !material) return;
    const ctx = this.texture.context;
    const s = terrain.surface;
    const a = Math.max(0, from - MARGIN);
    const b = Math.min(terrain.width - 1, to + MARGIN);
    const at = (x: number): number => s[Math.min(b, Math.max(a, x))] ?? 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a, 0, b - a + 1, terrain.height);
    ctx.clip();
    ctx.clearRect(a, 0, b - a + 1, terrain.height);
    ctx.beginPath();
    ctx.moveTo(a - 4, terrain.height);
    for (let x = a - 4; x <= b + 4; x++) ctx.lineTo(x, at(x));
    ctx.lineTo(b + 4, terrain.height);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.drawImage(material, 0, 0);
    // Grass or sand along the stretches no explosion has touched yet.
    ctx.strokeStyle = theme.top;
    ctx.lineWidth = 16;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let open = false;
    for (let x = a - 4; x <= b + 4; x++) {
      const i = Math.min(b, Math.max(a, x));
      const untouched = Math.abs(at(x) - (this.original[i] ?? 0)) < UNTOUCHED;
      if (untouched && !open) ctx.moveTo(x, at(x));
      else if (untouched) ctx.lineTo(x, at(x));
      open = untouched;
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = theme.outline;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = a - 4; x <= b + 4; x++) ctx.lineTo(x, at(x));
    ctx.stroke();
    ctx.restore();
    this.texture.refresh();
  }
}
