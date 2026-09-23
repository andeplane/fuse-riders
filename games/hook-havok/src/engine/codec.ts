import { overlaps } from "./collision.js";
import {
  createWorld,
  S,
  HALF,
  WIDTH,
  BODY,
  HEIGHT,
  PLATFORMS,
  BALL_FIELD,
  BALL_RADII,
  type Combat,
  type Input,
  type Tuning,
  type World,
} from "./world.js";
export const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const integer = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
export const TUNING_BOUNDS = {
  speed: [180, 600],
  jump: [400, 1000],
  gravity: [800, 2600],
  air: [10, 100],
  pull: [1200, 4000],
  range: [250, 1000],
} as const;
export function parseTuning(raw: unknown): Tuning | undefined {
  if (!plain(raw) || Object.keys(raw).length !== 7) return;
  if (
    raw.experiment !== "movement" &&
    raw.experiment !== "target" &&
    raw.experiment !== "ball"
  )
    return;
  for (const [key, [min, max]] of Object.entries(TUNING_BOUNDS))
    if (!integer(raw[key], min, max)) return;
  return {
    experiment: raw.experiment,
    speed: raw.speed as number,
    jump: raw.jump as number,
    gravity: raw.gravity as number,
    air: raw.air as number,
    pull: raw.pull as number,
    range: raw.range as number,
  };
}
function decodeCombat(
  raw: unknown,
  mode: Tuning["experiment"],
  tick: number,
): Combat | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 5 ||
    !Array.isArray(raw.balls) ||
    raw.balls.length > 4 ||
    !integer(raw.hits, 0, mode === "ball" ? 7 : 0xffffffff) ||
    !integer(raw.falls, 0, 0xffffffff) ||
    !plain(raw.impact) ||
    Object.keys(raw.impact).length !== 3 ||
    !integer(raw.impact.tick, 0, tick) ||
    !integer(raw.impact.x, 0, WIDTH * S) ||
    !integer(raw.impact.y, -2000 * S, 1000 * S)
  )
    return;
  const impact = { tick: raw.impact.tick, x: raw.impact.x, y: raw.impact.y };
  if (
    (!raw.hits && (impact.tick || impact.x || impact.y)) ||
    (raw.hits && !impact.tick)
  )
    return;
  let target: Combat["target"] = null;
  if (mode === "target") {
    const t = raw.target;
    if (
      !plain(t) ||
      Object.keys(t).length !== 6 ||
      !integer(t.x, HALF, WIDTH * S - HALF) ||
      !integer(t.feet, -2000 * S, 1000 * S) ||
      !integer(t.vx, -9 * S, 9 * S) ||
      !integer(t.vy, -10 * S, 16 * S) ||
      typeof t.grounded !== "boolean" ||
      !integer(t.respawn, 0, 30) ||
      (!t.respawn && overlaps(t.x, t.feet)) ||
      (t.respawn && (t.feet - BODY <= HEIGHT * S || t.vx || t.vy)) ||
      raw.balls.length ||
      raw.falls > raw.hits
    )
      return;
    target = {
      x: t.x,
      feet: t.feet,
      vx: t.vx,
      vy: t.vy,
      grounded: t.grounded,
      respawn: t.respawn,
    };
  } else if (raw.target !== null || raw.falls) return;
  const balls: Combat["balls"] = [];
  for (const b of raw.balls) {
    if (
      !plain(b) ||
      Object.keys(b).length !== 6 ||
      !integer(b.id, 1, 7) ||
      !integer(b.tier, 0, 2) ||
      b.tier !== (b.id === 1 ? 2 : b.id < 4 ? 1 : 0)
    )
      return;
    const radius = BALL_RADII[b.tier]! * S;
    const id = b.id;
    if (
      !integer(
        b.x,
        BALL_FIELD[0] * S + radius,
        (BALL_FIELD[0] + BALL_FIELD[2]) * S - radius,
      ) ||
      !integer(
        b.y,
        BALL_FIELD[1] * S + radius,
        (BALL_FIELD[1] + BALL_FIELD[3]) * S - radius,
      ) ||
      !integer(b.vx, -4 * S, 4 * S) ||
      Math.abs(b.vx) !== (4 - b.tier) * S ||
      !integer(b.vy, -5 * S, 8 * S) ||
      balls.some(
        (a) =>
          a.id >= id ||
          a.id === Math.floor(id / 2) ||
          a.id === Math.floor(id / 4),
      )
    )
      return;
    balls.push({ id: b.id, tier: b.tier, x: b.x, y: b.y, vx: b.vx, vy: b.vy });
  }
  if (mode === "ball") {
    if (
      raw.hits !==
      7 - balls.reduce((sum, b) => sum + 2 ** (b.tier + 1) - 1, 0)
    )
      return;
  } else if (balls.length || (mode === "movement" && raw.hits)) return;
  return { target, balls, hits: raw.hits, falls: raw.falls, impact };
}
export function parseInput(raw: unknown): Input | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 6 ||
    !integer(raw.move, -1, 1) ||
    !integer(raw.aimX, 0, WIDTH) ||
    !integer(raw.aimY, 0, HEIGHT) ||
    typeof raw.jump !== "boolean" ||
    typeof raw.fire !== "boolean" ||
    typeof raw.reset !== "boolean"
  )
    return;
  return {
    move: raw.move as Input["move"],
    jump: raw.jump,
    fire: raw.fire,
    reset: raw.reset,
    aimX: raw.aimX,
    aimY: raw.aimY,
  };
}
/** Rebuild only after every field passes. No aliases into untrusted snapshot data. */
export function decodeWorld(raw: unknown): World | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== Object.keys(createWorld()).length
  )
    return;
  const input = parseInput(raw.input),
    previous = parseInput(raw.previous),
    tuning = parseTuning(raw.tuning),
    h = raw.hook;
  if (
    !input ||
    !previous ||
    !tuning ||
    !plain(h) ||
    Object.keys(h).length !== 8
  )
    return;
  if (
    !integer(raw.slot, 0, 4) ||
    !integer(raw.tick, 0, 0xffffffff * 3) ||
    !integer(raw.x, HALF, WIDTH * S - HALF) ||
    !integer(raw.feet, -2000 * S, (HEIGHT + 100) * S) ||
    !integer(raw.vx, -18000, 18000) ||
    !integer(raw.vy, -18000, 18000) ||
    typeof raw.grounded !== "boolean" ||
    !integer(raw.coyote, 0, 6) ||
    !integer(raw.buffer, 0, 6) ||
    !integer(raw.respawn, 0, 30) ||
    !integer(raw.deaths, 0, 0xffffffff) ||
    (raw.facing !== -1 && raw.facing !== 1)
  )
    return;
  if (
    typeof h.phase !== "string" ||
    !["ready", "flying", "attached", "retracting"].includes(h.phase) ||
    !integer(h.x, -2000 * S, 3000 * S) ||
    !integer(h.y, -3000 * S, 3000 * S) ||
    !integer(h.vx, -20 * S, 20 * S) ||
    !integer(h.vy, -20 * S, 20 * S) ||
    !integer(h.life, 0, 60) ||
    !integer(h.distance, 0, tuning.range * S + 2) ||
    !integer(h.platform, -1, PLATFORMS.length - 1)
  )
    return;
  if (!raw.respawn && overlaps(raw.x, raw.feet)) return;
  if (h.phase === "attached") {
    const p = PLATFORMS[h.platform];
    if (!p || h.vx !== 0 || h.vy !== 0) return;
    const [x, y, w, height] = p;
    const onX =
      (Math.abs(h.x - x * S) <= 1 || Math.abs(h.x - (x + w) * S) <= 1) &&
      h.y >= y * S - 1 &&
      h.y <= (y + height) * S + 1;
    const onY =
      (Math.abs(h.y - y * S) <= 1 || Math.abs(h.y - (y + height) * S) <= 1) &&
      h.x >= x * S - 1 &&
      h.x <= (x + w) * S + 1;
    if (!onX && !onY) return;
  }
  if (
    h.phase === "ready" &&
    (h.x || h.y || h.vx || h.vy || h.life || h.distance || h.platform !== -1)
  )
    return;
  if (
    h.phase === "flying" &&
    (!h.life || (!h.vx && !h.vy) || h.platform !== -1)
  )
    return;
  if (h.phase === "retracting" && (!h.life || h.life > 6)) return;
  if (
    raw.respawn &&
    (raw.feet - BODY <= HEIGHT * S || raw.vx || raw.vy || h.phase !== "ready")
  )
    return;
  const combat = decodeCombat(raw.combat, tuning.experiment, raw.tick);
  if (!combat) return;
  return {
    combat,
    slot: raw.slot,
    tick: raw.tick,
    x: raw.x,
    feet: raw.feet,
    vx: raw.vx,
    vy: raw.vy,
    grounded: raw.grounded,
    coyote: raw.coyote,
    buffer: raw.buffer,
    respawn: raw.respawn,
    deaths: raw.deaths,
    facing: raw.facing,
    input,
    previous,
    tuning,
    hook: {
      phase: h.phase as World["hook"]["phase"],
      x: h.x,
      y: h.y,
      vx: h.vx,
      vy: h.vy,
      life: h.life,
      distance: h.distance,
      platform: h.platform,
    },
  };
}
