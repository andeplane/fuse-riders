import { cos, sin, TAU } from "./math.js";
import {
  COUNTDOWN,
  EFFECT_TICKS,
  MAX_BALLS,
  BALL_SPEED,
  FRENZY,
  FRENZY_BALL_INTERVAL,
  POWER_KINDS,
  type ArenaState,
  type Ball,
  type Base,
  type Impact,
  type Pickup,
} from "./state.js";

/** A repeatable rotating deck: every match offers all five powers without random droughts. */
export function spawnPowers(s: ArenaState): void {
  s.pickups = s.pickups.filter((p) => p.expires > s.tick);
  for (const b of s.bases) b.shrink = b.shrink.filter((end) => end > s.tick);
  const elapsed = s.tick - COUNTDOWN - 20;
  if (s.phase !== "playing" || elapsed < 0 || elapsed % 80 !== 0) return;
  const id = elapsed / 80,
    angle = id * TAU * 0.381966;
  if (s.pickups.length >= 3) s.pickups.shift();
  s.pickups.push({
    id,
    kind: POWER_KINDS[id % POWER_KINDS.length]!,
    x: 500 + cos(angle) * 135,
    y: 500 + sin(angle) * 135,
    expires: s.tick + 400,
  });
}

/** Frenzy adds neutral pressure. The first defending paddle claims each ball. */
export function spawnFrenzyBall(s: ArenaState): boolean {
  const elapsed = s.tick - FRENZY;
  if (
    s.phase !== "playing" ||
    elapsed < 0 ||
    elapsed % FRENZY_BALL_INTERVAL !== 0 ||
    s.balls.length >= MAX_BALLS
  )
    return false;
  const wave = elapsed / FRENZY_BALL_INTERVAL,
    angle = (wave + 0.5) * TAU * 0.381966;
  s.balls.push({
    id: s.balls.length,
    x: 500,
    y: 500,
    vx: cos(angle) * BALL_SPEED,
    vy: sin(angle) * BALL_SPEED,
    owner: null,
    held: null,
    heldUntil: 0,
    bomb: false,
    splits: 0,
  });
  return true;
}

export function collect(
  s: ArenaState,
  ball: Ball,
  pickup: Pickup,
  events: Impact[],
): void {
  const owner = s.bases.find((b) => b.id === ball.owner && b.alive);
  if (!owner) return;
  s.pickups = s.pickups.filter((p) => p.id !== pickup.id);
  const end = s.tick + EFFECT_TICKS;
  switch (pickup.kind) {
    case "shrink":
      for (const b of s.bases)
        if (b.alive && b.id !== owner.id) {
          if (b.shrink.length >= 2) b.shrink.shift();
          b.shrink.push(end);
        }
      break;
    case "sticky":
      owner.stickyUntil = end;
      break;
    case "thief":
      owner.thiefUntil = end;
      break;
    case "bomb":
      ball.bomb = true;
      break;
    case "split": {
      if (ball.splits >= 2 || s.balls.length >= MAX_BALLS) break;
      const vx = ball.vx,
        vy = ball.vy,
        c = cos(0.28),
        n = sin(0.28);
      ball.splits++;
      ball.vx = vx * c - vy * n;
      ball.vy = vx * n + vy * c;
      s.balls.push({
        ...ball,
        id: s.balls.length,
        vx: vx * c + vy * n,
        vy: -vx * n + vy * c,
      });
      break;
    }
  }
  events.push({
    kind: "pickup",
    power: pickup.kind,
    x: pickup.x,
    y: pickup.y,
    slot: owner.slot,
  });
}

export function breakBlock(
  s: ArenaState,
  ball: Ball,
  base: Base,
  index: number,
): void {
  const block = base.blocks[index]!;
  if (!block.alive) return;
  block.alive = false;
  const owner = s.bases.find((b) => b.id === ball.owner && b.alive);
  if (!owner || owner.id === base.id) return;
  owner.broken++;
  if (owner.thiefUntil > s.tick) {
    const missing = owner.blocks.find((b) => !b.alive);
    if (missing) missing.alive = true;
  }
}

/** Splash breaks armor, never cores. A paddle absorbs the bomb with a one-second stun. */
export function explode(
  s: ArenaState,
  ball: Ball,
  events: Impact[],
  paddle?: Base,
  centers?: ReadonlyMap<string, { x: number; y: number }>,
): void {
  ball.bomb = false;
  if (paddle) paddle.stunUntil = s.tick + 20;
  else
    for (const base of s.bases)
      if (base.alive)
        base.blocks.forEach((b, i) => {
          const center = centers?.get(base.id) ?? base;
          if (
            (center.x + b.x - ball.x) ** 2 + (center.y + b.y - ball.y) ** 2 <=
            38 * 38
          )
            breakBlock(s, ball, base, i);
        });
  events.push({
    kind: "bomb",
    x: ball.x,
    y: ball.y,
    slot: paddle?.slot ?? s.bases.find((b) => b.id === ball.owner)?.slot ?? -1,
  });
}
