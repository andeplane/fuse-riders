import { sweep } from "../engine/collision.js";
import { S } from "../engine/world.js";
import type { Platform } from "../engine/maps.js";

/** Degrees tried either side of the keyboard direction, nearest first. */
const OFFSETS = [0, 5, -5, 10, -10, 15, -15];

/**
 * Keyboard aim has only eight directions, so a shot that would miss every
 * ledge bends by up to 15° onto the nearest one in range. Local intent only:
 * the chosen aim travels through ordinary replicated input.
 */
export function assistAim(
  platforms: readonly Platform[],
  x: number,
  y: number,
  dx: number,
  dy: number,
  range: number,
): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (!d) return { x: dx, y: dy };
  for (const degrees of OFFSETS) {
    const a = (degrees * Math.PI) / 180,
      ux = (dx * Math.cos(a) - dy * Math.sin(a)) / d,
      uy = (dx * Math.sin(a) + dy * Math.cos(a)) / d;
    const hit = sweep(
      Math.round(x * S),
      Math.round(y * S),
      Math.round(ux * range * S),
      Math.round(uy * range * S),
      false,
      platforms,
    );
    if (hit) return degrees ? { x: ux, y: uy } : { x: dx, y: dy };
  }
  return { x: dx, y: dy };
}
