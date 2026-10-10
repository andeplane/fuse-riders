// Small pure helpers shared by the simulation and the trajectory predictor.

import { cos, sin } from "./det-math.js";
import { flyStep, GHOST_FLIGHT, openSky, type FlightBody } from "./flight.js";
import {
  DT,
  SUBSTEPS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type Tuning,
} from "./tuning.js";
import type { GateView, GhostView, Vec2 } from "./types.js";

/** Anything with a hull centre (a castle, or a spot a castle might hover at). */
type Hull = Readonly<Vec2>;

export const DEG = Math.PI / 180;
export const TAU = 2 * Math.PI;

/** Centre of a castle's hit circle (and of its shield bubble): the hull centre `x, y` itself. */
export function castleCenter(c: Hull): Vec2 {
  return { x: c.x, y: c.y };
}

/** Pivot the launcher rotates around, `launcherOffset` above the hull centre. */
export function launcherPivot(c: Hull, tuning: Tuning): Vec2 {
  return { x: c.x, y: c.y - tuning.launcherOffset };
}

/** The launcher angle one tick on: `aimPeriod` per counter-clockwise revolution, wrapped into [0, 2π). */
export function turnLauncher(angle: number, tuning: Tuning): number {
  const next = angle + (TAU * DT) / tuning.aimPeriod;
  return next >= TAU ? next - TAU : next;
}

/** Where a rocket fired at `angle` appears, and its velocity (before per-rocket spread). */
export function launchState(
  c: Hull,
  tuning: Tuning,
  angle: number,
  speed = tuning.launchSpeed,
): { x: number; y: number; vx: number; vy: number } {
  const p = launcherPivot(c, tuning);
  const dx = cos(angle);
  const dy = sin(angle);
  return {
    x: p.x + dx * tuning.barrelLength,
    y: p.y - dy * tuning.barrelLength,
    vx: dx * speed,
    vy: -dy * speed,
  };
}

/** Seconds per rocket sub-step. */
export const SUB_DT = DT / SUBSTEPS;

/** Semi-implicit Euler for one sub-step. Shared by `step` and `predictTrajectory`. */
export function integrate(
  r: { x: number; y: number; vx: number; vy: number },
  gravity: number,
) {
  r.vy += gravity * SUB_DT;
  r.x += r.vx * SUB_DT;
  r.y += r.vy * SUB_DT;
}

/** True once a rocket has left the world for good (off the sides or below the bottom; above the top it falls back). */
export function isOffscreen(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return x < -80 || x > width + 80 || y > height + 60;
}

function triangle(u: number, span: number): number {
  if (span <= 0) return 0;
  const period = 2 * span;
  const m = ((u % period) + period) % period;
  return m <= span ? m : period - m;
}

/** Gate centre at an absolute tick (gates move on a fixed, input-independent path). */
export function gatePositionAt(g: GateView, tick: number): Vec2 {
  const elapsed = tick - g.spawnTick;
  const x =
    g.minX + triangle(g.x0 - g.minX + g.vx * elapsed * DT, g.maxX - g.minX);
  const y =
    g.baseY +
    g.bobAmp * sin(g.bobPhase + (2 * Math.PI * elapsed) / g.bobPeriodTicks);
  return { x, y };
}

/** Where ghosts fly: the world's edges and no rock, since they pass through it. */
export const GHOST_SKY = openSky(WORLD_WIDTH, WORLD_HEIGHT);

/**
 * Where ghost `g` will be `ticks` steps from now if its player holds no direction: it coasts on its momentum and
 * brakes to a stop (in about 1.5 s), off the world's edges, exactly as `step` moves it. That is the assumption of the
 * drop guide and the bots; a player who steers changes it.
 */
export function ghostPositionAt(g: GhostView, ticks: number): FlightBody {
  const body = { x: g.x, y: g.y, vx: g.vx, vy: g.vy };
  for (let i = 0; i < ticks && (body.vx !== 0 || body.vy !== 0); i++)
    flyStep(body, 0, GHOST_FLIGHT, GHOST_SKY);
  return body;
}

export function insideGate(
  gx: number,
  gy: number,
  g: GateView,
  x: number,
  y: number,
): boolean {
  return Math.abs(x - gx) <= g.width / 2 && Math.abs(y - gy) <= g.height / 2;
}

/** How far a crate bobs above and below its `baseY`. */
export const CRATE_BOB = 6;

/** Crate centre at an absolute tick (crates bob in place). */
export function crateYAt(
  baseY: number,
  bobPhase: number,
  spawnTick: number,
  tick: number,
): number {
  return baseY + CRATE_BOB * sin(bobPhase + (tick - spawnTick) * DT * 2.2);
}
