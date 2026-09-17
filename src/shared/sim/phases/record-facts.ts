import type { TickContext } from "../context.js";
import { detectMoments } from "../../moments.js";

/**
 * What the tick's observations amount to is folded into the match's highlight moments, once every elimination of the
 * tick is known and before the round resolves. The kept moments are reported as events.
 */
export function recordFacts(ctx: TickContext): void {
  const { state, elapsed, events, observations } = ctx;
  for (const moment of detectMoments(state, elapsed, observations))
    events.push({
      type: "moment",
      moment: { ...moment, targetIds: [...moment.targetIds] },
    });
}
