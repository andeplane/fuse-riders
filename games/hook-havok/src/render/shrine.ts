import Phaser from "phaser";
import type { Crop } from "./assets.js";

export interface ShrineDressing {
  candles: { x: number; y: number; glow: Phaser.GameObjects.Image }[];
  banners: Phaser.GameObjects.Image[];
}

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
  candlesAt: readonly number[] = [27, width - 27],
): ShrineDressing {
  const result: ShrineDressing = { candles: [], banners: [] };
  const candles = frames[3]!;
  for (const offset of candlesAt) {
    const px = x + offset;
    terrain.add(
      scene.add
        .image(px, y + 1, "shrine", "3")
        .setName("shrine-candles")
        .setOrigin(0.5, 1)
        .setDisplaySize(40, (40 * candles.height) / candles.width),
    );
    const glow = scene.add
      .image(px, y - 8, "warm")
      .setDisplaySize(72, 60)
      .setAlpha(0.35);
    terrain.add(glow);
    result.candles.push({
      x: px,
      y: y + 2 - (40 * candles.height) / candles.width,
      glow,
    });
  }
  if (hanging) {
    const banner = frames[2]!;
    const ornament = scene.add
      .image(x + width / 2, y + height - 7, "shrine", "2")
      .setName("shrine-banner")
      .setOrigin(0.5, 0)
      .setDisplaySize((65 * banner.width) / banner.height, 65);
    terrain.add(ornament);
    result.banners.push(ornament);
  }
  const edge = scene.add.graphics();
  edge
    .lineStyle(2, 0xe2d2b3, 0.85)
    .lineBetween(x + 2, y + 1, x + width - 2, y + 1);
  terrain.add(edge);
  return result;
}

/** Fixed-size decorative work only, driven by the scene's existing presentation clock. */
export function animateShrine(
  graphics: Phaser.GameObjects.Graphics,
  dressing: readonly ShrineDressing[],
  ms: number,
  animate: boolean,
): void {
  graphics.clear();
  const time = animate ? ms : 0;
  let candleIndex = 0;
  for (const [index, part] of dressing.entries()) {
    for (const banner of part.banners)
      banner.setRotation(
        animate ? Math.sin(time / 2400 + index * 1.7) * 0.012 : 0,
      );
    for (const { x, y, glow } of part.candles) {
      const phase = candleIndex++ * 2.3;
      const flicker = animate
        ? Math.sin(time / 170 + phase) * Math.sin(time / 310 + phase)
        : 0;
      glow.setAlpha(0.35 + flicker * 0.065);
      graphics
        .fillStyle(0xffedba, 0.65)
        .fillEllipse(x, y + 2, 1.8, 3 + flicker);
      if (!animate) continue;
      // One short ember per cluster, with staggered rests; no accumulated particle state.
      const age = ((time / 2200 + phase) % 3) / 3;
      if (age < 0.45)
        graphics
          .fillStyle(0xffc879, (1 - age / 0.45) * 0.35)
          .fillCircle(x + Math.sin(age * 8 + phase) * 4, y - age * 42, 0.9);
    }
  }
  if (animate && dressing.length)
    for (let i = 0; i < 12; i++) {
      const x = 45 + ((i * 137) % 1500);
      const y = (i * 79 + time * 0.012) % 900;
      graphics
        .fillStyle(0xa8b2c5, 0.2)
        .fillCircle(x + Math.sin(time / 3500 + i) * 12, y, 0.8);
    }
}
