/**
 * The round state and everything in it. It is plain data: numbers, booleans, strings, arrays and plain objects, so it
 * survives `structuredClone` and a JSON round trip, and a rollback is a copy. Lengths are integer subpixels.
 */
import type { GateKind, MapId } from "./maps.js";

export type UnitKind = "worker" | "warrior" | "queen";
export type BotLevel = "easy" | "medium" | "hard";
export type VictoryKind = "military" | "economy" | "snail";
/**
 * A tutorial lesson's setup, made for the Cyan learner in seat 2 (a Worker) or seat 0 (the Queen): "berries" and
 * "warrior" lay a berry beside seat 2's spawn, "snail" starts the snail a quarter of the way from Cyan's goal, and
 * "queen" changes nothing on the map.
 */
export type Lesson = "berries" | "warrior" | "snail" | "queen";

/**
 * One slot's controls for one 60 Hz step. `pressed` is the jump / flap button's edge and `attack` the attack
 * button's: each true only on the step its button went down. There is no "up".
 */
export interface Input {
  left: boolean;
  right: boolean;
  down: boolean;
  held: boolean;
  pressed: boolean;
  attack: boolean;
}

export interface Unit {
  slot: number;
  team: number;
  kind: UnitKind;
  /** Went through a speed gate: 1.3 times run, flight and snail speed. */
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
  /** A Worker's jump is still pushed up by a held button. */
  jumping: boolean;
  /** The step of a held jump (1 on the launch), 0 without one, -1 while the push fades for one more step. */
  jumpStep: number;
  /** Flapped (or jumped) on this step: for the renderer and sound. */
  flapped: boolean;
  /** A Queen diving on this step. */
  diving: boolean;
  /** Steps of thrust left in each of the MAX_FLAPS flaps that can run at once; 0 is a free one. */
  flaps: number[];
  /** Steps of ground take-off thrust left. */
  takeoff: number;
  /**
   * The weaker gravity applies until the next landing: a flyer that took off from the ground, a Worker that walked
   * off a ledge without jumping.
   */
  light: boolean;
  /** Steps of stun left after a glance or a bump: no steering, no flap, no jump, facing locked. */
  stun: number;
  /** The stun came from a glance (sword on sword): it also blocks attacking and diving. */
  regular: boolean;
  /** The step of the running attack, 1 on the press, through its cooldown; 0 when another may start. */
  attack: number;
  /** The attack's dash is still carrying the unit. */
  dashing: boolean;
  /** Steps left in which an attack press that could not start an attack still will. */
  attackBuffer: number;
  /** Down was held on the last step: a dive starts on the press, not the hold. */
  downHeld: boolean;
  /** Steps left in which a press that could not take effect still will. */
  buffer: number;
  carrying: boolean;
  /** The gate being used and the steps stood in it, or -1 and 0. From GATE_OFFER steps on the Worker is locked in. */
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
  /** Steps until this Worker may mount the snail, or be caught by it, again. */
  mountWait: number;
  /** The own hive hole this Worker sits in while it banks its berry, and the steps it has, or -1 and 0. */
  deposit: number;
  depositStep: number;
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
  vx: number;
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
  /**
   * Two enemies bumped bodies and were thrown apart. `x`, `y` here and on `glance`, `stomped` and `gateUse` are where
   * it happened, in whole art pixels. The engine always sets the fields marked optional; they are optional only so
   * that events written before they existed still fit the type.
   */
  | { type: "bounce"; a: number; b: number; x?: number; y?: number }
  /** Not emitted since rules 4; kept so the type's users keep compiling. */
  | { type: "bump"; worker: number; target: number }
  /** An attack began: a sword dash. */
  | { type: "attack"; slot: number }
  /** Sword met sword: nobody dies, both are thrown back. */
  | { type: "glance"; a: number; b: number; x: number; y: number }
  /** `by` landed on `slot`'s head and bounced off. */
  | { type: "stomped"; slot: number; by: number; x: number; y: number }
  | { type: "berryPickup"; slot: number; pile: number }
  | { type: "berryDrop"; slot: number }
  | { type: "berryKick"; slot: number }
  /** A Worker climbed into a hive hole; `berryDeposit` follows when its berry counts. */
  | { type: "depositStart"; slot: number; team: number; hole: number }
  | { type: "berryDeposit"; slot: number; team: number; hole: number }
  | { type: "berryKickIn"; slot: number; team: number; hole: number }
  | { type: "berryRegrow" }
  /** A Worker began offering its berry to a gate; `gateLock` when the gate takes it; `gateUse` when it steps out. */
  | { type: "gateOffer"; slot: number; gate: number }
  | { type: "gateLock"; slot: number; gate: number }
  | {
      type: "gateUse";
      slot: number;
      gate: number;
      kind: GateKind;
      x?: number;
      y?: number;
    }
  | { type: "gateClaim"; slot: number; gate: number; team: number }
  | { type: "snailMount"; slot: number }
  /** The snail caught `victim` and began its meal; `snailEat` when it ends in the kill, `snailFree` when it is let go. */
  | { type: "snailCatch"; victim: number; rider: number }
  | { type: "snailEat"; victim: number; rider: number }
  | { type: "snailFree"; victim: number }
  /** `egg` is the spare egg a Queen hatched from (its index in the map's egg spots), -1 for anyone else. */
  | { type: "respawn"; slot: number; egg?: number }
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
  /** Steps left of wanting to attack, and of holding a dive. */
  strike: number;
  plunge: number;
  /** This bot's extra sword reach, in subpixels, drawn once. */
  noise: number;
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
  /** Tutorial rooms: every bot stands where it is and never attacks, so the enemy Queen stays where she hatches. */
  passive: boolean;
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
  /** Bots hold no controls at all: for tutorial rooms. */
  passive?: boolean;
  /** A tutorial lesson's starting position; see `Lesson`. */
  lesson?: Lesson;
}
