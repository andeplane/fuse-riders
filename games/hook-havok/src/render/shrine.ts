import Phaser from "phaser";
import type { Crop } from "./assets.js";

/** Assemble stone at a fixed vertical scale; preserve end caps and repeat the middle. */
export function shrineLedge(
  scene: Phaser.Scene,
  crop: Crop,
  variant: number,
  width: number,
  height: number,
): string {
  const key = `shrine-${variant}-${width}-${height}`;
  if (scene.textures.exists(key)) return key;
  const source = scene.textures.get("shrine").getSourceImage();
  if (!(source instanceof HTMLImageElement))
    throw new Error("Cannot read shrine artwork.");
  // Two backing pixels per world unit; the original source remains untouched.
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * 2);
  canvas.height = Math.ceil(height * 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot prepare shrine stonework.");
  const scale = canvas.height / crop.height;
  const cap = Math.floor(crop.width * 0.2);
  const capWidth = Math.min(canvas.width / 3, cap * scale);
  const middle = crop.width - cap * 2;
  const middleWidth = middle * scale;
  context.drawImage(
    source,
    crop.x,
    crop.y,
    cap,
    crop.height,
    0,
    0,
    capWidth,
    canvas.height,
  );
  for (let x = capWidth; x < canvas.width - capWidth; x += middleWidth) {
    const span = Math.min(middleWidth, canvas.width - capWidth - x);
    context.drawImage(
      source,
      crop.x + cap,
      crop.y,
      span / scale,
      crop.height,
      x,
      0,
      span,
      canvas.height,
    );
  }
  context.drawImage(
    source,
    crop.x + crop.width - cap,
    crop.y,
    cap,
    crop.height,
    canvas.width - capWidth,
    0,
    capWidth,
    canvas.height,
  );
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** Props have no collision meaning and remain within the space between ledges. */
export function dressShrine(
  scene: Phaser.Scene,
  terrain: Phaser.GameObjects.Container,
  frames: readonly Crop[],
  x: number,
  y: number,
  width: number,
  height: number,
  hanging: boolean,
): void {
  const candles = frames[3]!;
  for (const px of [x + 27, x + width - 27]) {
    terrain.add(
      scene.add
        .image(px, y + 1, "shrine", "3")
        .setName("shrine-candles")
        .setOrigin(0.5, 1)
        .setDisplaySize(40, (40 * candles.height) / candles.width),
    );
    terrain.add(
      scene.add
        .image(px, y - 8, "warm")
        .setDisplaySize(72, 60)
        .setAlpha(0.35),
    );
  }
  if (hanging) {
    const banner = frames[2]!;
    terrain.add(
      scene.add
        .image(x + width / 2, y + height - 7, "shrine", "2")
        .setName("shrine-banner")
        .setOrigin(0.5, 0)
        .setDisplaySize((65 * banner.width) / banner.height, 65),
    );
  }
  const edge = scene.add.graphics();
  edge
    .lineStyle(2, 0xe2d2b3, 0.85)
    .lineBetween(x + 2, y + 1, x + width - 2, y + 1);
  terrain.add(edge);
}
