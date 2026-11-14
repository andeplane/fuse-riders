import type { RiderView, WorldView } from "../engine/view.js";
import { LEVELS, STEPS_PER_SECOND } from "../engine/view-kit.js";

/**
 * Everything that happened between two views that the presentation shows or sounds, read off statuses, apple sets
 * and the countdown changing, never stored in the simulation and never taken from events: a rollback that changes
 * an outcome changes the view, and the picture follows.
 */
export type Cue =
  /** Rider `slot` ate the apple at (x, y). */
  | { kind: "apple"; slot: number; x: number; y: number; gravity: boolean }
  /** Rider `slot` crashed with its head at (x, y). */
  | { kind: "crash"; slot: number; x: number; y: number }
  /** Rider `slot` reached the flower at (x, y). */
  | { kind: "finish"; slot: number; x: number; y: number }
  /** The countdown shows `count` (3, 2, 1). */
  | { kind: "count"; count: number }
  | { kind: "go" };

/** Whole seconds left on a countdown of `go` steps. */
export const countOf = (go: number): number =>
  Math.max(0, Math.ceil(go / STEPS_PER_SECOND));

/** The `n`th apple of a level (the bit order of a rider's `taken`), or nothing. */
export function appleAt(
  level: number,
  n: number,
): { x: number; y: number; gravity: boolean } | undefined {
  let index = 0;
  for (const object of LEVELS[level]?.objects ?? []) {
    if (object.kind !== "apple") continue;
    if (index++ === n)
      return { x: object.x, y: object.y, gravity: (object.gravity ?? 0) > 0 };
  }
  return undefined;
}

/** A rider's run carried on from `before` to `after`: the same rider, not restarted in between. */
const sameRun = (before: RiderView, after: RiderView): boolean =>
  before.id === after.id &&
  before.deaths <= after.deaths &&
  (after.status === "dead" || after.run >= before.run);

export function cuesBetween(
  before: WorldView | undefined,
  after: WorldView,
): Cue[] {
  if (!before || before.level !== after.level) return [];
  const cues: Cue[] = [];
  if (after.phase === "countdown") {
    const count = countOf(after.go);
    if (before.phase === "countdown" && count < countOf(before.go) && count > 0)
      cues.push({ kind: "count", count });
    return cues;
  }
  if (before.phase === "countdown") cues.push({ kind: "go" });
  // The race clock went backwards: a new race or a rollback past what was shown says nothing.
  if (before.step > after.step) return cues;
  for (const [slot, now] of after.riders.entries()) {
    const was = before.riders[slot];
    if (!was || was.id !== now.id) continue;
    if (sameRun(was, now)) {
      const gained = now.taken & ~was.taken;
      for (let n = 0, bits = gained; bits; n++, bits >>= 1n)
        if (bits & 1n) {
          const apple = appleAt(after.level, n);
          if (apple) cues.push({ kind: "apple", slot, ...apple });
        }
    }
    if (was.status === "riding" && now.status === "dead")
      cues.push({
        kind: "crash",
        slot,
        x: now.bike.head.x,
        y: now.bike.head.y,
      });
    if (was.status !== "finished" && now.status === "finished")
      cues.push({ kind: "finish", slot, x: now.bike.x, y: now.bike.y });
  }
  return cues;
}

/** How long the same apple, crash or finish stays said, in milliseconds: less than a respawn, more than a rollback. */
export const CUE_HOLD = 500;

/**
 * Drops a cue already given a moment ago. The picture runs ahead of the agreed world on the rider's live input, so
 * a rollback can take an eaten apple back and give it again; it is shown and sounded once.
 */
export function cueGate(): (cues: readonly Cue[], nowMs: number) => Cue[] {
  const said = new Map<string, number>();
  return (cues, nowMs) => {
    for (const [key, at] of said)
      if (nowMs - at >= CUE_HOLD || nowMs < at) said.delete(key);
    return cues.filter((cue) => {
      if (cue.kind === "count" || cue.kind === "go") return true;
      const key =
        cue.kind === "apple"
          ? `apple ${cue.slot} ${cue.x} ${cue.y}`
          : `${cue.kind} ${cue.slot}`;
      if (said.has(key)) return false;
      said.set(key, nowMs);
      return true;
    });
  };
}
