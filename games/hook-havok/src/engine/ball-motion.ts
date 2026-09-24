import { sweep } from "./collision.js";
import { MAPS, type Platform } from "./maps.js";
import {
  BALL_RADII,
  S,
  ballBounce,
  ballField,
  type Ball,
  type World,
} from "./world.js";

/** Square envelope around each orb. Stable platform order, then walls; four contacts per tick. */
export function ricochet(
  ball: Ball,
  world: World,
  intercept?: (dx: number, dy: number, terrainTime: number) => boolean,
): void {
  const r = BALL_RADII[ball.tier]!;
  const [x, y, w, h] = ballField(world.tuning.experiment, world.tuning.map);
  const solids: Platform[] = [
    ...MAPS[world.tuning.map].platforms,
    [x - 100, y - 100, 100, h + 200],
    [x + w, y - 100, 100, h + 200],
    [x, y - 100, w, 100],
    [x, y + h, w, 100],
  ].map(([px, py, pw, ph]) => [px! - r, py! - r, pw! + 2 * r, ph! + 2 * r]);
  ball.vy = Math.min(12 * S, ball.vy + S / 8);
  let remaining = 1;
  for (let i = 0; i < 4 && remaining > 0; i++) {
    const dx = Math.round(ball.vx * remaining),
      dy = Math.round(ball.vy * remaining);
    const hit = sweep(ball.x, ball.y, dx, dy, false, solids);
    if (intercept?.(dx, dy, hit?.time ?? Infinity)) return;
    if (!hit) {
      ball.x += dx;
      ball.y += dy;
      break;
    }
    ball.x += Math.round(dx * hit.time) + hit.nx;
    ball.y += Math.round(dy * hit.time) + hit.ny;
    if (hit.nx) ball.vx = -ball.vx;
    if (hit.ny)
      ball.vy =
        hit.ny < 0 ? -ballBounce(world.tuning.experiment) : Math.abs(ball.vy);
    remaining *= 1 - hit.time;
  }
}
