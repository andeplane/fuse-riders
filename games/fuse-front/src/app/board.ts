/**
 * TEMPORARY placeholder board: draws the `WorldView` as flat coloured tiles, flags, buildings, units and heroes so a
 * match is playable end to end. The renderer PR replaces this file with the pixel-art scene; nothing else should
 * grow on it.
 */
import { SUB, TILE_PX, type WorldView } from "../engine/index.js";

export const CELL = 10;
const TEAM = ["#e8483c", "#4a86f0"];
const NEUTRAL = "#b8b0a0";
const GROUND: Record<string, string> = {
  ".": "#5a5038",
  "#": "#2c2820",
  "~": "#1f3c5a",
  "=": "#7a6440",
  "^": "#3c3428",
};
const color = (team: number) => TEAM[team] ?? NEUTRAL;
/** Sub-pixels to canvas pixels. */
const px = (v: number) => (v / (SUB * TILE_PX)) * CELL;

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  world: WorldView,
  self: number,
): void {
  const { width, height } = world;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = GROUND[world.terrain[y]![x]!] ?? "#000";
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      const owner = world.sectorOwners[world.sectorOf[y * width + x]!] ?? -1;
      if (owner >= 0) {
        ctx.fillStyle = color(owner % 2);
        ctx.globalAlpha = 0.14;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        ctx.globalAlpha = 1;
      }
    }
  for (const b of world.buildings) {
    ctx.fillStyle = b.hp > 0 ? color(b.team) : "#444";
    ctx.fillRect(b.x * CELL - 6, b.y * CELL - 6, CELL + 12, CELL + 12);
    ctx.fillStyle = "#111";
    ctx.fillRect(b.x * CELL - 6, b.y * CELL + CELL + 8, CELL + 12, 3);
    ctx.fillStyle = "#7cfc5a";
    ctx.fillRect(
      b.x * CELL - 6,
      b.y * CELL + CELL + 8,
      ((CELL + 12) * b.hp) / b.maxHp,
      3,
    );
  }
  for (const f of world.flags) {
    ctx.fillStyle = "#ddd";
    ctx.fillRect(f.x * CELL + 4, f.y * CELL - 8, 2, 18);
    ctx.fillStyle = color(f.team);
    ctx.fillRect(f.x * CELL + 6, f.y * CELL - 8, 9, 6);
  }
  for (const u of world.units) {
    ctx.fillStyle = color(u.team);
    const r = u.kind === "lightTank" ? 4 : 2.5;
    ctx.fillRect(px(u.x) - r, px(u.y) - r, r * 2, r * 2);
  }
  for (const h of world.heroes) {
    if (h.hp <= 0) continue;
    ctx.beginPath();
    ctx.arc(px(h.x), px(h.y), 6, 0, Math.PI * 2);
    ctx.fillStyle = color(h.team);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = h.seat === self ? "#f8d030" : "#111";
    ctx.stroke();
  }
}
