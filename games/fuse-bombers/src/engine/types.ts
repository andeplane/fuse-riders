// Data shapes of a round. `RoundState` is what `step` mutates; everything outside the engine should
// read it through `RoundView`, the deep read-only version of the same object.

import type { BotMemory, BotSeat } from "./bot.js";
import type { Grid } from "./grid.js";
import type { Card, Tuning } from "./tuning.js";

export interface Vec2 {
  x: number;
  y: number;
}

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
  /** Castle id == player index (0-based). */
  id: number;
  /** Hull centre: the centre of the hit circle and the shield. Gunships fly (`flyStep`), so it moves. */
  x: number;
  y: number;
  /** Velocity, px/s (y down). Gunships fly with momentum and never fall. */
  vx: number;
  vy: number;
  /** The direction bits (`UP | DOWN | LEFT | RIGHT`) it flew with on the latest step, for drawing thrusters. */
  thrust: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /**
   * Launcher angle in radians, in [0, 2π): 0 = right, π/2 = straight up, π = left, 3π/2 = straight down. It turns
   * counter-clockwise (increasing) at a steady rate, one revolution per `aimPeriod`.
   */
  angle: number;
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
 * A ghost bomber: the blimp a player flies after their castle is destroyed, with the same controls (`GHOST_FLIGHT`:
 * through rock, inside the world's edges). It drops a bomb, which inherits its velocity, on a fire press while loaded.
 */
export interface Ghost {
  /** Player id (== the destroyed castle's id). */
  owner: number;
  /** Current centre. */
  x: number;
  y: number;
  /** Velocity, px/s. */
  vx: number;
  vy: number;
  /** The direction bits it flew with on the latest step. */
  thrust: number;
  reloadTicks: number;
  reloadTotalTicks: number;
  /** First tick the ghost is in play (it flies and drops from that step on). */
  spawnTick: number;
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
      /** The terrain cells that changed: columns `col0..col1` and rows `row0..row1`, ends exclusive. */
      col0: number;
      row0: number;
      col1: number;
      row1: number;
    }
  | {
      /**
       * A rocket blew up without digging a `crater`: it hit rock it could not dig (indestructible
       * cells), or it reached `rocketMaxAge` in the air. Direct castle and shield hits report a
       * `hit`; rockets that leave the world sideways or below are removed silently.
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
       * `castleIds` are the castles it damaged, `damage` the total. Bombs that leave the world vanish.
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
  /** Seats the engine plays itself, each with a difficulty (distinct ids below `playerCount`; `step` ignores their `held`). */
  bots?: readonly BotSeat[];
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
  /** The destructible map (the temple), carved by every explosion. Plain data: two bitsets. */
  terrain: Grid;
  castles: Castle[];
  rockets: Rocket[];
  gates: Gate[];
  crates: Crate[];
  /** Ghost bombers of eliminated players, in the order their castles fell. */
  ghosts: Ghost[];
  /** Each seat's input bits on the latest step (validated): fire fires on the rising edge of `FIRE` against these. */
  lastHeld: number[];
  /** The memory of the bots `config.bots` names, by seat (see bot.ts): plain data, cloned and checkpointed with the rest. */
  bots: BotMemory[];
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

// A typed array cannot be made read-only by a mapped type (its elements stay writable), so the view shows the grid's
// bitsets as `ArrayLike<number>`: enough for the read-only queries in grid.ts (`ReadGrid`), and not assignable to the
// writable `Grid` that `carveCircle` wants, so a bot or a renderer cannot carve the authoritative terrain.
type DeepReadonly<T> = T extends Uint32Array
  ? ArrayLike<number>
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * Simulation internals left out of the view: the RNG state and the schedule of upcoming spawns
 * would let a bot see the future, which a player cannot, and one bot's memory is not another's business.
 */
type Internals = "rng" | "nextId" | "nextCrateTick" | "nextBombTick" | "bots";

export type RoundView = DeepReadonly<Omit<RoundState, Internals>>;
export type CastleView = DeepReadonly<Castle>;
export type RocketView = DeepReadonly<Rocket>;
export type GateView = DeepReadonly<Gate>;
export type CrateView = DeepReadonly<Crate>;
export type GhostView = DeepReadonly<Ghost>;
export type TerrainView = DeepReadonly<Grid>;
