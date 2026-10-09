// Data shapes of a round. `RoundState` is what `step` mutates; everything outside the engine should
// read it through `RoundView`, the deep read-only version of the same object.

import type { Card, Tuning } from "./tuning.js";

export interface Vec2 {
  x: number;
  y: number;
}

/** Which way a castle aims: at opponents on one side, or both. */
export type Facing = "left" | "right" | "both";

export interface CastleStats {
  volleys: number;
  rocketsFired: number;
  /** Damage dealt to other castles (shields included). */
  damageDealt: number;
  kills: number;
  gateSplits: number;
  crates: number;
  /** Bombs dropped by this player's ghost, and the damage they dealt (included in `damageDealt`). */
  ghostBombs: number;
  ghostDamage: number;
}

export interface Castle {
  /** Castle id == player index (0-based, castles are ordered left to right). */
  id: number;
  /** Ground contact point (bottom centre). */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Launcher angle in radians: 0 = right, PI/2 = straight up, PI = left. */
  angle: number;
  arcMin: number;
  arcMax: number;
  /** +1 while the angle is increasing (turning counter-clockwise, i.e. up/left), -1 otherwise. */
  sweepDir: 1 | -1;
  /** Which way the castle currently aims: at opponents on one side, or both. */
  facing: Facing;
  /** Ticks until the launcher is loaded. */
  reloadTicks: number;
  /** Length of the current reload, for drawing a progress ring. */
  reloadTotalTicks: number;
  /** Current reload duration in seconds (lowered by RAPID cards). */
  reloadTime: number;
  /** Rockets per volley. */
  units: number;
  shieldHp: number;
  /** The next volley is a MEGA volley. */
  megaReady: boolean;
  /** Rockets of the volley in progress that have not been released yet. */
  volleyLeft: number;
  volleyAngle: number;
  volleyMega: boolean;
  volleyCooldown: number;
  fallSpeed: number;
  /** Owner id of the last rocket that hurt this castle (-1 = bomb / nobody). */
  lastHitBy: number;
  stats: CastleStats;
}

export interface Rocket {
  id: number;
  /** Castle id that fired it, or -1 for a sudden-death bomb. */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Damage multiplier; > 1 when the rocket cap merged split children into it. */
  power: number;
  mega: boolean;
  /** A sudden-death bomb (owner -1). */
  bomb: boolean;
  /** A ghost bomb, dropped by `owner`'s ghost: no gate splits, no crates. */
  ghost: boolean;
  /** Ids of gates this rocket's lineage already passed (each gate multiplies a lineage once). */
  gates: readonly number[];
  /** Ticks since launch. */
  age: number;
}

/**
 * A ghost bomber: the blimp a player flies after their castle is destroyed. It drifts at a constant
 * speed along the top of the arena, bouncing between `minX` and `maxX`, and drops a bomb straight
 * down (inheriting `vx`) when its button is pressed while loaded.
 */
export interface Ghost {
  /** Player id (== the destroyed castle's id). */
  owner: number;
  /** Current centre. */
  x: number;
  y: number;
  /** Current horizontal velocity (px/s); the sign is the drift direction. */
  vx: number;
  reloadTicks: number;
  reloadTotalTicks: number;
  /** First tick the ghost is in play (it is at `x0` when that step starts). */
  spawnTick: number;
  /** Motion parameters; see `ghostPositionAt`. */
  x0: number;
  speed: number;
  minX: number;
  maxX: number;
}

export interface Gate {
  id: number;
  multiplier: number;
  /** Current centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  spawnTick: number;
  expireTick: number;
  /** Motion parameters; see `gatePositionAt`. */
  x0: number;
  vx: number;
  minX: number;
  maxX: number;
  baseY: number;
  bobAmp: number;
  bobPeriodTicks: number;
  bobPhase: number;
}

export interface Crate {
  id: number;
  card: Card;
  x: number;
  y: number;
  radius: number;
  baseY: number;
  bobPhase: number;
  spawnTick: number;
}

export interface Terrain {
  width: number;
  height: number;
  /**
   * Surface height map: `surface[column]` is the y of the ground top in that one-pixel column.
   * Everything below it (larger y) is solid. Never deeper than `bedrock`.
   */
  surface: Float64Array;
  bedrock: number;
  /** Incremented whenever the surface changes, so renderers can cache. */
  version: number;
}

export type RoundPhase = "playing" | "sudden-death" | "over";

export interface RoundResult {
  /** Winning castle id, or null for a draw. */
  winner: number | null;
  reason: "last-standing" | "wipeout" | "timeout";
  tick: number;
}

export type TickEvent =
  | {
      type: "fired";
      tick: number;
      castleId: number;
      angle: number;
      units: number;
      mega: boolean;
    }
  | {
      type: "gate-split";
      tick: number;
      gateId: number;
      multiplier: number;
      owner: number;
      x: number;
      y: number;
      /** New rockets actually created (fewer than multiplier-1 when capped). */
      created: number;
    }
  | {
      type: "hit";
      tick: number;
      castleId: number;
      owner: number;
      x: number;
      y: number;
      damage: number;
      /** The shield took it. */
      shielded: boolean;
      /** Splash from a nearby ground explosion rather than a direct hit. */
      splash: boolean;
    }
  | { type: "shield-popped"; tick: number; castleId: number }
  | {
      type: "crater";
      tick: number;
      owner: number;
      x: number;
      y: number;
      radius: number;
      /** Inclusive column range whose surface changed. */
      x0: number;
      x1: number;
    }
  | {
      /**
       * A rocket blew up without digging a `crater`: it landed where there was nothing left to dig
       * (bedrock), or it reached `rocketMaxAge` in the air. Direct castle and shield hits report a
       * `hit`; rockets that leave the arena are removed silently.
       */
      type: "rocket-exploded";
      tick: number;
      owner: number;
      x: number;
      y: number;
      cause: "ground" | "expired";
    }
  | {
      type: "castle-destroyed";
      tick: number;
      castleId: number;
      by: number;
      x: number;
      y: number;
    }
  | {
      type: "crate-spawned";
      tick: number;
      crateId: number;
      card: Card;
      x: number;
      y: number;
    }
  | {
      type: "crate-taken";
      tick: number;
      crateId: number;
      card: Card;
      castleId: number;
      x: number;
      y: number;
    }
  | { type: "ghost-spawned"; tick: number; owner: number; x: number; y: number }
  | {
      type: "ghost-bomb-dropped";
      tick: number;
      owner: number;
      rocketId: number;
      x: number;
      y: number;
    }
  | {
      /**
       * A ghost bomb blew up (on a castle, a shield or the ground; also reported as `hit` / `crater`).
       * `castleIds` are the castles it damaged, `damage` the total. Bombs that leave the arena vanish.
       */
      type: "ghost-bomb-hit";
      tick: number;
      owner: number;
      rocketId: number;
      x: number;
      y: number;
      castleIds: number[];
      damage: number;
    }
  | { type: "gate-spawned"; tick: number; gateId: number; multiplier: number }
  | { type: "gate-expired"; tick: number; gateId: number }
  | { type: "sudden-death-started"; tick: number }
  | { type: "round-over"; tick: number; result: RoundResult };

export type TickEventType = TickEvent["type"];

export interface RoundConfig {
  seed: number;
  /** 2..6 */
  playerCount: number;
  tuning?: Partial<Tuning>;
}

export interface RoundState {
  readonly config: RoundConfig;
  readonly tuning: Tuning;
  /** Ticks simulated so far. */
  tick: number;
  phase: RoundPhase;
  result: RoundResult | null;
  /** Ticks at which the fuse burns out and sudden death starts. */
  fuseTicks: number;
  /** Ticks at which the round is decided on HP if still running. */
  maxTicks: number;
  terrain: Terrain;
  castles: Castle[];
  rockets: Rocket[];
  gates: Gate[];
  crates: Crate[];
  /** Ghost bombers of eliminated players, in the order their castles fell. */
  ghosts: Ghost[];
  /** Events produced by the most recent `step` (cleared at the start of each step). */
  events: TickEvent[];
  /** Tick at which the next crate may spawn. */
  nextCrateTick: number;
  /** Tick at which the next sudden-death bomb drops. */
  nextBombTick: number;
  nextId: number;
  /** PRNG state (see rng.ts). */
  rng: number;
}

type DeepReadonly<T> = T extends Float64Array
  ? ArrayLike<number>
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * Simulation internals left out of the view: the RNG state and the schedule of upcoming spawns
 * would let a bot see the future, which a player cannot.
 */
type Internals = "rng" | "nextId" | "nextCrateTick" | "nextBombTick";

export type RoundView = DeepReadonly<Omit<RoundState, Internals>>;
export type CastleView = DeepReadonly<Castle>;
export type RocketView = DeepReadonly<Rocket>;
export type GateView = DeepReadonly<Gate>;
export type CrateView = DeepReadonly<Crate>;
export type GhostView = DeepReadonly<Ghost>;
export type TerrainView = DeepReadonly<Terrain>;
