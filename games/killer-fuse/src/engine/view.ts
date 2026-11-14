/**
 * What a renderer draws: the round in art pixels, with the map's fixed pieces joined to their state. Nothing here
 * feeds back into the simulation, so these numbers may be fractions; the state itself stays integer subpixels.
 */
import { MAPS, type GateKind, type MapDef } from "./maps.js";
import { COLLIDERS, WEAPONS, lethal } from "./shapes.js";
import { mealSteps } from "./snail.js";
import { timedOut } from "./step.js";
import {
  FLAP_THRUST,
  FLY_GRAVITY,
  FLY_TERMINAL,
  GATE_LOCK,
  GATE_OFFER,
  GATE_STEPS,
  PILE_HEIGHT,
  QUEEN_EGGS,
  QUEEN_LETHAL,
  RESPAWN_STEPS,
  S,
  TICK_HZ,
  TIME_LIMIT,
  WARRIOR_LETHAL,
} from "./tuning.js";
import { gateLocked } from "./units.js";
import type { GameEvent, Round, UnitKind, VictoryKind } from "./types.js";

/** The types a renderer needs besides the views, so it imports this module alone. */
export type { GameEvent, GateKind, MapDef, UnitKind, VictoryKind };

/**
 * The rule values presentation runs on, as data in every view so the renderer never imports the tuning. Lengths are
 * in art pixels and times in engine steps, the units the rest of the view uses. One frozen object serves every view.
 */
export interface ViewRules {
  /** Engine steps per second: `step`, `attackStep` and every count below are in them. */
  readonly tickHz: number;
  /** Steps a dead unit waits to respawn. */
  readonly respawnSteps: number;
  /** Height of a hanging pile's art over its anchor. */
  readonly pileHeight: number;
  /** Steps of an attack, from the press, on which the weapon kills and the dash carries the body. */
  readonly lethalSteps: { readonly queen: number; readonly warrior: number };
  /** How far a dash raises the body's movement box over the feet. */
  readonly dashLift: { readonly queen: number; readonly warrior: number };
  /** How far below her feet a diving Queen's blade reaches. */
  readonly diveTip: number;
  /** Flight, in pixels a step each step: what a flap pushes up, what gravity pulls down, and the fastest fall. */
  readonly flapThrust: number;
  readonly flyGravity: number;
  readonly flyTerminal: number;
  /** A Worker's stay in a gate, in steps: the offer, the lock, and both together. */
  readonly gateOffer: number;
  readonly gateLock: number;
  readonly gateSteps: number;
}

export const VIEW_RULES: ViewRules = Object.freeze({
  tickHz: TICK_HZ,
  respawnSteps: RESPAWN_STEPS,
  pileHeight: PILE_HEIGHT / S,
  lethalSteps: Object.freeze({ queen: QUEEN_LETHAL, warrior: WARRIOR_LETHAL }),
  dashLift: Object.freeze({
    queen: COLLIDERS.queenDash.lift / S,
    warrior: COLLIDERS.warriorDash.lift / S,
  }),
  diveTip: Math.max(...WEAPONS.queenDive.map((box) => box.y + box.hh)) / S,
  flapThrust: FLAP_THRUST / S,
  flyGravity: FLY_GRAVITY / S,
  flyTerminal: FLY_TERMINAL / S,
  gateOffer: GATE_OFFER,
  gateLock: GATE_LOCK,
  gateSteps: GATE_STEPS,
});

export interface UnitView {
  slot: number;
  team: number;
  kind: UnitKind;
  speed: boolean;
  /** Centre x and feet y in art pixels. */
  x: number;
  y: number;
  facing: -1 | 1;
  grounded: boolean;
  moving: boolean;
  flapped: boolean;
  diving: boolean;
  /** The attack's dash is carrying the unit. */
  dashing: boolean;
  /** The weapon kills on this step: a sword in its lethal window, a Queen dashing or diving. */
  attacking: boolean;
  /** The step of the running attack (1 on the press, through its cooldown), 0 without one. */
  attackStep: number;
  /** Stunned by a glance or a bump: no control until it wears off. `stun` is the steps left. */
  stunned: boolean;
  stun: number;
  /** Locked in a gate while it transforms, and sitting in a hive hole while it banks its berry. */
  locked: boolean;
  depositing: boolean;
  carrying: boolean;
  invulnerable: boolean;
  dead: boolean;
  /** 0 just after death to 1 at the respawn. */
  respawn: number;
  riding: boolean;
  eaten: boolean;
  bot: boolean;
}

export interface GateView {
  x: number;
  y: number;
  kind: GateKind;
  /** The team that claimed it, or -1. */
  owner: number;
  /** The slot standing in it, or -1, and how far its transformation is, 0 to 1. */
  user: number;
  progress: number;
}

export interface RoundView {
  map: MapDef;
  rules: ViewRules;
  step: number;
  units: UnitView[];
  /** Berries left per pile, at the map's pile positions. */
  piles: { x: number; y: number; count: number; hanging: boolean }[];
  loose: { x: number; y: number }[];
  /** Per team: every hole and whether it is filled. */
  hives: { x: number; y: number; filled: boolean }[][];
  gates: GateView[];
  snail: {
    x: number;
    y: number;
    facing: -1 | 1;
    rider: number;
    victim: number;
    /** 0 when not eating, rising to 1 as the meal ends. */
    eating: number;
  };
  eggs: number[];
  /** Per team: where each spare egg stands on the hive floor, and whether it is still there (not yet hatched). */
  spares: { x: number; y: number; present: boolean }[][];
  /** Per team: the index in `spares` of the egg a dead Queen is about to hatch from, or -1. */
  hatching: number[];
  berries: number[];
  winner: { team: number; kind: VictoryKind } | null;
  /** Whole seconds of play left before the clock decides the game, counting down from 300 to 0. */
  timeLeft: number;
  /** The clock decided: `winner.kind` then names what broke the tie (eggs, berries, snail) rather than a victory. */
  timeUp: boolean;
  events: GameEvent[];
}

export function viewOf(state: Round): RoundView {
  const map = MAPS[state.mapId];
  const meal = mealSteps(state.units[state.snail.rider]);
  return {
    map,
    rules: VIEW_RULES,
    step: state.step,
    units: state.units.map((unit) => ({
      slot: unit.slot,
      team: unit.team,
      kind: unit.kind,
      speed: unit.speed,
      x: unit.x / S,
      y: unit.y / S,
      facing: unit.facing,
      grounded: unit.ground >= 0,
      moving: unit.vx !== 0,
      flapped: unit.flapped,
      diving: unit.diving,
      dashing: unit.dashing,
      attacking: lethal(unit),
      attackStep: unit.attack,
      stunned: unit.stun > 0,
      stun: unit.stun,
      locked: gateLocked(unit),
      depositing: unit.deposit >= 0,
      carrying: unit.carrying,
      invulnerable: unit.invuln > 0,
      dead: unit.dead,
      respawn: unit.dead ? 1 - unit.respawn / RESPAWN_STEPS : 0,
      riding: unit.riding,
      eaten: unit.eaten,
      bot: !state.humans[unit.slot],
    })),
    piles: map.piles.map((pile, index) => ({
      x: pile.x,
      y: pile.y,
      count: state.piles[index] ?? 0,
      hanging: pile.hanging,
    })),
    loose: state.loose.map((berry) => ({ x: berry.x / S, y: berry.y / S })),
    hives: map.holes.map((holes, team) =>
      holes.map((hole, index) => ({
        x: hole.x,
        y: hole.y,
        filled: state.holes[team]?.[index] === true,
      })),
    ),
    gates: map.gates.map((gate, index) => {
      const user = state.gates[index]?.user ?? -1;
      return {
        x: gate.x,
        y: gate.y,
        kind: gate.kind,
        owner: state.gates[index]?.owner ?? -1,
        user,
        progress: (state.units[user]?.gateProgress ?? 0) / GATE_STEPS,
      };
    }),
    snail: {
      x: state.snail.x / S,
      y: map.snail.y,
      facing: state.snail.facing,
      rider: state.snail.rider,
      victim: state.snail.victim,
      eating: state.snail.victim < 0 ? 0 : 1 - state.snail.eat / meal,
    },
    eggs: [...state.eggs],
    spares: map.eggSpots.map((spots, team) => {
      // The egg a dead Queen will hatch from stays until she does.
      const waiting = state.units[team]?.dead === true ? 1 : 0;
      const hatched = QUEEN_EGGS - state.eggs[team]! - waiting;
      return spots.map((spot, index) => ({
        x: spot.x,
        y: spot.y,
        present: index >= hatched,
      }));
    }),
    hatching: state.eggs.map((eggs, team) =>
      state.units[team]?.dead === true && eggs > 0 ? QUEEN_EGGS - 1 - eggs : -1,
    ),
    berries: state.holes.map((holes) => holes.filter(Boolean).length),
    winner: state.winner,
    timeLeft: Math.ceil(Math.max(0, TIME_LIMIT - state.step) / TICK_HZ),
    timeUp: timedOut(state),
    events: state.events,
  };
}
