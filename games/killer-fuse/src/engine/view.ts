/**
 * What a renderer draws: the round in art pixels, with the map's fixed pieces joined to their state. Nothing here
 * feeds back into the simulation, so these numbers may be fractions; the state itself stays integer subpixels.
 */
import { MAPS, type GateKind, type MapDef } from "./maps.js";
import { timedOut } from "./step.js";
import {
  EAT_STEPS,
  GATE_STEPS,
  RESPAWN_STEPS,
  S,
  SPEED_DEN,
  SPEED_NUM,
  TICK_HZ,
  TIME_LIMIT,
} from "./tuning.js";
import type { GameEvent, Round, UnitKind, VictoryKind } from "./types.js";

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
  step: number;
  units: UnitView[];
  /** Berries left per pile, at the map's pile positions. */
  piles: { x: number; y: number; count: number }[];
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
  const rider = state.units[state.snail.rider];
  const meal = rider?.speed
    ? Math.trunc((EAT_STEPS * SPEED_DEN) / SPEED_NUM)
    : EAT_STEPS;
  return {
    map,
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
    berries: state.holes.map((holes) => holes.filter(Boolean).length),
    winner: state.winner,
    timeLeft: Math.ceil(Math.max(0, TIME_LIMIT - state.step) / TICK_HZ),
    timeUp: timedOut(state),
    events: state.events,
  };
}
