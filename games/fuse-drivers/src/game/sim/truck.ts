import {
  BASE_STATS,
  config,
  DT,
  type SurfaceKind,
  type TruckStats,
} from "./config.js";
import type { TruckInput } from "./input.js";
import { nextRandom } from "./rng.js";
import { cos, sin } from "./deterministic-math.js";

export type ItemKind =
  "mine" | "oil" | "nitro" | "shield" | "missile" | "drone" | "emp";

/** Plain JSON truck record. Timers are absolute ticks; 0 means inactive (ADR 002). */
export interface Truck {
  slot: number;
  x: number;
  y: number;
  /** Radians, 0 = +x, clockwise positive (y down). */
  heading: number;
  speed: number;
  stats: TruckStats;
  armor: number;
  nitros: number;
  item: ItemKind | null;
  turnDir: -1 | 0 | 1;
  turnHeldTicks: number;
  driftDir: -1 | 0 | 1;
  driftTicks: number;
  boostUntilTick: number;
  nitroUntilTick: number;
  padUntilTick: number;
  airborneUntilTick: number;
  spinUntilTick: number;
  /** EMP: no steering until this tick. */
  stunUntilTick: number;
  oilUntilTick: number;
  shieldUntilTick: number;
  invulnerableUntilTick: number;
  lockedUntilTick: number;
  /** Tick at which a destroyed truck respawns; 0 when alive. */
  respawnAtTick: number;
  respawnedTick: number;
  toxicNextTick: number;
  landAtTick: number;
  wallTicks: number;
  prevNitro: boolean;
  /** Set while crossing a bridge deck: walls tagged `under` are ignored and the truck draws above decor (ADR 003). */
  onBridge: boolean;
  laps: number;
  checkpoint: number;
  progress: number;
  wrongWayTicks: number;
  finishedTick: number;
  kills: number;
  deaths: number;
  lapsLed: number;
  nitrosUsed: number;
}

export function createTruck(
  slot: number,
  x: number,
  y: number,
  heading: number,
  stats: TruckStats = BASE_STATS,
): Truck {
  return {
    slot,
    x,
    y,
    heading,
    speed: 0,
    stats,
    armor: stats.maxArmor,
    nitros: stats.nitros,
    item: null,
    turnDir: 0,
    turnHeldTicks: 0,
    driftDir: 0,
    driftTicks: 0,
    boostUntilTick: 0,
    nitroUntilTick: 0,
    padUntilTick: 0,
    airborneUntilTick: 0,
    spinUntilTick: 0,
    stunUntilTick: 0,
    oilUntilTick: 0,
    shieldUntilTick: 0,
    invulnerableUntilTick: 0,
    lockedUntilTick: 0,
    respawnAtTick: 0,
    respawnedTick: 0,
    toxicNextTick: 0,
    landAtTick: 0,
    wallTicks: 0,
    prevNitro: false,
    onBridge: false,
    laps: 0,
    checkpoint: 0,
    progress: 0,
    wrongWayTicks: 0,
    finishedTick: 0,
    kills: 0,
    deaths: 0,
    lapsLed: 0,
    nitrosUsed: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Angle in [-pi, pi), by exact arithmetic so it is bit-identical on every platform (fmath.ts). */
export const wrapAngle = (a: number) =>
  a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)) + 0;

/**
 * Turn-then-move kernel (ADR 004). Pure: returns the moved truck and the new RNG state.
 * Walls, contacts and surface side effects are resolved by the race step at the committed position.
 */
export function stepTruck(
  t: Truck,
  input: TruckInput,
  surface: SurfaceKind,
  tick: number,
  rng: number,
): [Truck, number] {
  const c = config.truck;
  const surf = config.surfaces[surface];
  const airborne = tick < t.airborneUntilTick;
  const spinning = tick < t.spinUntilTick;
  const canSteer = !airborne && !spinning && tick >= t.stunUntilTick;
  const speedFrac = clamp(t.speed / t.stats.topSpeed, 0, 1);
  const dir: -1 | 0 | 1 = input.left === input.right ? 0 : input.left ? -1 : 1;

  let heading = t.heading;
  let turnHeldTicks =
    dir !== 0 && dir === t.turnDir ? t.turnHeldTicks + 1 : dir !== 0 ? 1 : 0;
  let driftDir = t.driftDir;
  let driftTicks = t.driftTicks;
  let boostUntilTick = t.boostUntilTick;

  if (canSteer) {
    let turnRate =
      lerp(c.turnRateLow, t.stats.turnRateHigh, speedFrac) * surf.turnMul;
    if (tick < t.oilUntilTick) turnRate *= c.oilTurnMul;
    if (driftDir !== 0 && (!surf.drift || speedFrac < c.driftMinSpeedFrac)) {
      driftDir = 0;
      driftTicks = 0;
    }
    if (driftDir !== 0) {
      if (!input.left && !input.right) {
        if (driftTicks >= c.driftBoostTicks)
          boostUntilTick = tick + c.boostTicks;
        driftDir = 0;
        driftTicks = 0;
      } else {
        const opposite =
          (driftDir === -1 && input.right) || (driftDir === 1 && input.left);
        heading +=
          driftDir *
          turnRate *
          c.driftTurnMul *
          (opposite ? c.driftOppositeMul : 1) *
          DT;
        driftTicks += 1;
      }
    } else {
      heading += dir * turnRate * DT;
      if (
        dir !== 0 &&
        turnHeldTicks > c.driftEnterTicks &&
        speedFrac >= c.driftMinSpeedFrac &&
        surf.drift
      ) {
        driftDir = dir;
        driftTicks = 0;
      }
    }
  } else {
    driftDir = 0;
    driftTicks = 0;
    turnHeldTicks = 0;
  }
  heading = wrapAngle(heading);
  let moveHeading = heading;
  if (canSteer && tick < t.oilUntilTick) {
    const [r, next] = nextRandom(rng);
    rng = next;
    moveHeading = heading + (r * 2 - 1) * c.oilNoise;
  }

  let speed = t.speed;
  if (input.brake && !airborne && !spinning)
    speed = Math.max(-c.reverseCap, speed - c.brakeDecel * DT);
  else
    speed = Math.min(
      t.stats.topSpeed,
      speed + (t.stats.topSpeed / t.stats.accelTime) * DT,
    );

  let nitros = t.nitros;
  let nitroUntilTick = t.nitroUntilTick;
  let nitrosUsed = t.nitrosUsed;
  if (
    input.nitro &&
    !t.prevNitro &&
    nitros > 0 &&
    !airborne &&
    !spinning &&
    tick >= nitroUntilTick
  ) {
    nitros -= 1;
    nitrosUsed += 1;
    nitroUntilTick = tick + c.nitroTicks;
  }

  const nitroActive = tick < nitroUntilTick;
  let mul = Math.max(
    1,
    nitroActive ? c.nitroMul : 1,
    tick < t.padUntilTick ? c.boostPadMul : 1,
    tick < boostUntilTick ? c.boostMul : 1,
  );
  if (driftDir !== 0) mul *= c.driftSpeedMul;
  if (!nitroActive && !airborne) mul *= surf.speed;

  const x = t.x + cos(moveHeading) * speed * mul * DT;
  const y = t.y + sin(moveHeading) * speed * mul * DT;

  return [
    {
      ...t,
      x,
      y,
      heading,
      speed,
      nitros,
      nitrosUsed,
      nitroUntilTick,
      boostUntilTick,
      turnDir: dir,
      turnHeldTicks,
      driftDir,
      driftTicks,
      prevNitro: input.nitro,
    },
    rng,
  ];
}
