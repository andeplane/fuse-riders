import {
  BALL_RADII,
  BODY,
  HEIGHT,
  S,
  createTarget,
  type World,
} from "./world.js";
import { move } from "./collision.js";
import { MAPS } from "./maps.js";

/** Point projectile against circular hurt shapes, including a shot starting inside. */
function contact(
  x: number,
  y: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number | undefined {
  const ox = x - cx,
    oy = y - cy,
    c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy,
    b = ox * dx + oy * dy,
    discriminant = b * b - a * c;
  if (!a || discriminant < 0) return;
  const t = (-b - Math.sqrt(discriminant)) / a;
  if (t >= 0 && t <= 1) return t;
}
/** Terrain wins exact ties; ascending binary-tree IDs break entity ties. */
export interface Rival {
  id: string;
  x: number;
  feet: number;
}
export interface CombatContext {
  rivals: readonly Rival[];
  hit(id: string, vx: number, vy: number, x: number, y: number): void;
}
export function strike(
  world: World,
  dx: number,
  dy: number,
  terrainTime = Infinity,
  context?: CombatContext,
): boolean {
  const field = MAPS[world.tuning.map].ballField;
  const h = world.hook,
    c = world.combat,
    target = c.target;
  let time = terrainTime,
    id = -1;
  let rival: string | undefined;
  for (const player of context?.rivals ?? []) {
    const t = contact(h.x, h.y, dx, dy, player.x, player.feet - 28 * S, 16 * S);
    if (t !== undefined && t < time - 1e-9) {
      time = t;
      rival = player.id;
    }
  }
  if (target && !target.respawn) {
    const t = contact(h.x, h.y, dx, dy, target.x, target.feet - 28 * S, 16 * S);
    if (t !== undefined && t < time - 1e-9) {
      time = t;
      id = 0;
      rival = undefined;
    }
  }
  for (const ball of c.balls) {
    const t = contact(
      h.x,
      h.y,
      dx,
      dy,
      ball.x,
      ball.y,
      BALL_RADII[ball.tier]! * S,
    );
    if (t !== undefined && t < time - 1e-9) {
      time = t;
      id = ball.id;
      rival = undefined;
    }
  }
  if (id < 0 && rival === undefined) return false;
  h.x += Math.round(dx * time);
  h.y += Math.round(dy * time);
  if (rival !== undefined) {
    const length = Math.hypot(h.vx, h.vy) || 1;
    context!.hit(
      rival,
      Math.round((h.vx / length) * 9 * S),
      Math.min(-3 * S, Math.round((h.vy / length) * 7 * S) - 3 * S),
      h.x,
      h.y,
    );
  } else {
    c.hits = Math.min(0xffffffff, c.hits + 1);
    c.impact = { tick: world.tick, x: h.x, y: h.y };
  }
  if (rival !== undefined) {
    // Player impulses are applied together after every keeper has moved.
  } else if (id === 0 && target) {
    const length = Math.hypot(h.vx, h.vy) || 1;
    target.vx = Math.round((h.vx / length) * 9 * S);
    target.vy = Math.min(-3 * S, Math.round((h.vy / length) * 7 * S) - 3 * S);
    target.grounded = false;
  } else {
    const ball = c.balls.find((b) => b.id === id)!;
    c.balls = c.balls.filter((b) => b.id !== id);
    if (ball.tier > 0) {
      const tier = ball.tier - 1,
        radius = BALL_RADII[tier]! * S;
      for (const direction of [-1, 1])
        c.balls.push({
          id: id * 2 + (direction === 1 ? 1 : 0),
          tier,
          x: Math.max(
            field[0] * S + radius,
            Math.min(
              (field[0] + field[2]) * S - radius,
              ball.x + direction * radius,
            ),
          ),
          y: ball.y,
          vx: direction * (4 - tier) * S,
          vy: -5 * S,
        });
      c.balls.sort((a, b) => a.id - b.id);
    }
  }
  h.phase = "retracting";
  h.life = 6;
  return true;
}
export function stepCombat(world: World): void {
  const map = MAPS[world.tuning.map],
    field = map.ballField;
  const c = world.combat,
    target = c.target;
  if (target) {
    if (target.respawn) {
      if (--target.respawn === 0) c.target = createTarget(world.tuning.map);
    } else {
      target.vy = Math.min(16 * S, target.vy + S / 2);
      if (target.grounded) target.vx = Math.round(target.vx * 0.94);
      move(target, map.platforms);
      if (target.feet - BODY > HEIGHT * S) {
        target.respawn = 30;
        target.vx = target.vy = 0;
        c.falls = Math.min(0xffffffff, c.falls + 1);
      }
    }
  }
  for (const ball of c.balls) {
    const radius = BALL_RADII[ball.tier]! * S;
    ball.vy = Math.min(8 * S, ball.vy + S / 8);
    ball.x += ball.vx;
    ball.y += ball.vy;
    const left = field[0] * S + radius,
      right = (field[0] + field[2]) * S - radius;
    const top = field[1] * S + radius,
      bottom = (field[1] + field[3]) * S - radius;
    if (ball.x < left) {
      ball.x = left;
      ball.vx = Math.abs(ball.vx);
    }
    if (ball.x > right) {
      ball.x = right;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y < top) {
      ball.y = top;
      ball.vy = Math.abs(ball.vy);
    }
    if (ball.y > bottom) {
      ball.y = bottom;
      ball.vy = -5 * S;
    }
  }
}
