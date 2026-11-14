import type { WorldView } from "../engine/view.js";
import { secondsLeft } from "../engine/view-kit.js";

/**
 * Everything that happened between two views that the presentation shows or sounds, read off the view's counts and
 * flags changing, never stored in the simulation. A rollback that replays a step leaves a count where it was, so
 * nothing fires twice; a view older than the one before it (a rollback past it, or a new match) says nothing.
 */
export type Cue =
  /** A rider left the deck by its own jump. */
  | { kind: "jump"; slot: number }
  /** A rider came down on the deck. */
  | { kind: "land"; slot: number }
  /** A rider dropped into a duck. */
  | { kind: "duck"; slot: number }
  /** A surge struck a rider; `out` when that hit knocked it off the deck. */
  | { kind: "hit"; slot: number; x: number; y: number; out: boolean }
  /** A rider cleared a surge; `streak` is its clean dodges in a row. */
  | { kind: "dodge"; slot: number; streak: number }
  /** A rider won a foothold back. */
  | { kind: "recover"; slot: number }
  /** A surge changed height at the gate. */
  | { kind: "flip"; id: number }
  /** The countdown before a round reached `seconds` (3, 2, 1). */
  | { kind: "count"; seconds: number }
  /** A round began. */
  | { kind: "go"; round: number }
  /** The round's clock reached its last `seconds` (5 and down). */
  | { kind: "tick"; seconds: number }
  /** A round ended. */
  | { kind: "round"; reason: WorldView["lastReason"]; winners: number[] }
  /** The match is over. */
  | { kind: "over"; winners: number[] };

/** The round's clock ticks aloud from here down. */
export const LAST_SECONDS = 5;

export function cuesBetween(
  before: WorldView | undefined,
  after: WorldView,
): Cue[] {
  if (!before || before.step > after.step) return [];
  const cues: Cue[] = [];
  const sameRound = before.round === after.round;
  for (const [slot, now] of after.riders.entries()) {
    const was = before.riders[slot];
    if (!was || !sameRound) continue;
    if (now.taken > was.taken || (now.out && !was.out))
      cues.push({ kind: "hit", slot, x: now.x, y: now.y, out: now.out });
    else if (now.hits < was.hits) cues.push({ kind: "recover", slot });
    if (now.dodges > was.dodges)
      cues.push({ kind: "dodge", slot, streak: now.streak });
    if (now.out || now.reeling) continue;
    if (!was.air && now.air) cues.push({ kind: "jump", slot });
    if (was.air && !now.air) cues.push({ kind: "land", slot });
    if (!was.duck && now.duck) cues.push({ kind: "duck", slot });
  }
  for (const surge of before.surges)
    if (
      surge.flips &&
      after.surges.some((each) => each.id === surge.id && !each.flips)
    )
      cues.push({ kind: "flip", id: surge.id });
  if (after.phase === "ready") {
    const seconds = secondsLeft(after.remaining);
    if (before.phase !== "ready" || secondsLeft(before.remaining) !== seconds)
      cues.push({ kind: "count", seconds });
  }
  if (after.phase === "play") {
    if (before.phase === "ready") cues.push({ kind: "go", round: after.round });
    const seconds = secondsLeft(after.clock);
    if (
      before.phase === "play" &&
      seconds <= LAST_SECONDS &&
      seconds > 0 &&
      secondsLeft(before.clock) !== seconds
    )
      cues.push({ kind: "tick", seconds });
  }
  if (before.phase === "play" && after.phase !== "play")
    cues.push({
      kind: "round",
      reason: after.lastReason,
      winners: [...after.lastWinners],
    });
  if (after.phase === "over" && before.phase !== "over")
    cues.push({ kind: "over", winners: [...after.winners] });
  return cues;
}
