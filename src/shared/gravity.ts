import { GRAVITY_BEND } from "./tuning.js";
import type { GravityField } from "./state.js";
import { cos, hypot2, sin } from "./deterministic-math.js";
/**
 * How far curved space turns a heading this tick, in radians. Each hole bends by the part of its pull that lies across
 * the heading, as a sideways force would: a rider aimed at the centre or straight away from it rides on unbent, one
 * crossing the hole swings around it. `turn` is the tick's own steering, so the bend ramps and grips with the rider,
 * and the sum is capped below it. Bots plan with the same function.
 */
export function gravityBend(
  fields: ReadonlyArray<Pick<GravityField, "x" | "y" | "radius">>,
  pose: { x: number; y: number; angle: number },
  turn: number,
): number {
  if (fields.length === 0) return 0;
  const headingX = cos(pose.angle),
    headingY = sin(pose.angle);
  let bend = 0;
  for (const field of fields) {
    const toX = field.x - pose.x,
      toY = field.y - pose.y;
    const away = hypot2(toX, toY);
    if (away === 0 || away >= field.radius) continue;
    bend +=
      ((1 - away / field.radius) * (headingX * toY - headingY * toX)) / away;
  }
  return Math.max(-1, Math.min(1, bend)) * GRAVITY_BEND * turn;
}
