import { angleDelta, atan2, cos, length, sin } from "./math.js";
import {
  ARENA,
  CENTER,
  WALLS,
  BALL_RADIUS,
  PADDLE,
  PADDLE_THICK,
  paddleHalf,
} from "./state.js";

export interface Motion {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface Contact {
  t: number;
  nx: number;
  ny: number;
  surfaceNormal?: number;
}

export function wall(m: Motion, seconds: number): Contact | undefined {
  let best: Contact | undefined;
  for (const n of WALLS) {
    const speed = m.vx * n.x + m.vy * n.y;
    if (speed <= 0) continue;
    const distance =
      ARENA - BALL_RADIUS - ((m.x - CENTER) * n.x + (m.y - CENTER) * n.y);
    const t = Math.max(0, distance / speed);
    if (t <= seconds && (!best || t < best.t)) best = { t, nx: -n.x, ny: -n.y };
  }
  return best;
}

/** Moving point against a circle; inside=true is an enclosing arena. */
export function circle(
  m: Motion,
  x: number,
  y: number,
  r: number,
  seconds: number,
  inside = false,
): Contact | undefined {
  const dx = m.x - x,
    dy = m.y - y,
    a = m.vx * m.vx + m.vy * m.vy;
  if (a === 0) return;
  const b = dx * m.vx + dy * m.vy,
    c = dx * dx + dy * dy - r * r;
  const d = b * b - a * c;
  if (d < 0) return;
  const t = (-b + (inside ? 1 : -1) * Math.sqrt(d)) / a;
  if (t < -1e-8 || t > seconds) return;
  const tx = dx + m.vx * Math.max(0, t),
    ty = dy + m.vy * Math.max(0, t);
  const n = length(tx, ty) || 1,
    sign = inside ? -1 : 1;
  return { t: Math.max(0, t), nx: (sign * tx) / n, ny: (sign * ty) / n };
}

/** Circle vs square: flat faces and circular corners, not a padded AABB's false corners. */
export function block(
  m: Motion,
  x: number,
  y: number,
  seconds: number,
): Contact | undefined {
  let best: Contact | undefined;
  const take = (c: Contact | undefined) => {
    if (c && (!best || c.t < best.t)) best = c;
  };
  for (const sign of [-1, 1]) {
    if (m.vx * sign < 0) {
      const t = (x + sign * (6 + BALL_RADIUS) - m.x) / m.vx;
      if (t >= 0 && t <= seconds && Math.abs(m.y + m.vy * t - y) <= 6)
        take({ t, nx: sign, ny: 0 });
    }
    if (m.vy * sign < 0) {
      const t = (y + sign * (6 + BALL_RADIUS) - m.y) / m.vy;
      if (t >= 0 && t <= seconds && Math.abs(m.x + m.vx * t - x) <= 6)
        take({ t, nx: 0, ny: sign });
    }
    for (const sy of [-1, 1])
      take(circle(m, x + sign * 6, y + sy * 6, BALL_RADIUS, seconds));
  }
  return best;
}

/** Conservative advancement against a rotating thick arc, including its rounded endpoints.
 * The speed bound includes paddle rotation, so the arc cannot skip across a stationary ball.
 */
export function paddle(
  m: Motion,
  x: number,
  y: number,
  angle: number,
  omega: number,
  seconds: number,
  radius = PADDLE,
  radialSpeed = 0,
  scale = 1,
): Contact | undefined {
  const bound =
    length(m.vx, m.vy) +
    Math.abs(omega) * (radius + Math.abs(radialSpeed) * seconds) +
    Math.abs(radialSpeed) *
      (1 + paddleHalf(Math.min(radius, radius + radialSpeed * seconds)));
  if (!bound) return;
  let t = 0;
  for (let iteration = 0; iteration < 64; iteration++) {
    const px = m.x + m.vx * t - x,
      py = m.y + m.vy * t - y;
    const center = angle + omega * t;
    const r = radius + radialSpeed * t;
    const half = paddleHalf(r) * scale;
    const delta = angleDelta(atan2(py, px), center);
    const nearest = center + Math.max(-half, Math.min(half, delta));
    const qx = cos(nearest) * r,
      qy = sin(nearest) * r;
    const dx = px - qx,
      dy = py - qy,
      dist = length(dx, dy);
    const nx = dx / (dist || 1),
      ny = dy / (dist || 1);
    const gap = dist - BALL_RADIUS - PADDLE_THICK;
    if (gap <= 0.0001) {
      const edgeOmega =
        Math.abs(delta) > half
          ? omega - (Math.sign(delta) * half * radialSpeed) / r
          : omega;
      const surfaceNormal =
        (-edgeOmega * qy + (radialSpeed * qx) / r) * nx +
        (edgeOmega * qx + (radialSpeed * qy) / r) * ny;
      const approach = m.vx * nx + m.vy * ny - surfaceNormal;
      return approach < -0.0001 ? { t, nx, ny, surfaceNormal } : undefined;
    }
    t += gap / bound;
    if (t > seconds) return;
  }
  return;
}
