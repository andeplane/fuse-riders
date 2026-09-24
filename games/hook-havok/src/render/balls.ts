import type Phaser from "phaser";
import type { WorldView } from "../engine/view.js";

const COLORS = [
  0xffc15a, 0x5acaff, 0xf374dc, 0x92edaf, 0xba89ff, 0x66f0e7, 0xff925e,
];
export const ballColor = (id: number): number =>
  COLORS[(id - 1) % COLORS.length]!;
/** Velocity accents use the current snapshot only: no particle or rollback history. */
export function paintBalls(
  g: Phaser.GameObjects.Graphics,
  world: WorldView,
  time: number,
  reduced: boolean,
): void {
  for (const b of world.combat.balls) {
    const color = ballColor(b.id);
    const phase = reduced ? 0 : time / 650 + b.id;
    const pulse = reduced ? 1 : 1 + Math.sin(phase * 2) * 0.06;
    if (!reduced)
      for (let i = 3; i > 0; i--) {
        g.fillStyle(color, 0.035 * (4 - i)).fillCircle(
          b.x - b.vx * i * 1.6,
          b.y - b.vy * i * 1.6,
          b.radius * (1 - i * 0.19),
        );
      }
    g.fillStyle(color, 0.07).fillCircle(b.x, b.y, b.radius * 1.45 * pulse);
    g.fillStyle(color, 0.16).fillCircle(b.x, b.y, b.radius + 5);
    g.fillStyle(0x101827, 0.94).fillCircle(b.x, b.y, b.radius);
    g.fillStyle(color, 0.26).fillCircle(b.x, b.y, b.radius - 2);
    g.lineStyle(3, color, 0.95).strokeCircle(b.x, b.y, b.radius - 1);
    g.lineStyle(1, 0xfff5de, 0.85).strokeCircle(b.x, b.y, b.radius - 4);
    for (let j = 0; j < 3; j++) {
      const a = phase + (j * Math.PI * 2) / 3;
      const x = b.x + Math.cos(a) * b.radius * 0.68;
      const y = b.y + Math.sin(a) * b.radius * 0.68;
      g.lineStyle(1.5, color, 0.8).lineBetween(b.x, b.y, x, y);
      g.fillStyle(0xfff6df, 0.95).fillCircle(x, y, 2);
    }
    g.fillStyle(color, 0.4).fillCircle(b.x, b.y, b.radius * 0.35 * pulse);
    g.fillStyle(0xfff6df, 0.9).fillCircle(b.x, b.y, b.radius * 0.12);
  }
}
