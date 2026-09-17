import { TICK_HZ } from "../shared/game.js";
import type { ViewSnapshot } from "./snapshot-stream.js";

/** How long the locator lingers, fading, once the riders start moving. */
export const SELF_LOCATOR_LINGER_TICKS = 2 * TICK_HZ;
/** Room the arrow and its "YOU" caption need on the side of the rider they are drawn on. */
export const SELF_LOCATOR_REACH = 150;
const RING_PERIOD_MS = 1100;
const RING_FAR = 230;
const RING_NEAR = 30;

/**
 * 0–1 strength of the "this one is you" locator on a rider's own screen: full through the countdown, then fading
 * over the first moments of play. Snapshot time keeps it in step with pauses, reconnects and rollback.
 */
export function selfLocatorStrength(snapshot: ViewSnapshot): number {
  if (snapshot.phase === "countdown") return 1;
  if (snapshot.phase !== "playing" || snapshot.roundStartedTick === undefined)
    return 0;
  const elapsed =
    (snapshot.presentationTick ?? snapshot.tick) - snapshot.roundStartedTick;
  return Math.max(0, Math.min(1, 1 - elapsed / SELF_LOCATOR_LINGER_TICKS));
}

/** -1 draws the arrow above the rider, 1 below: it flips when the top boundary leaves no room for it. */
export function selfLocatorSide(y: number, top: number): -1 | 1 {
  return y - top < SELF_LOCATOR_REACH ? 1 : -1;
}

/** Rings that close in on the rider, staggered so one is always on its way; `alpha` rises as a ring arrives. */
export function selfLocatorRings(
  now: number,
): Array<{ radius: number; alpha: number }> {
  return [0, 0.5].map((offset) => {
    const t = (((now / RING_PERIOD_MS + offset) % 1) + 1) % 1;
    return { radius: RING_FAR + (RING_NEAR - RING_FAR) * t, alpha: t };
  });
}
