import { BRAKE, GAS, VOLT_LEFT, VOLT_RIGHT, TURN } from "./input.js";
import { edgesNear, WORLD_LIMIT, type Compiled } from "./level.js";
import { PI, TAU, cos, length, sin } from "./math.js";

/**
 * The bike: a frame, two wheels on springs and the rider's sprung body point, stepped with a fixed time step. The
 * model and every constant follow `docs/design/elasto-fuse-mechanics.md`. Time is in the model's own unit (`DT` a
 * step); lengths are world units, angles radians counter-clockwise, y up.
 *
 * The state is numbers only (flags are 0 or 1), so a checkpoint is the list of them in `BIKE_KEYS` order.
 */
export const BIKE_KEYS = [
  "fx",
  "fy",
  "fvx",
  "fvy",
  "frot",
  "fspin",
  "lx",
  "ly",
  "lvx",
  "lvy",
  "lrot",
  "lspin",
  "rx",
  "ry",
  "rvx",
  "rvy",
  "rrot",
  "rspin",
  "bx",
  "by",
  "bvx",
  "bvy",
  "hx",
  "hy",
  "flipped",
  "gravity",
  "braking",
  "relL",
  "relR",
  "voltR",
  "voltL",
  "voltRAt",
  "voltLAt",
  "savedR",
  "savedL",
  "lastVolt",
  "clock",
] as const;
export type BikeKey = (typeof BIKE_KEYS)[number];
/**
 * `f*` the frame, `l*`/`r*` the left and right wheel (position, velocity, rotation, spin), `b*` the rider's body
 * point, `h*` the head's centre. `relL`/`relR` are the wheels' angles to the frame as the brake caught them.
 * `flipped` is 1 when the bike faces right (the original's bike starts facing left, unflipped).
 * `voltR`/`voltL` say a volt's kick is still to be taken back, `volt*At` and `lastVolt` are steps of `clock`, the
 * steps this bike has been ridden.
 */
export type Bike = Record<BikeKey, number>;

/** The model's time per step: a 50 ms log tick is four steps, just under the original's cap of 0.0055 a step. */
export const DT = (0.05 * 0.4368) / 4;

export const WHEEL_RADIUS = 0.4,
  HEAD_RADIUS = 0.238,
  OBJECT_RADIUS = 0.4;
const FRAME_MASS = 200,
  FRAME_INERTIA = 60.5,
  WHEEL_MASS = 10,
  WHEEL_INERTIA = 0.32;
const GRAVITY = 10;
/** The wheels' rest places in the frame, and the rider's body point above its centre. */
export const WHEEL_DX = 0.85,
  WHEEL_DY = -0.6,
  BODY_UP = 0.44;
/** The head's centre from the body point: towards the way the bike faces, and up. */
export const HEAD_AHEAD = 0.09,
  HEAD_UP = 0.63;
const SPRING = 10000,
  DAMPING = 1000;
const BODY_SPRING = 50000,
  BODY_DAMPING = 3000;
const GAS_TORQUE = 600,
  GAS_TOP_SPIN = 110;
const BRAKE_SPRING = 1000,
  BRAKE_DAMPING = 100;
const VOLT_SPIN = 12,
  VOLT_BLEED = 3;
/** A wheel is held this far inside a contact, leaves it only when moving away faster than `LEAVING`, and two touch points closer than `MERGE` are one. */
const SINK = 0.005,
  LEAVING = -0.01,
  MERGE = 0.1;
/** The rider's body point stays inside this region of the frame, in the frame's axes with x towards the bike's back. */
const LEAN_AX = -0.35,
  LEAN_AY = 0.13,
  LEAN_NX = -0.23 / 0.5413871073455666,
  LEAN_NY = 0.49 / 0.5413871073455666,
  LEAN_TOP = 0.48,
  LEAN_FRONT = -0.5,
  LEAN_BACK = 0.26;
/** A volt's kick is taken back after this long, and the next volt waits this long, in steps. */
const VOLT_LENGTH = 0.1 / DT,
  VOLT_GAP = 0.4 / DT;

/** What a step did, as flags. */
export const DIED = 1,
  FLOWER = 2;
export interface Outcome {
  flags: number;
  /** The rider's apples after the step. */
  taken: number;
}

/** Which way gravity pulls, by `gravity`: 0 up, 1 down, 2 left, 3 right. */
const GX = [0, 0, -1, 1],
  GY = [1, -1, 0, 0];
export const GRAVITY_DOWN = 1;

/** The bike at rest on the level's start: its left wheel on it, facing right unless the level says left. */
export function resetBike(level: Compiled): Bike {
  const lx = level.level.start.x,
    ly = level.level.start.y;
  const fx = lx + WHEEL_DX,
    fy = ly - WHEEL_DY;
  const flipped = level.level.faceLeft ? 0 : 1;
  return {
    fx,
    fy,
    fvx: 0,
    fvy: 0,
    frot: 0,
    fspin: 0,
    lx,
    ly,
    lvx: 0,
    lvy: 0,
    lrot: 0,
    lspin: 0,
    rx: fx + WHEEL_DX,
    ry: ly,
    rvx: 0,
    rvy: 0,
    rrot: 0,
    rspin: 0,
    bx: fx,
    by: fy + BODY_UP,
    bvx: 0,
    bvy: 0,
    hx: fx + (flipped ? HEAD_AHEAD : -HEAD_AHEAD),
    hy: fy + BODY_UP + HEAD_UP,
    flipped,
    gravity: GRAVITY_DOWN,
    braking: 0,
    relL: 0,
    relR: 0,
    voltR: 0,
    voltL: 0,
    voltRAt: 0,
    voltLAt: 0,
    savedR: 0,
    savedL: 0,
    lastVolt: -VOLT_GAP - 1,
    clock: 0,
  };
}

const flag = (value: number): boolean => value === 0 || value === 1;
const BOUND = WORLD_LIMIT * 4,
  SPEED_BOUND = 1e5;
/** Whether `bike` is a state the step can have left: flags are flags and nothing has run away. */
export function validBike(bike: Bike): boolean {
  return (
    flag(bike.flipped) &&
    flag(bike.braking) &&
    flag(bike.voltR) &&
    flag(bike.voltL) &&
    Number.isInteger(bike.gravity) &&
    bike.gravity >= 0 &&
    bike.gravity <= 3 &&
    Number.isInteger(bike.clock) &&
    bike.clock >= 0 &&
    !runaway(bike)
  );
}
function runaway(bike: Bike): boolean {
  for (const key of BIKE_KEYS) {
    const value = bike[key];
    // NaN fails every comparison, so it is caught here too.
    if (!(Math.abs(value) <= SPEED_BOUND)) return true;
  }
  return !(
    Math.abs(bike.fx) <= BOUND &&
    Math.abs(bike.fy) <= BOUND &&
    Math.abs(bike.lx) <= BOUND &&
    Math.abs(bike.ly) <= BOUND &&
    Math.abs(bike.rx) <= BOUND &&
    Math.abs(bike.ry) <= BOUND
  );
}

/** `angle` brought back towards (−π, π] by one turn, as the original does once a step. */
const wrap = (angle: number): number =>
  angle < -PI ? angle + TAU : angle > PI ? angle - TAU : angle;

// The suspension's answer for one wheel, written here by `suspension` and read straight after: wheel force, frame
// force, frame torque.
let wfx = 0,
  wfy = 0,
  ffx = 0,
  ffy = 0,
  ftq = 0;

/**
 * The spring and damper between the frame and one wheel, plus the reaction to the wheel's drive torque `tq`, which
 * pushes the wheel's hub one way and the frame the other.
 */
function suspension(
  b: Bike,
  wx: number,
  wy: number,
  wvx: number,
  wvy: number,
  restX: number,
  restY: number,
  tq: number,
): void {
  const dx = b.fx + restX - wx,
    dy = b.fy + restY - wy;
  let sx = 0,
    sy = 0;
  if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
    sx = dx * SPRING;
    sy = dy * SPRING;
  }
  const restLength = length(restX, restY);
  // rot90(unit(rest)) = (−rest.y, rest.x) / |rest|
  const ts = -restLength * ((dx * -restY + dy * restX) / restLength) * SPRING;
  const rx = wx - b.fx,
    ry = wy - b.fy;
  const rl = length(rx, ry) || 1e-9;
  const nx = rx / rl,
    ny = ry / rl;
  // rp = rot90(r), pn = rot90(n)
  const rpx = -ry,
    rpy = rx,
    pnx = -ny,
    pny = nx;
  const vx = b.fvx + rpx * b.fspin - wvx,
    vy = b.fvy + rpy * b.fspin - wvy;
  const along = (vx * nx + vy * ny) * DAMPING,
    across = (vx * pnx + vy * pny) * DAMPING;
  const d1x = along * nx,
    d1y = along * ny,
    d2x = across * pnx,
    d2y = across * pny;
  const tx = pnx * (tq / rl),
    ty = pny * (tq / rl);
  wfx = sx + d1x + d2x - tx;
  wfy = sy + d1y + d2y - ty;
  ffx = -wfx;
  ffy = -wfy;
  ftq = ts - (d2x * rpx + d2y * rpy);
}

/** The step's answer, reused: the caller reads it before the next step. */
const outcome: Outcome = { flags: 0, taken: 0 };

/**
 * One step of `bike` on `level` with `bits` held and `pressed` gone down this step. `taken` is the rider's apples
 * before it; the answer carries them after it and whether the rider died or reached the flower with all of them.
 */
export function stepBike(
  level: Compiled,
  b: Bike,
  bits: number,
  pressed: number,
  taken: number,
): Outcome {
  outcome.flags = 0;
  outcome.taken = taken;
  if (pressed & TURN) b.flipped = 1 - b.flipped;
  const ax = cos(b.frot),
    ay = sin(b.frot),
    ux = -ay,
    uy = ax;
  const gas = (bits & GAS) !== 0,
    brake = (bits & BRAKE) !== 0;
  if (brake && !b.braking) {
    b.relL = b.lrot - b.frot;
    b.relR = b.rrot - b.frot;
  }
  b.braking = brake ? 1 : 0;
  let tqL = 0,
    tqR = 0;
  if (gas) {
    if (b.flipped) {
      if (b.lspin > -GAS_TOP_SPIN) tqL = -GAS_TORQUE;
    } else if (b.rspin < GAS_TOP_SPIN) tqR = GAS_TORQUE;
  }
  if (brake) {
    tqL =
      -BRAKE_SPRING * (b.lrot - (b.frot + b.relL)) -
      BRAKE_DAMPING * (b.lspin - b.fspin);
    tqR =
      -BRAKE_SPRING * (b.rrot - (b.frot + b.relR)) -
      BRAKE_DAMPING * (b.rspin - b.fspin);
  } else {
    b.lrot = wrap(b.lrot);
    b.rrot = wrap(b.rrot);
  }
  suspension(
    b,
    b.lx,
    b.ly,
    b.lvx,
    b.lvy,
    ax * -WHEEL_DX + ux * WHEEL_DY,
    ay * -WHEEL_DX + uy * WHEEL_DY,
    tqL,
  );
  const lfx = wfx,
    lfy = wfy;
  let bodyFx = ffx,
    bodyFy = ffy,
    bodyTq = ftq;
  suspension(
    b,
    b.rx,
    b.ry,
    b.rvx,
    b.rvy,
    ax * WHEEL_DX + ux * WHEEL_DY,
    ay * WHEEL_DX + uy * WHEEL_DY,
    tqR,
  );
  const rfx = wfx,
    rfy = wfy;
  bodyFx += ffx;
  bodyFy += ffy;
  bodyTq += ftq;

  volts(b, bits);

  const gx = GX[b.gravity]!,
    gy = GY[b.gravity]!;
  // The rider's body point: a stiff spring to its seat above the frame, damped against the seat's own motion.
  lean(b, ax, ay, ux, uy);
  {
    const ox = b.bx - b.fx,
      oy = b.by - b.fy;
    const fx =
      (b.fx + ux * BODY_UP - b.bx) * BODY_SPRING -
      (b.bvx - (b.fvx - oy * b.fspin)) * BODY_DAMPING +
      gx * FRAME_MASS * GRAVITY;
    const fy =
      (b.fy + uy * BODY_UP - b.by) * BODY_SPRING -
      (b.bvy - (b.fvy + ox * b.fspin)) * BODY_DAMPING +
      gy * FRAME_MASS * GRAVITY;
    b.bvx += (fx / FRAME_MASS) * DT;
    b.bvy += (fy / FRAME_MASS) * DT;
    b.bx += b.bvx * DT;
    b.by += b.bvy * DT;
  }
  // The frame never touches the ground: it only feels its springs and gravity.
  b.fspin += (bodyTq / FRAME_INERTIA) * DT;
  b.frot += b.fspin * DT;
  b.fvx += ((bodyFx + gx * FRAME_MASS * GRAVITY) / FRAME_MASS) * DT;
  b.fvy += ((bodyFy + gy * FRAME_MASS * GRAVITY) / FRAME_MASS) * DT;
  b.fx += b.fvx * DT;
  b.fy += b.fvy * DT;

  wheelStep(
    level,
    b,
    0,
    lfx + gx * WHEEL_MASS * GRAVITY,
    lfy + gy * WHEEL_MASS * GRAVITY,
    tqL,
  );
  wheelStep(
    level,
    b,
    1,
    rfx + gx * WHEEL_MASS * GRAVITY,
    rfy + gy * WHEEL_MASS * GRAVITY,
    tqR,
  );

  // The head rides on the body point, placed along the frame's axes as the step left them.
  const side = b.flipped ? HEAD_AHEAD : -HEAD_AHEAD;
  const nax = cos(b.frot),
    nay = sin(b.frot);
  b.hx = b.bx + side * nax - HEAD_UP * nay;
  b.hy = b.by + side * nay + HEAD_UP * nax;
  b.clock++;

  // Checked before the touch: a bike that left the world has no cell to look for edges in.
  if (runaway(b)) outcome.flags |= DIED;
  else touch(level, b);
  return outcome;
}

/**
 * A volt: a kick of spin one way that is taken back a moment later, never leaving more spin that way than before it.
 * A held volt key volts again each time the wait is over. Both keys on one step start both (the alovolt).
 */
function volts(b: Bike, bits: number): void {
  const ready = b.clock > b.lastVolt + VOLT_GAP;
  const right = ready && (bits & VOLT_RIGHT) !== 0,
    left = ready && (bits & VOLT_LEFT) !== 0;
  const any = right || left;
  const old = b.fspin;
  if (b.voltR && (any || b.clock > b.voltRAt + VOLT_LENGTH)) {
    b.fspin += VOLT_SPIN;
    if (b.fspin > b.savedR) b.fspin = b.savedR;
    if (b.fspin > 0) b.fspin = Math.max(0, b.fspin - VOLT_BLEED);
    b.voltR = 0;
  }
  if (b.voltL && (any || b.clock > b.voltLAt + VOLT_LENGTH)) {
    b.fspin -= VOLT_SPIN;
    if (b.fspin < b.savedL) b.fspin = b.savedL;
    if (b.fspin < 0) b.fspin = Math.min(0, b.fspin + VOLT_BLEED);
    b.voltL = 0;
  }
  if (right) {
    b.voltRAt = b.clock;
    b.savedR = b.fspin;
    b.voltR = 1;
    b.fspin -= VOLT_SPIN;
  }
  if (left) {
    b.voltLAt = b.clock;
    b.savedL = b.fspin;
    b.voltL = 1;
    b.fspin += VOLT_SPIN;
  }
  if (any) {
    b.lastVolt = b.clock;
    const change = b.fspin - old;
    b.bvx += -(b.by - b.fy) * change;
    b.bvy += (b.bx - b.fx) * change;
  }
}

/** Keeps the rider's body point inside its region of the frame; only its position is moved. */
function lean(b: Bike, ax: number, ay: number, ux: number, uy: number): void {
  const relX = b.bx - b.fx,
    relY = b.by - b.fy;
  let x = ax * relX + ay * relY,
    y = ux * relX + uy * relY;
  if (b.flipped) x = -x;
  const s = (x - LEAN_AX) * LEAN_NX + (y - LEAN_AY) * LEAN_NY;
  if (s < 0) {
    x -= LEAN_NX * s;
    y -= LEAN_NY * s;
  }
  if (y > LEAN_TOP) y = LEAN_TOP;
  if (x < LEAN_FRONT) x = LEAN_FRONT;
  if (x > LEAN_BACK) x = LEAN_BACK;
  if (x > 0 && y > 0) {
    const ratio = LEAN_TOP / LEAN_BACK;
    const e = ratio * ratio * x * x + y * y;
    if (e > LEAN_TOP * LEAN_TOP) {
      const k = LEAN_TOP / Math.sqrt(e);
      x *= k;
      y *= k;
    }
  }
  if (b.flipped) x = -x;
  b.bx = b.fx + ux * y + ax * x;
  b.by = b.fy + uy * y + ay * x;
}

// The touch points of the last `contacts` call: how many (0 to 2) and where.
let touches = 0,
  p1x = 0,
  p1y = 0,
  p2x = 0,
  p2y = 0;
/**
 * Where a circle at (`x`, `y`) of radius `r` touches the level's edges: the closest point of each edge nearer than
 * `r`, the first two distinct ones in edge order. Points closer than `MERGE` are one point, their average.
 */
function contacts(level: Compiled, x: number, y: number, r: number): void {
  touches = 0;
  const edges = level.edges;
  for (const edge of edgesNear(level, x, y)) {
    const o = edge * 4;
    const ex = edges[o]!,
      ey = edges[o + 1]!,
      dx = edges[o + 2]! - ex,
      dy = edges[o + 3]! - ey;
    let t = ((x - ex) * dx + (y - ey) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ex + t * dx,
      qy = ey + t * dy;
    if (length(x - qx, y - qy) >= r) continue;
    if (touches === 0) {
      p1x = qx;
      p1y = qy;
      touches = 1;
    } else if (length(p1x - qx, p1y - qy) < MERGE) {
      p1x = (p1x + qx) * 0.5;
      p1y = (p1y + qy) * 0.5;
    } else {
      p2x = qx;
      p2y = qy;
      touches = 2;
      return;
    }
  }
}

// The wheel being stepped, copied out of the bike and back so one routine serves both.
let wx = 0,
  wy = 0,
  wvx = 0,
  wvy = 0,
  wrot = 0,
  wspin = 0;

function pushOut(px: number, py: number): void {
  const dx = wx - px,
    dy = wy - py;
  const d = length(dx, dy);
  if (d < WHEEL_RADIUS - SINK && d > 1e-12) {
    const move = (WHEEL_RADIUS - SINK - d) / d;
    wx += dx * move;
    wy += dy * move;
  }
}
/** Whether the wheel presses on the point; if it does, its speed into the point is taken away (no bounce). */
function pressing(px: number, py: number, fx: number, fy: number): boolean {
  let nx = wx - px,
    ny = wy - py;
  const d = length(nx, ny) || 1e-12;
  nx /= d;
  ny /= d;
  const into = nx * wvx + ny * wvy;
  if (into > LEAVING && nx * fx + ny * fy > 0) return false;
  wvx -= nx * into;
  wvy -= ny * into;
  return true;
}
/** Whether the wheel, turning about the pivot as it moves now, turns towards the other point. */
function staysByMotion(
  ox: number,
  oy: number,
  px: number,
  py: number,
): boolean {
  const rx = wx - px,
    ry = wy - py;
  const d = length(rx, ry) || 1e-12;
  const tx = -ry / d,
    ty = rx / d;
  return (
    ((ox - px) * tx + (oy - py) * ty) * ((tx * wvx + ty * wvy) * d + wspin) >= 0
  );
}
/** The same, by the force and torque on the wheel: what a wheel at rest is about to do. */
function staysByForce(
  ox: number,
  oy: number,
  px: number,
  py: number,
  fx: number,
  fy: number,
  tq: number,
): boolean {
  const rx = wx - px,
    ry = wy - py;
  const d = length(rx, ry) || 1e-12;
  const tx = -ry / d,
    ty = rx / d;
  return (
    ((ox - px) * tx + (oy - py) * ty) * ((tx * fx + ty * fy) * d + tq) >= 0
  );
}
/** Rolling about a touch point without slipping: the spin follows the wheel's speed along the ground. */
function roll(
  px: number,
  py: number,
  fx: number,
  fy: number,
  tq: number,
): void {
  const rx = wx - px,
    ry = wy - py;
  const d = length(rx, ry) || 1e-12;
  const tx = -ry / d,
    ty = rx / d;
  wspin = (wvx * tx + wvy * ty) / WHEEL_RADIUS;
  wspin +=
    (((fx * tx + fy * ty) * WHEEL_RADIUS + tq) /
      (WHEEL_MASS * d * d + WHEEL_INERTIA)) *
    DT;
  wrot += wspin * DT;
  wvx = tx * (wspin * WHEEL_RADIUS);
  wvy = ty * (wspin * WHEEL_RADIUS);
  wx += wvx * DT;
  wy += wvy * DT;
}
function fly(fx: number, fy: number, tq: number): void {
  wspin += (tq / WHEEL_INERTIA) * DT;
  wrot += wspin * DT;
  wvx += (fx / WHEEL_MASS) * DT;
  wvy += (fy / WHEEL_MASS) * DT;
  wx += wvx * DT;
  wy += wvy * DT;
}

/**
 * The scratch wheel's step under the force (`fx`, `fy`) and the drive torque `tq`. Off the ground it flies. On one
 * touch point it rolls about it; on two it either turns away from one of them and rolls about the other, or is
 * wedged and does not move this step.
 */
function wheelMove(level: Compiled, fx: number, fy: number, tq: number): void {
  contacts(level, wx, wy, WHEEL_RADIUS);
  let n = touches,
    ax = p1x,
    ay = p1y;
  const bx = p2x,
    by = p2y;
  if (n === 0) return fly(fx, fy, tq);
  pushOut(ax, ay);
  if (n === 2) {
    pushOut(bx, by);
    const speed = length(wvx, wvy);
    let dropped = false;
    if (speed > 1) {
      if (!staysByMotion(ax, ay, bx, by)) {
        ax = bx;
        ay = by;
        dropped = true;
      } else if (!staysByMotion(bx, by, ax, ay)) dropped = true;
    }
    if (!dropped && speed < 1) {
      if (!staysByForce(ax, ay, bx, by, fx, fy, tq)) {
        ax = bx;
        ay = by;
        dropped = true;
      } else if (!staysByForce(bx, by, ax, ay, fx, fy, tq)) dropped = true;
    }
    if (dropped || !pressing(bx, by, fx, fy)) n = 1;
  }
  if (pressing(ax, ay, fx, fy)) {
    if (n === 2) {
      wvx = 0;
      wvy = 0;
      wspin = 0;
      return;
    }
    return roll(ax, ay, fx, fy, tq);
  }
  if (n === 2) return roll(bx, by, fx, fy, tq);
  fly(fx, fy, tq);
}

/** One wheel's step: `which` is 0 for the left wheel, 1 for the right. */
function wheelStep(
  level: Compiled,
  b: Bike,
  which: 0 | 1,
  fx: number,
  fy: number,
  tq: number,
): void {
  if (which === 0) {
    wx = b.lx;
    wy = b.ly;
    wvx = b.lvx;
    wvy = b.lvy;
    wrot = b.lrot;
    wspin = b.lspin;
    wheelMove(level, fx, fy, tq);
    b.lx = wx;
    b.ly = wy;
    b.lvx = wvx;
    b.lvy = wvy;
    b.lrot = wrot;
    b.lspin = wspin;
  } else {
    wx = b.rx;
    wy = b.ry;
    wvx = b.rvx;
    wvy = b.rvy;
    wrot = b.rrot;
    wspin = b.rspin;
    wheelMove(level, fx, fy, tq);
    b.rx = wx;
    b.ry = wy;
    b.rvx = wvx;
    b.rvy = wvy;
    b.rrot = wrot;
    b.rspin = wspin;
  }
}

const near = (
  x: number,
  y: number,
  r: number,
  ox: number,
  oy: number,
): boolean => length(x - ox, y - oy) < OBJECT_RADIUS + r;
/** Whether either wheel or the head touches the object at (`ox`, `oy`). */
const reaches = (b: Bike, ox: number, oy: number): boolean =>
  near(b.lx, b.ly, WHEEL_RADIUS, ox, oy) ||
  near(b.rx, b.ry, WHEEL_RADIUS, ox, oy) ||
  near(b.hx, b.hy, HEAD_RADIUS, ox, oy);

/**
 * What the bike touches after its step: the ground against the head and a killer against anything kill; an apple
 * is eaten (and may turn gravity); the flower finishes the run once every apple is eaten.
 */
function touch(level: Compiled, b: Bike): void {
  contacts(level, b.hx, b.hy, HEAD_RADIUS);
  if (touches > 0) {
    outcome.flags |= DIED;
    return;
  }
  const objects = level.level.objects;
  for (const object of objects)
    if (object.kind === "killer" && reaches(b, object.x, object.y)) {
      outcome.flags |= DIED;
      return;
    }
  for (const [bit, index] of level.apples.entries()) {
    if (outcome.taken & (1 << bit)) continue;
    const apple = objects[index]!;
    if (!reaches(b, apple.x, apple.y)) continue;
    outcome.taken |= 1 << bit;
    // An apple's gravity 1 to 4 is up, down, left, right: the bike's 0 to 3.
    if (apple.gravity) b.gravity = apple.gravity - 1;
  }
  if (outcome.taken !== (1 << level.apples.length) - 1) return;
  for (const object of objects)
    if (object.kind === "flower" && reaches(b, object.x, object.y)) {
      outcome.flags |= FLOWER;
      return;
    }
}
