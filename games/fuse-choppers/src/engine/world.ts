import { SUB, px } from "./math.js";
import { CRUSH_START, VIEW_W } from "./tuning.js";
import type { CombatMode, LiftMode } from "./settings.js";

/**
 * One round's world: plain integer data, so the netcode can clone, hash and checkpoint it. Positions are world
 * sub-units, centre of the body; the camera's left edge is `camX`. Everything that stays put (the cave, platforms,
 * saws) is a function of `seed` in `level.ts` and is not stored.
 */
export const CAUSES = ["wall", "crush", "saw", "rock", "platform"] as const;
export type Cause = (typeof CAUSES)[number];

export const PHASES = ["countdown", "play", "outro"] as const;
export type Phase = (typeof PHASES)[number];

/** Effects the renderer turns into particles, keyed by `id` so a rollback that replays one does not draw it twice. */
export const FX = {
  explode: 0,
  hit: 1,
  shieldPop: 2,
  pickup: 3,
  shock: 4,
  scramble: 5,
  shatter: 6,
  droneDown: 7,
  exit: 8,
  bolt: 9,
  droneHit: 10,
  bump: 11,
  spark: 12,
} as const;
export const FX_KINDS = Object.keys(FX).length;

export interface Chopper {
  id: string;
  slot: number;
  x: number;
  y: number;
  /** Airspeed relative to the scroll; the chopper's world speed is `scroll + vx`. */
  vx: number;
  vy: number;
  face: 1 | -1;
  alive: boolean;
  exited: boolean;
  /** The step it crashed or escaped at, or −1. */
  endedAt: number;
  /** Index into `CAUSES`, or −1. */
  cause: number;
  shield: number;
  /** Steps of shield grace, when contacts push instead of kill. */
  grace: number;
  stun: number;
  cool: number;
  triple: number;
  turbo: number;
  scramble: number;
  landed: boolean;
  /** Its pilot has touched the vertical controls since GO; until then (or `START_HOVER`) it hovers. */
  engaged: boolean;
  /** Bits held this step, after any scramble. */
  input: number;
  hits: number;
  downed: number;
  pickups: number;
  bumps: number;
}
export interface Bullet {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
export interface Bolt {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
export interface Rock {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
}
/** A rock the crush zone is about to throw at height `y`, at step `at`. */
export interface Warning {
  id: number;
  y: number;
  at: number;
}
export interface Drone {
  id: number;
  x: number;
  y: number;
  baseY: number;
  hp: number;
  cool: number;
  charge: number;
  phase: number;
}
export interface Pickup {
  id: number;
  /** Index into `PICKUP_KINDS`. */
  kind: number;
  x: number;
  y: number;
}
export interface Fx {
  id: number;
  at: number;
  kind: number;
  x: number;
  y: number;
  /** The seat it belongs to, or −1. */
  slot: number;
  /** A detail for the screen: the power-up kind for a pickup, else 0. */
  data: number;
}

export interface World {
  seed: number;
  lift: LiftMode;
  combat: CombatMode;
  powerUps: boolean;
  /** Steps since the round was created. */
  step: number;
  phase: Phase;
  phaseAt: number;
  camX: number;
  scroll: number;
  crushX: number;
  rng: number;
  nextId: number;
  /** The next level segment whose spawns have not entered the world. */
  segment: number;
  /** When the crush zone next warns of a rock. */
  rockAt: number;
  choppers: Chopper[];
  bullets: Bullet[];
  bolts: Bolt[];
  rocks: Rock[];
  warnings: Warning[];
  drones: Drone[];
  pickups: Pickup[];
  fx: Fx[];
  /** The round's winner: a chopper id, `""` for nobody, `null` while undecided. */
  winner: string | null;
}

export interface Entrant {
  id: string;
  slot: number;
}

/** Where each seat hovers during the countdown. */
export const START_POSITIONS: readonly (readonly [number, number])[] = [
  [230, 178],
  [300, 246],
  [200, 314],
  [290, 382],
  [240, 446],
];

export function createChopper(id: string, slot: number): Chopper {
  const [x, y] = START_POSITIONS[slot] ?? START_POSITIONS[0]!;
  return {
    id,
    slot,
    x: px(x),
    y: px(y),
    vx: 0,
    vy: 0,
    face: 1,
    alive: true,
    exited: false,
    endedAt: -1,
    cause: -1,
    shield: 0,
    grace: 0,
    stun: 0,
    cool: 0,
    triple: 0,
    turbo: 0,
    scramble: 0,
    landed: false,
    engaged: false,
    input: 0,
    hits: 0,
    downed: 0,
    pickups: 0,
    bumps: 0,
  };
}

export function createWorld(
  seed: number,
  entrants: readonly Entrant[],
  rules: { lift: LiftMode; combat: CombatMode; powerUps: boolean },
): World {
  return {
    seed: seed >>> 0,
    lift: rules.lift,
    combat: rules.combat,
    powerUps: rules.powerUps,
    step: 0,
    phase: "countdown",
    phaseAt: 0,
    camX: 0,
    scroll: 0,
    crushX: CRUSH_START,
    rng: (seed ^ 0x5bd1e995) >>> 0,
    nextId: 1,
    segment: 0,
    rockAt: 0,
    choppers: [...entrants]
      .sort((a, b) => a.slot - b.slot)
      .map((entrant) => createChopper(entrant.id, entrant.slot)),
    bullets: [],
    bolts: [],
    rocks: [],
    warnings: [],
    drones: [],
    pickups: [],
    fx: [],
    winner: null,
  };
}

/** The camera's right edge, in sub-units. */
export const rightEdge = (world: World): number => world.camX + VIEW_W * SUB;
