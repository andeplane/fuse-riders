import type { TrailSegment } from './protocol.js';
import { sin, cos, atan2, hypot2 } from './deterministic-math.js';
export const GUN_SPEED = 300;
export const GUN_RADIUS = 14;
export const GUN_HOLE_RADIUS = 50;
export const GUN_HOMING_RADIUS = 220;
export const GUN_TURN_PER_TICK = .03;
export const GUN_LIFETIME_TICKS = 60;
export function gunVelocity(x: number, y: number, vx: number, vy: number, targets: readonly { x: number; y: number }[]): { vx: number; vy: number } {
  const heading = atan2(vy, vx);
  let closest = GUN_HOMING_RADIUS; let correction = 0;
  for (const target of targets) {
    const distance = hypot2(target.x - x, target.y - y);
    const angle = atan2(target.y - y, target.x - x) - heading;
    const delta = atan2(sin(angle), cos(angle));
    if (distance < closest && Math.abs(delta) < Math.PI / 2) { closest = distance; correction = delta; }
  }
  const angle = heading + Math.max(-GUN_TURN_PER_TICK, Math.min(GUN_TURN_PER_TICK, correction));
  return { vx: cos(angle) * GUN_SPEED, vy: sin(angle) * GUN_SPEED };
}
/** Keep the portions outside the impact disk, retaining expiry and ownership metadata. */
export function cutTrailHole(trail: TrailSegment, x: number, y: number, radius: number): TrailSegment[] {
  const dx = trail.x2 - trail.x1; const dy = trail.y2 - trail.y1;
  const px = trail.x1 - x; const py = trail.y1 - y;
  const a = dx * dx + dy * dy; const c = px * px + py * py - radius * radius;
  if (a === 0) return c <= 0 ? [] : [trail];
  const b = 2 * (px * dx + py * dy); const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return [trail];
  const from = Math.max(0, (-b - Math.sqrt(discriminant)) / (2 * a));
  const to = Math.min(1, (-b + Math.sqrt(discriminant)) / (2 * a));
  if (from >= to) return [trail];
  const result: TrailSegment[] = [];
  if (from > 0) result.push({ ...trail, x2: trail.x1 + dx * from, y2: trail.y1 + dy * from });
  if (to < 1) result.push({ ...trail, x1: trail.x1 + dx * to, y1: trail.y1 + dy * to });
  return result;
}
