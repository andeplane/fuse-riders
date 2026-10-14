import { SUB } from "./math.js";
import { CAMERA_END, EXIT_X, PICKUP_KINDS, type PickupKind } from "./level.js";
import { COUNTDOWN_STEPS, DRONE_DRIFT, OUTRO_STEPS } from "./tuning.js";
import { DOWN, FIRE, UP } from "./input.js";
import type { CombatMode, LiftMode } from "./settings.js";
import { CAUSES, FX, type Cause, type Phase, type World } from "./world.js";

/**
 * What the presentation sees of a round: positions in pixels (fractions allowed), velocities in pixels per step,
 * timers in steps. The cave itself is not here: the renderer rebuilds it from `seed` with `view-kit.ts`.
 */
export type FxKind = keyof typeof FX;
const FX_NAMES = Object.keys(FX) as FxKind[];

export interface ChopperView {
  id: string;
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: 1 | -1;
  state: "flying" | "crashed" | "escaped";
  endedAt: number;
  cause: Cause | "";
  shield: boolean;
  grace: number;
  stun: number;
  triple: number;
  turbo: number;
  scramble: number;
  lifting: boolean;
  diving: boolean;
  firing: boolean;
  landed: boolean;
  /** Still hovering at the start, waiting for its pilot's first climb. */
  hovering: boolean;
  hits: number;
  downed: number;
  pickups: number;
  bumps: number;
}
export interface Mover {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface WorldView {
  step: number;
  phase: Phase;
  /** Steps left in the countdown or the outro; 0 during play. */
  remaining: number;
  /** Steps of play so far. */
  played: number;
  seed: number;
  lift: LiftMode;
  combat: CombatMode;
  powerUps: boolean;
  camX: number;
  crushX: number;
  scroll: number;
  exitX: number;
  cameraEnd: number;
  choppers: ChopperView[];
  bullets: (Mover & { slot: number })[];
  bolts: Mover[];
  rocks: (Mover & { r: number })[];
  warnings: { id: number; y: number; at: number }[];
  drones: (Mover & { hp: number; charge: number })[];
  pickups: { id: number; kind: PickupKind; x: number; y: number }[];
  fx: {
    id: number;
    at: number;
    kind: FxKind;
    x: number;
    y: number;
    slot: number;
    data: number;
  }[];
  winner: string | null;
}

const p = (value: number) => value / SUB;

export function toView(world: World): WorldView {
  return {
    step: world.step,
    phase: world.phase,
    remaining:
      world.phase === "countdown"
        ? Math.max(0, COUNTDOWN_STEPS - world.step)
        : world.phase === "outro"
          ? Math.max(0, OUTRO_STEPS - (world.step - world.phaseAt))
          : 0,
    played: Math.max(0, world.step - COUNTDOWN_STEPS),
    seed: world.seed,
    lift: world.lift,
    combat: world.combat,
    powerUps: world.powerUps,
    camX: p(world.camX),
    crushX: p(world.crushX),
    scroll: p(world.scroll),
    exitX: EXIT_X,
    cameraEnd: CAMERA_END,
    choppers: world.choppers.map((c) => ({
      id: c.id,
      slot: c.slot,
      x: p(c.x),
      y: p(c.y),
      vx: p(c.vx),
      vy: p(c.vy),
      face: c.face,
      state: c.alive ? (c.exited ? "escaped" : "flying") : "crashed",
      endedAt: c.endedAt,
      cause: c.cause >= 0 ? CAUSES[c.cause]! : "",
      shield: c.shield > 0,
      grace: c.grace,
      stun: c.stun,
      triple: c.triple,
      turbo: c.turbo,
      scramble: c.scramble,
      lifting: (c.input & UP) !== 0,
      diving: (c.input & DOWN) !== 0,
      firing: (c.input & FIRE) !== 0,
      landed: c.landed,
      hovering: !c.engaged && c.alive && !c.exited,
      hits: c.hits,
      downed: c.downed,
      pickups: c.pickups,
      bumps: c.bumps,
    })),
    bullets: world.bullets.map((b) => ({
      id: b.id,
      slot: b.owner,
      x: p(b.x),
      y: p(b.y),
      vx: p(b.vx),
      vy: p(b.vy),
    })),
    bolts: world.bolts.map((b) => ({
      id: b.id,
      x: p(b.x),
      y: p(b.y),
      vx: p(b.vx),
      vy: p(b.vy),
    })),
    rocks: world.rocks.map((r) => ({
      id: r.id,
      x: p(r.x),
      y: p(r.y),
      vx: p(r.vx),
      vy: p(r.vy),
      r: p(r.r),
    })),
    warnings: world.warnings.map((w) => ({ id: w.id, y: p(w.y), at: w.at })),
    drones: world.drones.map((d) => ({
      id: d.id,
      x: p(d.x),
      y: p(d.y),
      vx: -p(DRONE_DRIFT),
      vy: 0,
      hp: d.hp,
      charge: d.charge,
    })),
    pickups: world.pickups.map((k) => ({
      id: k.id,
      kind: PICKUP_KINDS[k.kind]!,
      x: p(k.x),
      y: p(k.y),
    })),
    fx: world.fx.map((f) => ({
      id: f.id,
      at: f.at,
      kind: FX_NAMES[f.kind]!,
      x: p(f.x),
      y: p(f.y),
      slot: f.slot,
      data: f.data,
    })),
    winner: world.winner,
  };
}
