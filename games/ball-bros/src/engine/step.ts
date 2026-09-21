import { block, circle, paddle, type Contact } from "./collision.js";
import { cos, length, sin, wrap } from "./math.js";
import {
  ARENA,
  AUTO_LAUNCH,
  BALL_RADIUS,
  BALL_SPEED,
  CENTER,
  CORE,
  COUNTDOWN,
  DT,
  LIMIT,
  PADDLE,
  SUBSTEPS,
  TURN_SPEED,
  type ArenaState,
  type Ball,
  type Base,
  type Impact,
} from "./state.js";

interface Hit extends Contact {
  kind: Impact["kind"];
  base?: Base;
  blockIndex?: number;
}
function fly(
  state: ArenaState,
  ball: Ball,
  pending: Set<string>,
  events: Impact[],
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
    take(
      circle(ball, CENTER, CENTER, ARENA - BALL_RADIUS, remaining, true),
      "wall",
    );
    for (const base of state.bases) {
      if (!base.alive) continue;
      const omega = base.steer * TURN_SPEED;
      take(
        paddle(
          ball,
          base.x,
          base.y,
          base.angle + omega * elapsed,
          omega,
          remaining,
        ),
        "paddle",
        base,
      );
      base.blocks.forEach((b, i) => {
        if (b.alive)
          take(
            block(ball, base.x + b.x, base.y + b.y, remaining),
            "block",
            base,
            i,
          );
      });
      if (!pending.has(base.id))
        take(
          circle(ball, base.x, base.y, CORE + BALL_RADIUS, remaining),
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
    if (h.kind === "core" && h.base) pending.add(h.base.id);
    if (h.kind === "block" && h.base && h.blockIndex !== undefined) {
      h.base.blocks[h.blockIndex]!.alive = false;
      const attacker = state.bases.find((b) => b.id === ball.owner);
      if (attacker && attacker.id !== h.base.id) attacker.broken++;
    }
    const dot = ball.vx * h.nx + ball.vy * h.ny;
    ball.vx -= 2 * dot * h.nx;
    ball.vy -= 2 * dot * h.ny;
    if (h.kind === "paddle" && h.base) {
      ball.owner = h.base.id;
      h.base.saves++;
      // Modest spin; normalize and retain an outward normal component at edge contacts.
      ball.vx += -h.ny * h.base.steer * 55;
      ball.vy += h.nx * h.base.steer * 55;
      const outward = ball.vx * h.nx + ball.vy * h.ny;
      if (outward < 80) {
        ball.vx += h.nx * (80 - outward);
        ball.vy += h.ny * (80 - outward);
      }
    }
    const speed = BALL_SPEED,
      magnitude = length(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / magnitude) * speed;
    ball.vy = (ball.vy / magnitude) * speed;
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
  const events: Impact[] = [];
  for (let sub = 0; sub < SUBSTEPS; sub++) {
    const pending = new Set<string>();
    for (const ball of state.balls) {
      if (ball.held) {
        const base = state.bases.find((b) => b.id === ball.held)!;
        ball.x = base.x + cos(base.angle) * (PADDLE + 13);
        ball.y = base.y + sin(base.angle) * (PADDLE + 13);
        if (
          state.phase === "playing" &&
          (base.launch || state.tick >= COUNTDOWN + AUTO_LAUNCH)
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
        fly(state, ball, pending, events);
    }
    for (const base of state.bases) {
      if (pending.has(base.id)) {
        base.alive = false;
        base.steer = 0;
        base.blocks.forEach((b) => (b.alive = false));
      }
      if (base.alive)
        base.angle = wrap(base.angle + base.steer * TURN_SPEED * DT);
    }
    for (const ball of state.balls) {
      if (ball.owner && pending.has(ball.owner)) ball.owner = null;
      if (ball.held && pending.has(ball.held)) {
        ball.held = null;
        ball.vx = BALL_SPEED;
        ball.vy = 0;
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
