import type Phaser from "phaser";
import type { WorldView } from "../engine/view.js";
/** Two fixed rune pads; animation is cosmetic and cooldown comes from the engine view. */
export function paintPowerUps(
  g: Phaser.GameObjects.Graphics,
  pickups: WorldView["pickups"],
  ms: number,
  reduced: boolean,
): void {
  for (const p of pickups) {
    const color = p.kind === "lift" ? 0x96f1b9 : 0x89d9ff;
    const active = p.cooldown === 0;
    const y = p.y + (active && !reduced ? Math.sin(ms / 500 + p.x) * 3 : 0);
    g.lineStyle(2, color, active ? 0.65 : 0.22).strokeEllipse(
      p.x,
      p.y + 27,
      46,
      9,
    );
    g.fillStyle(color, active ? 0.12 : 0.03).fillCircle(p.x, y, 25);
    g.lineStyle(2, color, active ? 1 : 0.2).strokeCircle(p.x, y, 18);
    if (!active) continue;
    g.lineStyle(3, 0xefffe6, 0.95);
    if (p.kind === "lift") {
      for (const offset of [-3, 5])
        g.lineBetween(p.x - 8, y + offset, p.x, y - 7 + offset).lineBetween(
          p.x,
          y - 7 + offset,
          p.x + 8,
          y + offset,
        );
    } else {
      g.beginPath()
        .moveTo(p.x - 9, y - 8)
        .lineTo(p.x + 9, y - 8)
        .lineTo(p.x + 7, y + 3)
        .lineTo(p.x, y + 10)
        .lineTo(p.x - 7, y + 3)
        .closePath()
        .strokePath();
    }
  }
}
