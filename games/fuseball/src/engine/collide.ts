import { SUB, abs, clamp, delta, div, isqrt, wrap } from "./math.js";
import {
  isCircle,
  moverBoxesAt,
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

/**
 * The way out of a box along one axis for a centre `d` from the box's middle: the nearer face, unless the body would
 * come out past the field's edge on an axis that does not wrap (a floor or wall on the edge has only one open face),
 * in which case the other one. `over` is how far the centre is from that face.
 */
function wayOut(
  at: number,
  d: number,
  half: number,
  radius: number,
  size: number,
  wraps: boolean,
): { side: -1 | 1; over: number } {
  const side = d < 0 ? -1 : 1,
    over = half - abs(d);
  if (wraps) return { side, over };
  const out = at + side * (over + radius);
  if (out >= radius && out <= size - radius) return { side, over };
  return { side: side < 0 ? 1 : -1, over: half + abs(d) };
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
    // The centre is inside the box: leave by the nearest face that leads back into the field.
    const outX = wayOut(body.x, dx, box.hw, radius, WORLD_W, space.wrapX),
      outY = wayOut(body.y, dy, box.hh, radius, WORLD_H, space.wrapY);
    let into: number;
    if (outX.over < outY.over) {
      body.x += outX.side * (outX.over + radius);
      into = -outX.side * body.vx;
      if (into > 0) body.vx = outX.side * div(into * num, den) + 0;
    } else {
      body.y += outY.side * (outY.over + radius);
      into = -outY.side * body.vy;
      if (into > 0) body.vy = outY.side * div(into * num, den) + 0;
      if (outY.side < 0) touch.ground = true;
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

/**
 * A body against the ledges, straight after its own move and before the solids: it lands on one when it is coming
 * down, its centre is over the ledge, and its underside was at or above the top before the move (give or take
 * `slop`, so a nudge from a rider or a bubble does not drop it through). It then stands on the top and keeps
 * `num/den` of its fall as a bounce. Anything coming up from below, or already lower than that, is not touched.
 */
export function landLedges(
  body: Body,
  radius: number,
  ledges: readonly Box[],
  space: Space,
  num: number,
  den: number,
  slop: number,
  touch: Touch,
): void {
  if (body.vy < 0) return;
  for (const ledge of ledges) {
    const { dx, dy } = apart(body.x, body.y, ledge.cx, ledge.cy, space);
    if (abs(dx) > ledge.hw) continue;
    // How far the body's underside is below the ledge's top now, and how far it was before this move.
    const sunk = dy + radius + ledge.hh;
    if (sunk <= 0 || sunk - body.vy > slop) continue;
    body.y -= sunk;
    if (body.vy > touch.impact) touch.impact = body.vy;
    body.vy = -div(body.vy * num, den) + 0;
    touch.hit = true;
    touch.ground = true;
  }
}

/**
 * What a mover does to a body lying on it: a body whose underside is on the top of one, as the mover stood on
 * step `step − 1`, is moved as far as the mover moves by step `step`. Returns how far that was.
 */
export function carried(
  body: Body,
  radius: number,
  map: MapDef,
  step: number,
  slop: number,
): { x: number; y: number } {
  if (body.vy < 0 || map.movers.length === 0) return STILL;
  const before = moverBoxesAt(map, step - 1),
    after = moverBoxesAt(map, step);
  for (let i = 0; i < before.length; i++) {
    const was = before[i]!,
      now = after[i]!,
      { dx, dy } = apart(body.x, body.y, was.cx, was.cy, map);
    if (abs(dx) > was.hw || abs(dy + radius + was.hh) > slop) continue;
    const by = { x: now.cx - was.cx, y: now.cy - was.cy };
    body.x += by.x;
    body.y += by.y;
    return by;
  }
  return STILL;
}
const STILL: { x: number; y: number } = Object.freeze({ x: 0, y: 0 });

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
