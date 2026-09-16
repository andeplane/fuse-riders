import type { TrailSegment } from './protocol.js';
/** Hitscan geometry; tracer lifetime is presentation only. */
export const GUN_RADIUS = 2;
export const GUN_HOLE_RADIUS = 14;
export const GUN_HEADSHOT_RADIUS = 18;
export const GUN_TRACER_TICKS = 3;
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
