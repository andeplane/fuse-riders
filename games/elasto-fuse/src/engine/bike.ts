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
/** The head's centre from the body point: ahead of it and up. */
export const HEAD_AHEAD = -0.09,
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

/** The bike at rest on the level's start: the left wheel on it, facing right. */
export function resetBike(level: Compiled): Bike {
  const lx = level.level.start.x,
    ly = level.level.start.y;
  const fx = lx + WHEEL_DX,
    fy = ly - WHEEL_DY;
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
    hx: fx + HEAD_AHEAD,
    hy: fy + BODY_UP + HEAD_UP,
    flipped: 0,
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

/** `angle` brought into (−π, π]. */
const wrap = (angle: number): number =>
  angle > PI || angle <= -PI ? angle - Math.round(angle / TAU) * TAU : angle;

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

  volts(b, pressed);

  const gx = GX[b.gravity]!,
    gy = GY[b.gravity]!;
  // The rider's body point: a stiff spring to its seat above the frame, damped against the seat's own motion.
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

  const side = b.flipped ? -HEAD_AHEAD : HEAD_AHEAD;
  // The head rides on the body point, placed along the frame's axes as they were at the start of the step.
  b.hx = b.bx + side * ax + HEAD_UP * ux;
  b.hy = b.by + side * ay + HEAD_UP * uy;
  b.clock++;

  touch(level, b);
  if (runaway(b)) outcome.flags |= DIED;
  return outcome;
}

/** A volt: a kick of spin one way that is taken back a moment later, leaving the bike turned. */
function volts(b: Bike, pressed: number): void {
  let right = (pressed & VOLT_RIGHT) !== 0,
    left = (pressed & VOLT_LEFT) !== 0;
  if (b.clock <= b.lastVolt + VOLT_GAP) right = left = false;
  // Both at once: the right one is taken.
  if (right && left) left = false;
  const any = right || left;
  const old = b.fspin;
  if (b.voltR && (any || b.clock > b.voltRAt + VOLT_LENGTH)) {
    b.fspin += VOLT_SPIN;
    b.fspin = Math.min(b.fspin, b.savedR);
    if (b.fspin > 0) b.fspin = Math.max(0, b.fspin - VOLT_BLEED);
    b.voltR = 0;
  }
  if (b.voltL && (any || b.clock > b.voltLAt + VOLT_LENGTH)) {
    b.fspin -= VOLT_SPIN;
    b.fspin = Math.max(b.fspin, b.savedL);
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

/** One wheel's step under `fx`, `fy` and the drive torque `tq`: free flight for now. */
function wheelStep(
  level: Compiled,
  b: Bike,
  which: 0 | 1,
  fx: number,
  fy: number,
  tq: number,
): void {
  void level;
  void edgesNear;
  if (which === 0) {
    b.lspin += (tq / WHEEL_INERTIA) * DT;
    b.lrot += b.lspin * DT;
    b.lvx += (fx / WHEEL_MASS) * DT;
    b.lvy += (fy / WHEEL_MASS) * DT;
    b.lx += b.lvx * DT;
    b.ly += b.lvy * DT;
  } else {
    b.rspin += (tq / WHEEL_INERTIA) * DT;
    b.rrot += b.rspin * DT;
    b.rvx += (fx / WHEEL_MASS) * DT;
    b.rvy += (fy / WHEEL_MASS) * DT;
    b.rx += b.rvx * DT;
    b.ry += b.rvy * DT;
  }
}

/** Apples, killers, the flower and the ground against the head. */
function touch(level: Compiled, b: Bike): void {
  void level;
  void b;
}
