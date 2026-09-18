import type { TickContext } from "../context.js";
import {
  EPSILON,
  firstContactTime,
  pointSegmentDistanceSquared,
  square,
} from "../../geometry.js";
import { RIDER_CONTACT_RADIUS } from "../../tuning.js";
import { isHazardImmune } from "../riders.js";
import { markCause } from "../marks.js";
import { nearestDelta } from "../field.js";

/**
 * Riders against riders, every pair once. The relative step is swept, so both are compared at the same instant of the
 * tick, and each is marked `rider` under the other's name unless something makes it immune.
 */
export function detectRiderContacts(ctx: TickContext): void {
  const { state, open, movements, causes, causeOwners, riderContactTimes } =
    ctx;
  const movementList = [...movements.values()];
  for (let first = 0; first < movementList.length; first += 1) {
    for (let second = first + 1; second < movementList.length; second += 1) {
      const a = movementList[first]!;
      const b = movementList[second]!;
      // Sweep the relative position: both endpoints use the same instant in the tick.
      // Comparing the two paths directly also compares positions reached at different
      // times, killing riders that safely follow or pass behind one another (#186).
      // Across an open edge two riders are as close as the short way round says they are.
      const apartX = nearestDelta(open, a.oldX - b.oldX, state.width),
        apartY = nearestDelta(open, a.oldY - b.oldY, state.height);
      const closingX = a.x - a.oldX - (b.x - b.oldX),
        closingY = a.y - a.oldY - (b.y - b.oldY);
      if (
        pointSegmentDistanceSquared(
          0,
          0,
          apartX,
          apartY,
          apartX + closingX,
          apartY + closingY,
        ) <=
        square(2 * RIDER_CONTACT_RADIUS) + EPSILON
      ) {
        // Portal grace is defensive: neither rider is harmed by this contact.
        if (
          a.player.portalGraceUntilTick > state.tick ||
          b.player.portalGraceUntilTick > state.tick
        )
          continue;
        const aInvulnerable = isHazardImmune(a.player, state.tick);
        const bInvulnerable = isHazardImmune(b.player, state.tick);
        const time = firstContactTime(
          (time) =>
            pointSegmentDistanceSquared(
              0,
              0,
              apartX,
              apartY,
              apartX + closingX * time,
              apartY + closingY * time,
            ) <=
            square(2 * RIDER_CONTACT_RADIUS) + EPSILON,
        );
        if (!aInvulnerable)
          riderContactTimes.set(
            a.player.id,
            Math.min(riderContactTimes.get(a.player.id) ?? 1, time),
          );
        if (!bInvulnerable)
          riderContactTimes.set(
            b.player.id,
            Math.min(riderContactTimes.get(b.player.id) ?? 1, time),
          );
        if (!aInvulnerable)
          markCause(causes, causeOwners, a.player.id, "rider", b.player.id);
        if (!bInvulnerable)
          markCause(causes, causeOwners, b.player.id, "rider", a.player.id);
      }
    }
  }
}
