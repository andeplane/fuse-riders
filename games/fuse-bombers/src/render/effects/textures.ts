import type Phaser from "phaser";

type Paint = (ctx: CanvasRenderingContext2D, size: number) => void;

const TEXTURES: Record<string, readonly [number, Paint]> = {
  /** Soft round puff: smoke, fireballs, flashes. */
  "fx-puff": [
    32,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
  ],
  /** A brick or clod with a shaded edge and a dark outline. */
  "fx-chunk": [
    12,
    (ctx) => {
      ctx.fillStyle = "#262a36";
      ctx.fillRect(0, 0, 12, 12);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(1.5, 1.5, 9, 9);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(1.5, 7.5, 9, 3);
    },
  ],
  /** Thin ring: shield ripples and shockwaves. */
  "fx-ring": [
    64,
    (ctx, s) => {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
      ctx.stroke();
    },
  ],
  /** Solid white, scaled into gate and screen flashes. */
  "fx-px": [
    4,
    (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 4, 4);
    },
  ],
};

/** Paints the effect textures once per game (they are white; effects tint them). */
export function addFxTextures(scene: Phaser.Scene): void {
  for (const [key, [size, paint]] of Object.entries(TEXTURES)) {
    if (scene.textures.exists(key)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    paint(ctx, size);
    scene.textures.addCanvas(key, canvas);
  }
}
