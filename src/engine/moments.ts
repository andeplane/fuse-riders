import { hypot2 } from "./deterministic-math.js";
import { hasEffect } from "./effects.js";
import type { EliminationCause, GameState, PlayerId } from "./state.js";

/**
 * Highlight moments: the plays a table of friends would want replayed (ADR 043). They are detected inside the shared
 * simulation step from facts that exist only there — which segment killed and when it was laid, which bomb landed on
 * a head, how often a shell had bounced — so every replica folds the same list and the recap needs no extra traffic.
 * Only trigger thresholds live here; scores, titles and copy are presentation in match-recap.ts and never touch state.
 */
export type MomentKind =
  | "multiKill"
  | "directHit"
  | "trickShot"
  | "cutOff"
  | "boxedIn"
  | "bombDodge"
  | "ownGoal"
  | "mutualDestruction";
export const MOMENT_KINDS: readonly MomentKind[] = [
  "multiKill",
  "directHit",
  "trickShot",
  "cutOff",
  "boxedIn",
  "bombDodge",
  "ownGoal",
  "mutualDestruction",
];
export interface Moment {
  kind: MomentKind;
  round: number;
  /** Absolute simulation tick, what a replay clip would be cut around; `elapsed` is the tick within the round. */
  tick: number;
  elapsed: number;
  /** The rider the moment belongs to: the killer, the dodger, or the own-goal victim. */
  playerId: PlayerId;
  targetIds: PlayerId[];
  /** The kind's own integer measure: riders, bounces, trail age in ticks, or a distance in arena units. */
  value: number;
}

/** Each kind keeps its first few entries; a match rarely reaches this and no ranking rule lives in state. */
export const MAX_MOMENTS_PER_KIND = 8;
/** Extra round-over (and final-round) pause when the round produced a moment, so every screen can replay it (ADR 044). */
export const REPLAY_PAUSE_TICKS = 80;
/** Identity of a moment within a round: what happened and to whom, not the tick, so a rewind that shifts it by a tick keeps one identity. */
export const momentKey = (moment: Moment): string =>
  `${moment.round}:${moment.kind}:${moment.playerId}:${moment.targetIds.join("+")}`;
export const MAX_MOMENTS = MAX_MOMENTS_PER_KIND * MOMENT_KINDS.length;
/** A trail this young was laid right in front of the victim: about one rider turn of travel. */
export const CUT_OFF_MAX_AGE_TICKS = 12;
/** A shell kill later than this is a stray that pinballed around, not an aimed ricochet. */
export const TRICK_SHOT_MAX_AGE_TICKS = 40;
/** Boxed in: 40 ticks of travel (300 units) that moved the rider less than this far. */
export const BOXED_IN_LOOKBACK_TICKS = 40;
export const BOXED_IN_MAX_DISPLACEMENT = 100;
/** A dodge is having been inside the blast radius this long before it went off, and alive outside it now. */
export const DODGE_LOOKBACK_TICKS = 10;

export interface DeathObservation {
  victimId: PlayerId;
  cause: EliminationCause;
  /** Every rider credited with the cause, the victim included for its own blast; a moment needs exactly one. */
  owners: readonly PlayerId[];
  /** Where the rider died. */
  x: number;
  y: number;
  /** Cause `trail`: age in ticks of the first segment the sweep touched. */
  trailAge?: number;
  /** Cause `explosion`: the owner of a bomb whose landing touched the victim this tick. */
  landingHit?: PlayerId;
  /** Cause `explosion`: the shell that swept into the victim this tick. */
  shellHit?: { ownerId: PlayerId; bounces: number; age: number };
}
export interface DodgeObservation {
  playerId: PlayerId;
  ownerId: PlayerId;
  clearance: number;
}
export interface TickObservations {
  deaths: DeathObservation[];
  dodges: DodgeObservation[];
}

export function pushMoment(state: GameState, moment: Moment): boolean {
  let kept = 0;
  for (const existing of state.moments)
    if (existing.kind === moment.kind) kept += 1;
  if (kept >= MAX_MOMENTS_PER_KIND) return false;
  state.moments.push(moment);
  return true;
}

/**
 * Folds one tick's observations into `state.moments`; runs after every elimination of the tick and before the round
 * resolves. Returns the moments it kept, in the order they were recorded, for the tick's events.
 */
export function detectMoments(
  state: GameState,
  elapsed: number,
  observations: TickObservations,
): Moment[] {
  const { tick, round } = state;
  const recorded: Moment[] = [];
  const record = (
    kind: MomentKind,
    playerId: PlayerId,
    targetIds: PlayerId[],
    value: number,
  ): void => {
    const moment: Moment = {
      kind,
      round,
      tick,
      elapsed,
      playerId,
      targetIds,
      value,
    };
    if (pushMoment(state, moment)) recorded.push(moment);
  };
  const bySlot = (ids: readonly PlayerId[]): PlayerId[] =>
    [...ids].sort(
      (a, b) =>
        (state.players.get(a)?.slot ?? 0) - (state.players.get(b)?.slot ?? 0) ||
        (a < b ? -1 : a > b ? 1 : 0),
    );

  const kills = new Map<PlayerId, PlayerId[]>();
  for (const death of observations.deaths) {
    if (death.owners.length !== 1) continue;
    const owner = death.owners[0]!;
    if (owner === death.victimId) {
      if (death.cause === "explosion") record("ownGoal", owner, [], 1);
      continue;
    }
    const victims = kills.get(owner);
    if (victims) victims.push(death.victimId);
    else kills.set(owner, [death.victimId]);
    if (death.cause === "explosion") {
      if (death.landingHit === owner)
        record("directHit", owner, [death.victimId], 1);
      const shell = death.shellHit;
      if (
        shell &&
        shell.ownerId === owner &&
        shell.bounces >= 1 &&
        shell.age <= TRICK_SHOT_MAX_AGE_TICKS
      )
        record("trickShot", owner, [death.victimId], shell.bounces);
    } else if (death.cause === "trail" && death.trailAge !== undefined) {
      if (death.trailAge <= CUT_OFF_MAX_AGE_TICKS)
        record("cutOff", owner, [death.victimId], death.trailAge);
      const victim = state.players.get(death.victimId);
      // Beer weaving looks exactly like being cornered, so a drunk victim is never boxed in.
      const origin =
        victim && !hasEffect(victim, "drunk", tick)
          ? victim.trail.find(
              (segment) =>
                segment.createdTick === tick - BOXED_IN_LOOKBACK_TICKS,
            )
          : undefined;
      if (origin) {
        const displacement = hypot2(death.x - origin.x1, death.y - origin.y1);
        if (displacement < BOXED_IN_MAX_DISPLACEMENT)
          record("boxedIn", owner, [death.victimId], Math.round(displacement));
      }
    }
  }
  for (const [owner, victims] of kills)
    if (victims.length >= 2)
      record("multiKill", owner, bySlot(victims), victims.length);
  // Everybody dying together is a moment only if somebody did it: two idle riders reaching opposite walls on the same tick is not.
  if (
    observations.deaths.length >= 2 &&
    observations.deaths.some((death) => death.owners.length > 0) &&
    ![...state.players.values()].some((player) => player.alive)
  ) {
    const ids = bySlot(observations.deaths.map((death) => death.victimId));
    record("mutualDestruction", ids[0]!, ids.slice(1), ids.length);
  }
  for (const dodge of observations.dodges)
    record("bombDodge", dodge.playerId, [dodge.ownerId], dodge.clearance);
  return recorded;
}

/** Whether the round now ending produced a moment worth the longer pause. */
export const roundHasMoment = (state: GameState): boolean =>
  state.moments.some((moment) => moment.round === state.round);
