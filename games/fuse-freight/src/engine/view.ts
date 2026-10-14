import { SUB, UNIT, cos, sin } from "./math.js";
import { steering } from "./input.js";
import { places } from "./step.js";
import { along, wagonDistance } from "./trail.js";
import * as T from "./tuning.js";
import { FX, played, type Phase, type Train, type World } from "./world.js";

/**
 * What the presentation sees of a round: positions in pixels (fractions allowed), headings as unit vectors, timers in
 * steps. Wagons are placed here, from the path, so the screen never walks the trail itself.
 */
export type FxKind = keyof typeof FX;
const FX_NAMES = Object.keys(FX) as FxKind[];

export interface WagonView {
  x: number;
  y: number;
  /** Which way it faces: toward the wagon or locomotive in front, not normalised. */
  hx: number;
  hy: number;
  kind: number;
}
export interface TrainView {
  id: string;
  slot: number;
  x: number;
  y: number;
  hx: number;
  hy: number;
  /** Pixels a step. */
  speed: number;
  /** −1 steering left, 1 right, 0 straight on. */
  steer: -1 | 0 | 1;
  wagons: WagonView[];
  full: boolean;
  score: number;
  /** 1 for the lead; equal scores share a place. */
  place: number;
  /** Steps its wagons stay uncuttable. */
  guard: number;
  bumped: boolean;
  collected: number;
  deliveries: number;
  stolen: number;
  lost: number;
}
export interface CartView {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Steps until it may be collected. */
  cool: number;
}
export interface FxView {
  id: number;
  at: number;
  kind: FxKind;
  x: number;
  y: number;
  slot: number;
  data: number;
  other: number;
}
export interface WorldView {
  step: number;
  phase: Phase;
  /** Steps left in the countdown or the outro; 0 during play. */
  remaining: number;
  /** Steps of play so far, and in the whole round. */
  played: number;
  length: number;
  /** Steps of play left. */
  timeLeft: number;
  /** The last stretch of the round. */
  final: boolean;
  seed: number;
  trains: TrainView[];
  carts: CartView[];
  fx: FxView[];
}

const p = (value: number) => value / SUB;

function wagonViews(train: Train): WagonView[] {
  return train.cargo.map((kind, index) => {
    const distance = wagonDistance(index),
      [x, y] = along(train, distance),
      [fx, fy] = along(train, distance - T.CRUMB),
      [bx, by] = along(train, distance + T.CRUMB);
    return { x: p(x), y: p(y), hx: p(fx - bx), hy: p(fy - by), kind };
  });
}

export function toView(world: World): WorldView {
  const soFar = played(world),
    ranks = places(world.trains.map((t) => t.score));
  return {
    step: world.step,
    phase: world.phase,
    remaining:
      world.phase === "countdown"
        ? Math.max(0, T.COUNTDOWN_STEPS - world.step)
        : world.phase === "outro"
          ? Math.max(0, T.OUTRO_STEPS - (world.step - world.phaseAt))
          : 0,
    played: soFar,
    length: world.length,
    timeLeft: world.length - soFar,
    final: world.phase === "play" && world.length - soFar <= T.FINAL_STEPS,
    seed: world.seed,
    trains: world.trains.map((t, index) => ({
      id: t.id,
      slot: t.slot,
      x: p(t.x),
      y: p(t.y),
      hx: cos(t.dir) / UNIT,
      hy: sin(t.dir) / UNIT,
      speed: p(T.SPEED - T.SPEED_LOSS * t.cargo.length),
      steer: steering(t.input),
      wagons: wagonViews(t),
      full: t.cargo.length >= T.MAX_WAGONS,
      score: t.score,
      place: ranks[index]!,
      guard: t.guard,
      bumped: t.bump > 0,
      collected: t.collected,
      deliveries: t.deliveries,
      stolen: t.stolen,
      lost: t.lost,
    })),
    carts: world.carts.map((c) => ({
      id: c.id,
      kind: c.kind,
      x: p(c.x),
      y: p(c.y),
      vx: p(c.vx),
      vy: p(c.vy),
      cool: c.cool,
    })),
    fx: world.fx.map((f) => ({
      id: f.id,
      at: f.at,
      kind: FX_NAMES[f.kind]!,
      x: p(f.x),
      y: p(f.y),
      slot: f.slot,
      data: f.data,
      other: f.other,
    })),
  };
}
