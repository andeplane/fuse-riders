import { angleDelta, atan2, length } from "./math.js";
import {
  type ArenaState,
  type Base,
  type Control,
  PADDLE,
  PADDLE_MIN,
  PADDLE_MAX,
  COUNTDOWN,
  formationPosition,
  DT,
} from "./state.js";

/** Limited look-ahead, ordinary controls, no privileged movement or collision rules. */
export function botControl(state: ArenaState, base: Base): Control {
  const index = state.bases.indexOf(base),
    next = formationPosition(
      state.bases.length,
      index,
      state.formationStep + 1,
    ),
    baseVx = (next.x - base.x) / DT,
    baseVy = (next.y - base.y) / DT;
  let target = atan2(500 - base.y, 500 - base.x),
    earliest = Infinity;
  for (const ball of state.balls) {
    if (ball.held) continue;
    const dx = ball.x - base.x,
      dy = ball.y - base.y;
    const vx = ball.vx - baseVx,
      vy = ball.vy - baseVy,
      speed2 = vx * vx + vy * vy;
    if (!speed2) continue;
    const t = -(dx * vx + dy * vy) / speed2;
    if (t < 0 || t > 1.1 || t >= earliest) continue;
    if (length(dx + vx * t, dy + vy * t) > PADDLE_MAX + 16) continue;
    earliest = t;
    const intercept = Math.max(0, t - base.radius / Math.sqrt(speed2));
    target = atan2(dy + vy * intercept, dx + vx * intercept);
  }
  const delta = angleDelta(target, base.angle);
  const desiredRadius =
    earliest < 0.65
      ? Math.abs(delta) < 0.35
        ? PADDLE_MAX
        : PADDLE_MIN
      : PADDLE;
  return {
    steer: Math.abs(delta) < 0.09 ? 0 : delta < 0 ? -1 : 1,
    radial:
      Math.abs(desiredRadius - base.radius) < 3
        ? 0
        : desiredRadius < base.radius
          ? -1
          : 1,
    launch: state.tick >= COUNTDOWN + 10 + base.slot * 7,
  };
}
