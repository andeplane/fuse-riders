/** Plane geometry the simulation shares. Basic arithmetic only, so every replica agrees to the bit. */

/** Slack for contact and intersection tests: below this two lengths are the same length. */
export const EPSILON = 1e-9;

export function normalizeAngle(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

export function square(value: number): number {
  return value * value;
}

/** Earliest contact of a swept prefix. Fixed iterations keep replay deterministic;
 * 32 subdivisions locate contact to much less than a pixel without advancing physics.
 * `through` may already be an earlier hit against another segment.
 */
export function firstContactTime(
  touchesPrefix: (time: number) => boolean,
  through = 1,
): number {
  if (!touchesPrefix(through)) return through;
  if (touchesPrefix(0)) return 0;
  let before = 0;
  let contact = through;
  for (let iteration = 0; iteration < 32; iteration++) {
    const middle = (before + contact) / 2;
    if (touchesPrefix(middle)) contact = middle;
    else before = middle;
  }
  return contact;
}

export function segmentDistanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(ax, ay, cx, cy, dx, dy),
    pointSegmentDistanceSquared(bx, by, cx, cy, dx, dy),
    pointSegmentDistanceSquared(cx, cy, ax, ay, bx, by),
    pointSegmentDistanceSquared(dx, dy, ax, ay, bx, by),
  );
}

export function pointSegmentDistanceSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return square(px - ax) + square(py - ay);
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
  );
  return square(px - (ax + t * dx)) + square(py - (ay + t * dy));
}

export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);
  if (
    ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))
  )
    return true;
  return (
    (Math.abs(o1) <= EPSILON && onSegment(ax, ay, bx, by, cx, cy)) ||
    (Math.abs(o2) <= EPSILON && onSegment(ax, ay, bx, by, dx, dy)) ||
    (Math.abs(o3) <= EPSILON && onSegment(cx, cy, dx, dy, ax, ay)) ||
    (Math.abs(o4) <= EPSILON && onSegment(cx, cy, dx, dy, bx, by))
  );
}

export function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  return (
    px >= Math.min(ax, bx) - EPSILON &&
    px <= Math.max(ax, bx) + EPSILON &&
    py >= Math.min(ay, by) - EPSILON &&
    py <= Math.max(ay, by) + EPSILON
  );
}
