import {
  createArena,
  BALL_SPEED,
  COUNTDOWN,
  LIMIT,
  blockLayout,
  insideArena,
  PADDLE_MIN,
  PADDLE_MAX,
  MAX_BALLS,
  POWER_KINDS,
  type ArenaState,
  type Participant,
} from "./state.js";
import { length, TAU } from "./math.js";
import { isAvatar } from "./avatars.js";

export const integer = (n: unknown, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
export const finite = (n: unknown, max: number): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max;
export const validName = (n: unknown): n is string =>
  typeof n === "string" &&
  n.trim() === n &&
  Array.from(n).length >= 1 &&
  Array.from(n).length <= 24 &&
  !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(n);
export const validId = (n: unknown): n is string =>
  typeof n === "string" &&
  /^[a-zA-Z0-9_-]{1,64}$/.test(n) &&
  !(n in Object.prototype);
export const matchId = (n: unknown): n is string =>
  typeof n === "string" && /^[\x21-\x7e]{1,64}$/.test(n);

export function encodeArena(s: ArenaState): unknown[] {
  return [
    s.tick,
    s.phase,
    s.winner,
    s.bases.map((b) => [
      b.id,
      b.name,
      b.slot,
      b.bot,
      b.angle,
      b.alive,
      b.steer,
      b.launch,
      b.saves,
      b.broken,
      b.blocks.map((k) => k.alive),
      b.radius,
      b.radial,
      b.shrink,
      b.stickyUntil,
      b.thiefUntil,
      b.stunUntil,
      b.avatarId,
    ]),
    s.balls.map((b) => [
      b.id,
      b.x,
      b.y,
      b.vx,
      b.vy,
      b.owner,
      b.held,
      b.heldUntil,
      b.bomb,
      b.splits,
    ]),
    s.pickups.map((p) => [p.id, p.kind, p.x, p.y, p.expires]),
  ];
}
/** Fixed-size arrays and derived geometry keep arbitrary checkpoint objects out of the engine. */
export function decodeArena(raw: unknown): ArenaState | undefined {
  if (!Array.isArray(raw) || raw.length !== 6) return;
  const [tick, phase, winner, bases, balls, pickups] = raw;
  if (
    !integer(tick, COUNTDOWN + LIMIT) ||
    !["countdown", "playing", "over"].includes(phase) ||
    !Array.isArray(bases) ||
    bases.length < 2 ||
    bases.length > 5 ||
    !Array.isArray(balls) ||
    balls.length < bases.length ||
    balls.length > MAX_BALLS ||
    !Array.isArray(pickups) ||
    pickups.length > 3
  )
    return;
  const participants: Participant[] = [];
  for (const b of bases) {
    if (
      !Array.isArray(b) ||
      b.length !== 18 ||
      !isAvatar(b[17]) ||
      !validId(b[0]) ||
      !validName(b[1]) ||
      !integer(b[2], 4) ||
      typeof b[3] !== "boolean" ||
      !finite(b[4], TAU) ||
      b[4] < 0 ||
      typeof b[5] !== "boolean" ||
      ![-1, 0, 1].includes(b[6]) ||
      typeof b[7] !== "boolean" ||
      !integer(b[8], 100000) ||
      !integer(b[9], 100000) ||
      !Array.isArray(b[10]) ||
      b[10].length !== blockLayout().length ||
      !b[10].every((v: unknown) => typeof v === "boolean") ||
      !finite(b[11], PADDLE_MAX) ||
      b[11] < PADDLE_MIN ||
      ![-1, 0, 1].includes(b[12]) ||
      !Array.isArray(b[13]) ||
      b[13].length > 2 ||
      !b[13].every(
        (n: unknown, i: number) =>
          integer(n, tick + 160) && n > tick && (i === 0 || n >= b[13][i - 1]),
      ) ||
      !integer(b[14], tick + 160) ||
      !integer(b[15], tick + 160) ||
      !integer(b[16], tick + 20) ||
      (!b[5] && (b[6] !== 0 || b[12] !== 0 || b[10].some(Boolean)))
    )
      return;
    if (participants.some((p) => p.id === b[0] || p.slot >= b[2])) return;
    participants.push({
      id: b[0],
      name: b[1],
      slot: b[2],
      bot: b[3],
      avatarId: b[17],
    });
  }
  const s = createArena(participants);
  s.tick = tick;
  s.phase = phase;
  if (winner !== null && !participants.some((p) => p.id === winner)) return;
  s.winner = winner;
  s.bases.forEach((b, i) => {
    const v = bases[i];
    b.angle = v[4];
    b.alive = v[5];
    b.steer = v[6];
    b.launch = v[7];
    b.saves = v[8];
    b.broken = v[9];
    b.radius = v[11];
    b.radial = v[12];
    b.shrink = [...v[13]];
    b.stickyUntil = v[14];
    b.thiefUntil = v[15];
    b.stunUntil = v[16];
    b.blocks.forEach((k, j) => (k.alive = v[10][j]));
  });
  const alive = s.bases.filter((b) => b.alive);
  if (
    (phase === "countdown" && tick >= COUNTDOWN) ||
    (phase === "playing" &&
      (tick < COUNTDOWN || tick >= COUNTDOWN + LIMIT || alive.length < 2)) ||
    (phase !== "over" && winner !== null) ||
    (phase === "over" &&
      (tick < COUNTDOWN ||
        (winner !== null
          ? alive.length !== 1 || alive[0]!.id !== winner
          : alive.length > 0 && tick !== COUNTDOWN + LIMIT)))
  )
    return;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (
      !Array.isArray(b) ||
      b.length !== 10 ||
      b[0] !== i ||
      !finite(b[1], 1000) ||
      !finite(b[2], 1000) ||
      !insideArena(b[1], b[2]) ||
      !finite(b[3], BALL_SPEED + 0.01) ||
      !finite(b[4], BALL_SPEED + 0.01) ||
      (b[5] !== null && !alive.some((p) => p.id === b[5])) ||
      (b[6] !== null && (!alive.some((p) => p.id === b[6]) || b[5] !== b[6])) ||
      !integer(b[7], Math.max(COUNTDOWN + 60, tick + 60)) ||
      typeof b[8] !== "boolean" ||
      !integer(b[9], 2)
    )
      return;
    if (
      b[6] === null
        ? Math.abs(length(b[3], b[4]) - BALL_SPEED) > 0.01
        : b[3] !== 0 || b[4] !== 0
    )
      return;
    if (
      b[6] !== null &&
      balls.slice(0, i).some((p: unknown[]) => p[6] === b[6])
    )
      return;
    s.balls[i] = {
      id: i,
      x: b[1],
      y: b[2],
      vx: b[3],
      vy: b[4],
      owner: b[5],
      held: b[6],
      heldUntil: b[7],
      bomb: b[8],
      splits: b[9],
    };
  }
  for (const p of pickups) {
    if (
      !Array.isArray(p) ||
      p.length !== 5 ||
      !integer(p[0], 30) ||
      !POWER_KINDS.includes(p[1]) ||
      !finite(p[2], 1000) ||
      !finite(p[3], 1000) ||
      !insideArena(p[2], p[3], 24) ||
      !integer(p[4], tick + 400) ||
      p[4] <= tick ||
      s.pickups.some((k) => k.id >= p[0])
    )
      return;
    s.pickups.push({ id: p[0], kind: p[1], x: p[2], y: p[3], expires: p[4] });
  }
  return s;
}
