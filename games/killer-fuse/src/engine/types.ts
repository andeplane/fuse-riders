/**
 * The round state and everything in it. It is plain data: numbers, booleans, strings, arrays and plain objects, so it
 * survives `structuredClone` and a JSON round trip, and a rollback is a copy. Lengths are integer subpixels.
 */
import type { GateKind, MapId } from "./maps.js";

export type UnitKind = "worker" | "warrior" | "queen";
export type BotLevel = "easy" | "medium" | "hard";
export type VictoryKind = "military" | "economy" | "snail";

/** One slot's controls for one 60 Hz step. `pressed` is the button's edge: true only on the step it went down. */
export interface Input {
  left: boolean;
  right: boolean;
  down: boolean;
  held: boolean;
  pressed: boolean;
}

export interface Unit {
  slot: number;
  team: number;
  kind: UnitKind;
  /** Went through a speed gate: 1.35 times run, rise and snail speed. */
  speed: boolean;
  /** Centre x and feet y. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  /** Index of the platform stood on, or -1 in the air. */
  ground: number;
  /** Steps left in which a Worker that walked off a ledge may still jump. */
  coyote: number;
  /** A Worker's jump is still rising under a held button. */
  jumping: boolean;
  /** Flapped (or jumped) on this step: for the renderer and sound. */
  flapped: boolean;
  /** A Queen diving on this step. */
  diving: boolean;
  carrying: boolean;
  /** The gate being used and the steps stood in it, or -1 and 0. */
  gate: number;
  gateProgress: number;
  /** Steps of invulnerability left. */
  invuln: number;
  dead: boolean;
  /** Steps until the respawn while dead. */
  respawn: number;
  riding: boolean;
  /** Held in the snail's mouth. */
  eaten: boolean;
  /** Steps until this Worker may mount the snail again. */
  mountWait: number;
}

export interface LooseBerry {
  x: number;
  y: number;
  vx: number;
  vy: number;
  resting: boolean;
  /** Steps until it can be kicked or picked up again. */
  wait: number;
  /** The slot that last carried or kicked it. */
  by: number;
}

export interface GateState {
  /** The team whose Queen claimed it, or -1 while neutral. */
  owner: number;
  /** The slot standing in it, or -1. */
  user: number;
}

export interface Snail {
  x: number;
  /** The riding slot, or -1. */
  rider: number;
  /** The slot in its mouth, or -1, and the steps left of the meal. */
  victim: number;
  eat: number;
  facing: -1 | 1;
}

export type GameEvent =
  | { type: "kill"; victim: number; killer: number }
  | { type: "queenKill"; victim: number; killer: number; eggsLeft: number }
  | { type: "bounce"; a: number; b: number }
  | { type: "bump"; worker: number; target: number }
  | { type: "berryPickup"; slot: number; pile: number }
  | { type: "berryDrop"; slot: number }
  | { type: "berryKick"; slot: number }
  | { type: "berryDeposit"; slot: number; team: number; hole: number }
  | { type: "berryKickIn"; slot: number; team: number; hole: number }
  | { type: "berryRegrow" }
  | { type: "gateUse"; slot: number; gate: number; kind: GateKind }
  | { type: "gateClaim"; slot: number; gate: number; team: number }
  | { type: "snailMount"; slot: number }
  | { type: "snailEat"; victim: number; rider: number }
  | { type: "snailFree"; victim: number }
  | { type: "respawn"; slot: number }
  | { type: "victory"; team: number; kind: VictoryKind };

/** A flight or walk goal a bot is pursuing; see bot.ts. */
export type BotGoal =
  | "idle"
  | "gather"
  | "bank"
  | "gate"
  | "ride"
  | "stall"
  | "flee"
  | "hunt"
  | "claim"
  | "evade"
  | "guard";

/** A bot's memory. It is ordinary round state: hashed, cloned by rollback and checkpointed with everything else. */
export interface BotMind {
  /** Steps until the next decision: the reaction delay. */
  think: number;
  goal: BotGoal;
  /** The slot, pile or gate the goal is about, or -1. */
  target: number;
  /** Where to go, in subpixels, and for a Worker the platform it stands on. */
  tx: number;
  ty: number;
  node: number;
  /** The nav edge being flown and the steps since its launch, or -1 and 0. */
  edge: number;
  edgeStep: number;
  /** Steps until the next flap is allowed: flap precision. */
  flapWait: number;
  /** Steps left of doing nothing (a blunder). */
  idle: number;
  /** A Queen may dive at the target. */
  dive: boolean;
  /** This round's plan, drawn at the start: prefers the snail, wants to become a Warrior. */
  rider: boolean;
  soldier: boolean;
}

export interface Round {
  rules: string;
  mapId: MapId;
  seed: number;
  rng: number;
  botLevel: BotLevel;
  /** The level each team's bots play at; both are `botLevel` outside headless level-against-level runs. */
  teamLevels: BotLevel[];
  /** Per slot: true when a person plays it, false when a bot does. */
  humans: boolean[];
  /** Steps simulated so far. */
  step: number;
  units: Unit[];
  /** Berries left in each map pile. */
  piles: number[];
  loose: LooseBerry[];
  /** Filled hive holes, per team. */
  holes: boolean[][];
  gates: GateState[];
  snail: Snail;
  /** Queen lives left, per team. */
  eggs: number[];
  /** Steps the piles have been empty. */
  dry: number;
  winner: { team: number; kind: VictoryKind } | null;
  bots: BotMind[];
  /** What happened on the last step, in order. Cleared at the start of every step. */
  events: GameEvent[];
}

export interface RoundOptions {
  seed: number;
  mapId?: MapId;
  botLevel?: BotLevel;
  /** Per slot; missing slots are bots. */
  humans?: readonly boolean[];
  /** Bot level per team, for headless level-against-level runs; defaults to `botLevel` for both. */
  teamLevels?: readonly [BotLevel, BotLevel];
}
