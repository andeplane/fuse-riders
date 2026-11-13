import { SUB, abs, clamp, delta, div, isqrt, wrap } from "./math.js";
import {
  isCircle,
  type Box,
  type Circle,
  type MapDef,
  type Rect,
} from "./maps.js";
import { WORLD_H, WORLD_W } from "./tuning.js";

/**
 * Collision for round bodies: riders, the ball and bubbles are circles and solids are axis-aligned boxes. All of it
 * is integer arithmetic that plays out mirrored in a mirrored arena. On an axis that wraps, a difference is the
 * shortest way round, so a body near one edge meets what sits at the other.
 */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export type Space = Pick<MapDef, "wrapX" | "wrapY">;

/** From `(bx, by)` to `(ax, ay)`, the short way round on axes that wrap. */
export function apart(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  space: Space,
): { dx: number; dy: number } {
  return {
    dx: space.wrapX ? delta(ax - bx, WORLD_W) : ax - bx,
    dy: space.wrapY ? delta(ay - by, WORLD_H) : ay - by,
  };
}

export interface Touch {
  /** Something was touched. */
  hit: boolean;
  /** A touched surface faces up: the body is standing on it. */
  ground: boolean;
  /** The hardest speed into a surface among the touches. */
  impact: number;
}

/** Pushes a circle out of one box and turns back its speed into the surface, keeping `num/den` of it. */
function hitBox(
  body: Body,
  radius: number,
  box: Box,
  space: Space,
  num: number,
  den: number,
  touch: Touch,
): void {
  const { dx, dy } = apart(body.x, body.y, box.cx, box.cy, space);
  const ex = dx - clamp(dx, -box.hw, box.hw),
    ey = dy - clamp(dy, -box.hh, box.hh);
  if (ex === 0 && ey === 0) {
    // The centre is inside the box: leave by the nearest face.
    const overX = box.hw - abs(dx),
      overY = box.hh - abs(dy);
    let into: number;
    if (overX < overY) {
      const side = dx < 0 ? -1 : 1;
      body.x += side * (overX + radius);
      into = -side * body.vx;
      if (into > 0) body.vx = side * div(into * num, den) + 0;
    } else {
      const side = dy < 0 ? -1 : 1;
      body.y += side * (overY + radius);
      into = -side * body.vy;
      if (into > 0) body.vy = side * div(into * num, den) + 0;
      if (side < 0) touch.ground = true;
    }
    touch.hit = true;
    if (into > touch.impact) touch.impact = into;
    return;
  }
  const d2 = ex * ex + ey * ey;
  if (d2 >= radius * radius) return;
  const d = isqrt(d2),
    depth = radius - d;
  body.x += div(ex * depth, d);
  body.y += div(ey * depth, d);
  const dot = body.vx * ex + body.vy * ey;
  if (dot < 0) {
    body.vx -= div(dot * ex * (num + den), d2 * den);
    body.vy -= div(dot * ey * (num + den), d2 * den);
    const into = div(-dot, d);
    if (into > touch.impact) touch.impact = into;
  }
  touch.hit = true;
  if (ey < 0 && -ey >= abs(ex)) touch.ground = true;
}

/** Resolves a circle against every solid, twice so a corner between two of them settles. */
export function resolveSolids(
  body: Body,
  radius: number,
  boxes: readonly Box[],
  space: Space,
  num: number,
  den: number,
): Touch {
  const touch: Touch = { hit: false, ground: false, impact: 0 };
  for (let pass = 0; pass < 2; pass++)
    for (const box of boxes) hitBox(body, radius, box, space, num, den, touch);
  return touch;
}

/** Whether the point is inside a map shape (given in pixels). */
export function inShape(
  x: number,
  y: number,
  shape: Rect | Circle,
  space: Space,
): boolean {
  if (isCircle(shape)) {
    const { dx, dy } = apart(x, y, shape.x * SUB, shape.y * SUB, space),
      r = shape.r * SUB;
    return dx * dx + dy * dy < r * r;
  }
  return (
    x > shape.x * SUB &&
    x < (shape.x + shape.w) * SUB &&
    y > shape.y * SUB &&
    y < (shape.y + shape.h) * SUB
  );
}

/** Brings a body back into the field: round the seam on an axis that wraps, held inside the edge on one that does not. */
export function settle(body: Body, radius: number, space: Space): void {
  body.x = space.wrapX
    ? wrap(body.x, WORLD_W)
    : clamp(body.x, radius, WORLD_W - radius);
  body.y = space.wrapY
    ? wrap(body.y, WORLD_H)
    : clamp(body.y, radius, WORLD_H - radius);
}
