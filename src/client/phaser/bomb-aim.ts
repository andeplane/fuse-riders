import type Phaser from "phaser";

/** Cosmetic guide only: callers retain ownership of landing positions. */
export function drawBombAim(
  graphics: Phaser.GameObjects.Graphics,
  origin: { x: number; y: number },
  target: { x: number; y: number },
  tint: number,
): void {
  const { x, y } = target;
  const length = Math.hypot(x - origin.x, y - origin.y);
  const dx = length > 0 ? (x - origin.x) / length : 0;
  const dy = length > 0 ? (y - origin.y) / length : 0;
  const start = 32;
  const end = length - 28;
  const arrows = end - start > 130 ? [0.38, 0.72] : [];

  // Wide translucent strokes supply the same restrained glow on Canvas and WebGL.
  for (const [width, alpha] of [
    [7, 0.07],
    [4, 0.16],
    [2, 0.95],
  ]) {
    graphics.lineStyle(width, tint, alpha).beginPath();
    for (let distance = start; distance < end; distance += 22) {
      const tip = Math.min(distance + 12, end);
      graphics
        .moveTo(origin.x + dx * distance, origin.y + dy * distance)
        .lineTo(origin.x + dx * tip, origin.y + dy * tip);
    }
    for (const fraction of arrows) {
      const distance = start + (end - start) * fraction;
      for (const offset of [-4, 4]) {
        const ax = origin.x + dx * (distance + offset);
        const ay = origin.y + dy * (distance + offset);
        graphics
          .moveTo(ax - dx * 5 - dy * 6, ay - dy * 5 + dx * 6)
          .lineTo(ax, ay)
          .lineTo(ax - dx * 5 + dy * 6, ay - dy * 5 - dx * 6);
      }
    }
    // Four open corners leave the landing point visible even in a dense volley.
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        graphics
          .moveTo(x + sx * 7, y + sy * 18)
          .lineTo(x + sx * 14, y + sy * 18)
          .lineTo(x + sx * 18, y + sy * 14)
          .lineTo(x + sx * 18, y + sy * 7);
    graphics.strokePath();
  }
  graphics.fillStyle(tint, 0.16).fillCircle(x, y, 6);
  graphics.fillStyle(0xffffff, 0.98).fillCircle(x, y, 3);
}
