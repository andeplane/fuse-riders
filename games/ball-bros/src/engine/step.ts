import { block, circle, paddle, wall, type Contact } from "./collision.js";
import { cos, length, sin, wrap } from "./math.js";
import {
  breakBlock,
  collect,
  explode,
  spawnFrenzyBall,
  spawnPowers,
} from "./powers.js";
import {
  BALL_RADIUS,
  BALL_SPEED,
  CORE,
  COUNTDOWN,
  DT,
  formationPosition,
  LIMIT,
  paddleMotion,
  paddleScale,
  PICKUP_RADIUS,
  SUBSTEPS,
  type ArenaState,
  type Ball,
  type Base,
  type Impact,
  type Pickup,
} from "./state.js";

interface Hit extends Contact {
  kind: Impact["kind"];
  base?: Base;
  blockIndex?: number;
  pickup?: Pickup;
}
interface Translation {
  vx: number;
  vy: number;
}
const relative = (ball: Ball, move: Translation) => ({
  ...ball,
  vx: ball.vx - move.vx,
  vy: ball.vy - move.vy,
});
const moving = (contact: Contact | undefined, move: Translation) =>
  contact && {
    ...contact,
    surfaceNormal:
      (contact.surfaceNormal ?? 0) +
      contact.nx * move.vx +
      contact.ny * move.vy,
  };
function fly(
  state: ArenaState,
  ball: Ball,
  pending: Set<string>,
  events: Impact[],
  translations: ReadonlyMap<string, Translation>,
): void {
  let remaining = DT,
    elapsed = 0;
  for (let bounce = 0; bounce < 8 && remaining > 1e-8; bounce++) {
    let hit: Hit | undefined;
    const take = (
      c: Contact | undefined,
      kind: Hit["kind"],
      base?: Base,
      blockIndex?: number,
    ) => {
      if (c && (!hit || c.t < hit.t - 1e-9))
        hit = { ...c, kind, base, blockIndex };
    };
    take(wall(ball, remaining), "wall");
    if (ball.owner)
      for (const pickup of state.pickups) {
        const c =
          length(ball.x - pickup.x, ball.y - pickup.y) <=
          PICKUP_RADIUS + BALL_RADIUS
            ? { t: 0, nx: 0, ny: 0 }
            : circle(
                ball,
                pickup.x,
                pickup.y,
                PICKUP_RADIUS + BALL_RADIUS,
                remaining,
              );
        if (c && (!hit || c.t < hit.t - 1e-9))
          hit = { ...c, kind: "pickup", pickup };
      }
    for (const base of state.bases) {
      if (!base.alive) continue;
      const move = translations.get(base.id)!,
        centerX = base.x + move.vx * elapsed,
        centerY = base.y + move.vy * elapsed,
        translatedBall = relative(ball, move),
        translationSpeed = length(move.vx, move.vy),
        { omega, radialSpeed } = paddleMotion(base, translationSpeed);
      if (base.stunUntil <= state.tick)
        take(
          moving(
            paddle(
              translatedBall,
              centerX,
              centerY,
              base.angle + omega * elapsed,
              omega,
              remaining,
              base.radius + radialSpeed * elapsed,
              radialSpeed,
              paddleScale(base),
            ),
            move,
          ),
          "paddle",
          base,
        );
      base.blocks.forEach((b, i) => {
        if (b.alive)
          take(
            moving(
              block(translatedBall, centerX + b.x, centerY + b.y, remaining),
              move,
            ),
            "block",
            base,
            i,
          );
      });
      if (!pending.has(base.id))
        take(
          moving(
            circle(
              translatedBall,
              centerX,
              centerY,
              CORE + BALL_RADIUS,
              remaining,
            ),
            move,
          ),
          "core",
          base,
        );
    }
    const dt = hit?.t ?? remaining;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    remaining -= dt;
    elapsed += dt;
    if (!hit) break;
    const h: Hit = hit;
    if (h.pickup) {
      collect(state, ball, h.pickup, events);
      continue;
    }
    if (h.kind === "core" && h.base) pending.add(h.base.id);
    const centers = new Map(
      state.bases.map((base) => {
        const move = translations.get(base.id)!;
        return [
          base.id,
          { x: base.x + move.vx * elapsed, y: base.y + move.vy * elapsed },
        ] as const;
      }),
    );
    if (h.kind === "block" && h.base && h.blockIndex !== undefined) {
      breakBlock(state, ball, h.base, h.blockIndex);
      if (ball.bomb) explode(state, ball, events, undefined, centers);
    }
    const dot = ball.vx * h.nx + ball.vy * h.ny - (h.surfaceNormal ?? 0);
    ball.vx -= 2 * dot * h.nx;
    ball.vy -= 2 * dot * h.ny;
    if (h.kind === "paddle" && h.base) {
      const bomb = ball.bomb;
      if (bomb) explode(state, ball, events, h.base, centers);
      ball.owner = h.base.id;
      h.base.saves++;
      if (
        !bomb &&
        h.base.stickyUntil > state.tick &&
        !state.balls.some((b) => b.held === h.base!.id)
      ) {
        ball.held = h.base.id;
        ball.heldUntil = state.tick + 60;
        ball.vx = ball.vy = 0;
        events.push({
          kind: "paddle",
          x: ball.x,
          y: ball.y,
          slot: h.base.slot,
        });
        return;
      }
      // Modest spin; contact reflection includes the moving surface's velocity.
      ball.vx += -h.ny * h.base.steer * 55;
      ball.vy += h.nx * h.base.steer * 55;
    }
    const speed = BALL_SPEED,
      magnitude = length(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / magnitude) * speed;
    ball.vy = (ball.vy / magnitude) * speed;
    if (h.kind === "paddle") {
      // Enforce separation AFTER speed normalization, including radial/tip motion.
      const minimum = Math.max(80, (h.surfaceNormal ?? 0) + 20);
      if (ball.vx * h.nx + ball.vy * h.ny < minimum) {
        const tangent =
          (Math.sign(-ball.vx * h.ny + ball.vy * h.nx) || 1) *
          Math.sqrt(speed * speed - minimum * minimum);
        ball.vx = h.nx * minimum - h.ny * tangent;
        ball.vy = h.ny * minimum + h.nx * tangent;
      }
    }
    ball.x += h.nx * 0.002;
    ball.y += h.ny * 0.002;
    events.push({
      kind: h.kind,
      x: ball.x,
      y: ball.y,
      slot: h.base?.slot ?? -1,
    });
  }
}

export function step(state: ArenaState): Impact[] {
  if (state.phase === "over") return [];
  state.tick++;
  if (state.tick >= COUNTDOWN) state.phase = "playing";
  spawnPowers(state);
  const events: Impact[] = [];
  if (spawnFrenzyBall(state))
    events.push({
      kind: "frenzy",
      x: 500,
      y: 500,
      slot: -1,
    });
  for (let sub = 0; sub < SUBSTEPS; sub++) {
    const translations = new Map<string, Translation>();
    state.bases.forEach((base, index) => {
      const start = formationPosition(
          state.bases.length,
          index,
          state.formationStep,
        ),
        end = formationPosition(
          state.bases.length,
          index,
          state.formationStep + 1,
        );
      base.x = start.x;
      base.y = start.y;
      translations.set(base.id, {
        vx: (end.x - start.x) / DT,
        vy: (end.y - start.y) / DT,
      });
    });
    const pending = new Set<string>();
    for (const ball of [...state.balls]) {
      if (ball.held) {
        const base = state.bases.find((b) => b.id === ball.held)!;
        ball.x = base.x + cos(base.angle) * (base.radius + 13);
        ball.y = base.y + sin(base.angle) * (base.radius + 13);
        if (
          state.phase === "playing" &&
          (base.launch || state.tick >= ball.heldUntil)
        ) {
          ball.held = null;
          ball.vx = cos(base.angle) * BALL_SPEED;
          ball.vy = sin(base.angle) * BALL_SPEED;
          events.push({
            kind: "launch",
            x: ball.x,
            y: ball.y,
            slot: base.slot,
          });
        }
      }
      if (!ball.held && state.phase === "playing")
        fly(state, ball, pending, events, translations);
    }
    for (const base of state.bases) {
      if (pending.has(base.id)) {
        base.alive = false;
        base.steer = 0;
        base.radial = 0;
        base.blocks.forEach((b) => (b.alive = false));
      }
      if (base.alive) {
        const translation = translations.get(base.id)!,
          motion = paddleMotion(base, length(translation.vx, translation.vy));
        base.angle = wrap(base.angle + motion.omega * DT);
        base.radius = motion.radius;
      }
      const index = state.bases.indexOf(base),
        end = formationPosition(
          state.bases.length,
          index,
          state.formationStep + 1,
        );
      base.x = end.x;
      base.y = end.y;
    }
    state.formationStep++;
    for (const ball of state.balls) {
      if (ball.owner && pending.has(ball.owner)) ball.owner = null;
      if (ball.held && pending.has(ball.held)) {
        ball.held = null;
        ball.vx = BALL_SPEED;
        ball.vy = 0;
      }
      if (ball.held) {
        const base = state.bases.find((b) => b.id === ball.held)!;
        ball.x = base.x + cos(base.angle) * (base.radius + 13);
        ball.y = base.y + sin(base.angle) * (base.radius + 13);
      }
    }
    const alive = state.bases.filter((b) => b.alive);
    if (alive.length <= 1) {
      state.phase = "over";
      state.winner = alive[0]?.id ?? null;
      break;
    }
  }
  state.bases.forEach((b) => (b.launch = false));
  if (state.tick >= LIMIT + COUNTDOWN) {
    state.phase = "over";
    state.winner = null;
  }
  return events;
}
