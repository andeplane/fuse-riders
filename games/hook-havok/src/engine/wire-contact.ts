import { sweep } from "./collision.js";
import { MAPS } from "./maps.js";
import { BODY, S, type World } from "./world.js";

export function activeWire(
  owner: World,
): { x: number; y: number; endX: number; endY: number } | undefined {
  const h = owner.hook;
  if (
    owner.tuning.wire !== "spiked" ||
    owner.respawn ||
    !owner.input.fire ||
    (h.phase !== "flying" && h.phase !== "attached")
  )
    return;
  const sx = owner.x,
    sy = owner.feet - Math.round(BODY * 0.6);
  if (
    MAPS[owner.tuning.map].platforms.some(
      ([x, y, w, height]) =>
        sx > x * S && sx < (x + w) * S && sy > y * S && sy < (y + height) * S,
    )
  )
    return;
  let ex = h.x - sx,
    ey = h.y - sy;
  const obstruction = sweep(
    sx,
    sy,
    ex,
    ey,
    false,
    MAPS[owner.tuning.map].platforms,
  );
  if (obstruction) {
    ex *= obstruction.time;
    ey *= obstruction.time;
  }
  const length = Math.hypot(ex, ey);
  if (length < S) return;
  return { x: sx, y: sy, endX: sx + ex, endY: sy + ey };
}
/** Moving ball centre against a closed capsule (wire spine plus its two endpoints). */
export function wireContact(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  owner: World,
): number | undefined {
  const wire = activeWire(owner);
  if (!wire) return;
  const sx = wire.x,
    sy = wire.y,
    ex = wire.endX - sx,
    ey = wire.endY - sy;
  const length = Math.hypot(ex, ey);
  const ux = ex / length,
    uy = ey / length;
  const along = (x - sx) * ux + (y - sy) * uy;
  const across = -(x - sx) * uy + (y - sy) * ux;
  const va = dx * ux + dy * uy,
    vc = -dx * uy + dy * ux;
  const r = radius + 3 * S;
  const nearest = Math.max(0, Math.min(length, along));
  if ((along - nearest) ** 2 + across ** 2 <= r * r) return 0;
  let first = Infinity;
  if (vc)
    for (const edge of [-r, r]) {
      const t = (edge - across) / vc,
        a = along + va * t;
      if (t >= 0 && t <= 1 && a >= 0 && a <= length) first = Math.min(first, t);
    }
  const speed = va * va + vc * vc;
  if (speed)
    for (const end of [0, length]) {
      const a = along - end,
        b = a * va + across * vc;
      const discriminant = b * b - speed * (a * a + across * across - r * r);
      if (discriminant < 0) continue;
      const t = (-b - Math.sqrt(discriminant)) / speed;
      if (t >= 0 && t <= 1) first = Math.min(first, t);
    }
  return Number.isFinite(first) ? first : undefined;
}
