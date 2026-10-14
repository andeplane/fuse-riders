import type { World } from "../engine/types.js";
import { hexCenter } from "./projection.js";

/** A camera destination, not a gameplay target or an AI decision. */
export function battleFocusCell(world: Readonly<World>): number | null {
  const hit = world.outcomes
    .filter((o) => o.type === "damage" && o.cell !== undefined)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.cell! - b.cell!)[0];
  if (hit) return hit.cell!;
  const structures = world.structures
    .filter((s) => s.connected)
    .sort((a, b) => a.cell - b.cell);
  let closest = Infinity;
  let cell: number | null = null;
  for (let i = 0; i < structures.length; i++) {
    const a = structures[i]!;
    const from = hexCenter(world.map.width, a.cell);
    for (let j = i + 1; j < structures.length; j++) {
      const b = structures[j]!;
      if (a.ownerId === b.ownerId) continue;
      const to = hexCenter(world.map.width, b.cell);
      const distance = (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
      if (distance < closest) {
        closest = distance;
        cell = a.cell;
      }
    }
  }
  return cell;
}
