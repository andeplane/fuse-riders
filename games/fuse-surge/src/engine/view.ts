import { div } from "./math.js";
import * as T from "./tuning.js";
import {
  footholdX,
  limitOf,
  slotsOf,
  speedAt,
  type Kind,
  type Phase,
  type Reason,
  type World,
} from "./world.js";

/**
 * What the presentation sees of a match: pixels along the deck (x from its edge, y up from its surface, fractions
 * allowed), speeds in pixels per step, timers in steps. Effects are the presentation's own, driven by counts
 * changing between two views; a rollback that replays a step leaves a count where it was, so nothing fires twice.
 */
export interface RiderView {
  id: string;
  slot: number;
  x: number;
  /** Feet above the deck, px; negative while falling into the pit. */
  y: number;
  vy: number;
  air: boolean;
  duck: boolean;
  /** Hits taken this round, and the foothold that puts it on, px. */
  hits: number;
  foothold: number;
  out: boolean;
  /** Being thrown back right now. */
  reeling: boolean;
  /** Nothing can strike it: reeling, or just after. */
  safe: boolean;
  streak: number;
  wins: number;
  dodges: number;
  taken: number;
}
export interface SurgeView {
  id: number;
  kind: Kind;
  /** It will change height at the gate. */
  flips: boolean;
  x: number;
}
export interface WorldView {
  step: number;
  phase: Phase;
  round: number;
  /** Steps of the countdown or the break left. */
  remaining: number;
  /** Steps of the round's clock left, and its whole length. */
  clock: number;
  limit: number;
  /** The surges' speed now and at the start of a round, px per step. */
  speed: number;
  speedStart: number;
  maxHits: number;
  target: number;
  recover: boolean;
  /** Dodges in a row that win a foothold back. */
  streakFor: number;
  riders: RiderView[];
  surges: SurgeView[];
  /** The last round's winners by slot, and how it ended. */
  lastWinners: number[];
  lastReason: Reason;
  /** The match's winners by slot, once it is over. */
  winners: number[];
  hitCounter: number;
}

export function toView(world: World): WorldView {
  const limit = limitOf(world.rules);
  return {
    step: world.step,
    phase: world.phase,
    round: world.round,
    remaining: world.phaseSteps,
    clock: limit - world.clock,
    limit,
    speed: speedAt(world.clock, world.rules.pace) / T.U,
    speedStart: speedAt(0, world.rules.pace) / T.U,
    maxHits: world.rules.hits,
    target: world.rules.target,
    recover: world.rules.recover,
    streakFor: T.STREAK_FOR_STEP,
    riders: world.riders.map((rider, slot) => ({
      id: rider.id,
      slot,
      x: rider.x / T.U,
      y: rider.y / T.U,
      vy: rider.vy / T.U,
      air: rider.y !== 0 || rider.vy !== 0,
      duck: rider.duck,
      hits: rider.hits,
      foothold: footholdX(rider.hits, world.rules.hits) / T.U,
      out: rider.out,
      reeling: rider.reel > 0,
      safe: rider.reel > 0 || rider.grace > 0,
      streak: rider.streak,
      wins: rider.wins,
      dodges: rider.dodges,
      taken: rider.taken,
    })),
    surges: world.surges.map((surge) => ({
      id: surge.id,
      kind: surge.kind,
      flips: surge.flip,
      x: surge.x / T.U,
    })),
    lastWinners: slotsOf(world.lastWinners, world.riders.length),
    lastReason: world.lastReason,
    winners: slotsOf(world.winners, world.riders.length),
    hitCounter: world.hitCounter,
  };
}

/** Whole seconds left of `steps`, rounded up, for a countdown. */
export const secondsLeft = (steps: number): number =>
  steps <= 0 ? 0 : div(steps + T.STEPS_PER_SECOND - 1, T.STEPS_PER_SECOND);
