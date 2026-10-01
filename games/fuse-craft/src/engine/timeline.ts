import { canAttack } from "./catalog.js";
import type { Outcome, World } from "./types.js";

/**
 * The match's history for the statistics screen: a sample of every player
 * every ten seconds, and a short log of the moments that decided the game.
 * Both live in the world, so a checkpoint, a reconnecting peer and the AI
 * tournament all see the same record.
 */
export const TIMELINE = Object.freeze({
  /** Ticks between samples (10 s). */
  interval: 200,
  /** Samples kept; a 15-minute match needs 90. */
  maxSamples: 400,
  maxEvents: 300,
});

export interface PlayerSample {
  id: string;
  territory: number;
  structures: number;
  /** Connected structures that can fire. */
  weapons: number;
  biomassEarned: number;
  insightEarned: number;
  damage: number;
  lost: number;
  biomass: number;
}
export interface TimelineSample {
  tick: number;
  players: PlayerSample[];
}
export const EVENT_TYPES = [
  "researched",
  "claimed",
  "eliminated",
  "dominating",
  "dominanceBroken",
  "firstBlood",
  "brainHit",
] as const;
export type MatchEventType = (typeof EVENT_TYPES)[number];
export interface MatchEvent {
  tick: number;
  playerId: string;
  type: MatchEventType;
  detail?: string;
}

export function sample(w: Readonly<World>): TimelineSample {
  return {
    tick: w.tick,
    players: w.players.map((p) => {
      const own = w.structures.filter((s) => s.ownerId === p.id);
      return {
        id: p.id,
        territory: p.territory,
        structures: own.length,
        weapons: own.filter(
          (s) => s.connected && s.kind !== "brain" && canAttack(s.kind),
        ).length,
        biomassEarned: p.statistics.biomassEarned,
        insightEarned: p.statistics.insightEarned,
        damage: p.statistics.damage,
        lost: p.statistics.lost,
        biomass: p.biomass,
      };
    }),
  };
}

/** Records this tick's decisive moments and, on schedule or at the end, a sample. */
export function recordTimeline(w: World, outcomes: readonly Outcome[]): void {
  const log = (event: MatchEvent) => {
    if (w.events.length < TIMELINE.maxEvents) w.events.push(event);
  };
  for (const o of outcomes) {
    if (o.type === "researched" && o.reason)
      log({
        tick: w.tick,
        playerId: o.playerId,
        type: "researched",
        detail: o.reason,
      });
    else if (o.type === "claimed" && o.reason)
      log({
        tick: w.tick,
        playerId: o.playerId,
        type: "claimed",
        detail: o.reason,
      });
    else if (
      o.type === "eliminated" ||
      o.type === "dominating" ||
      o.type === "dominanceBroken"
    )
      log({ tick: w.tick, playerId: o.playerId, type: o.type });
  }
  const damage = outcomes.filter(
    (o) => o.type === "damage" && o.cell !== undefined,
  );
  if (damage.length && !w.events.some((e) => e.type === "firstBlood"))
    log({ tick: w.tick, playerId: damage[0]!.playerId, type: "firstBlood" });
  // The first time each brain is struck is a turning point worth marking.
  for (const o of damage) {
    const victim = w.structures.find(
      (s) => s.cell === o.cell && s.kind === "brain",
    );
    if (
      victim &&
      !w.events.some(
        (e) => e.type === "brainHit" && e.detail === victim.ownerId,
      )
    )
      log({
        tick: w.tick,
        playerId: o.playerId,
        type: "brainHit",
        detail: victim.ownerId,
      });
  }
  if (
    (w.tick % TIMELINE.interval === 0 || w.finished) &&
    w.timeline.length < TIMELINE.maxSamples &&
    w.timeline.at(-1)?.tick !== w.tick
  )
    w.timeline.push(sample(w));
}
