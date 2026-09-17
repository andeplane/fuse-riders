import { TICK_HZ } from "../shared/game.js";
import type { ViewSnapshot } from "./snapshot-stream.js";

/** The locator fades out over the end of the countdown, so it is gone by the time the riders move. */
export const SELF_LOCATOR_FADE_TICKS = TICK_HZ;
/** Room the arrow and its "YOU" caption need on the side of the rider they are drawn on, caption glyphs included. */
export const SELF_LOCATOR_REACH = 125;
const RING_PERIOD_MS = 1500;
const RING_FAR = 120;
const RING_NEAR = 30;

/**
 * 0–1 strength of the "this one is you" locator on a rider's own screen: full as the countdown opens, fading out
 * over its end, and never there once play has started. Snapshot time keeps it in step with pauses, reconnects and
 * rollback.
 */
export function selfLocatorStrength(snapshot: ViewSnapshot): number {
  if (snapshot.phase !== "countdown" || snapshot.phaseEndsAtTick === undefined)
    return 0;
  const left =
    snapshot.phaseEndsAtTick - (snapshot.presentationTick ?? snapshot.tick);
  return Math.max(0, Math.min(1, left / SELF_LOCATOR_FADE_TICKS));
}

/** -1 draws the arrow above the rider, 1 below: it flips when the top boundary leaves no room for it. */
export function selfLocatorSide(y: number, top: number): -1 | 1 {
  return y - top < SELF_LOCATOR_REACH ? 1 : -1;
}

/** The ring that closes in on the rider, over and over; `alpha` rises as it arrives. */
export function selfLocatorRing(now: number): {
  radius: number;
  alpha: number;
} {
  const t = (((now / RING_PERIOD_MS) % 1) + 1) % 1;
  return { radius: RING_FAR + (RING_NEAR - RING_FAR) * t, alpha: t };
}
