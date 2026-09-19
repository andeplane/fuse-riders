import type { TickContext } from "../context.js";
import {
  EPSILON,
  pointSegmentDistanceSquared,
  square,
} from "../../geometry.js";
import { PICKUP_RADIUS, RIDER_RADIUS } from "../../tuning.js";
import { PICKUPS, canCollect } from "../../pickups.js";

/**
 * Each pickup goes to the nearest rider whose step reaches it (seat order breaks a tie) and takes effect at once, so
 * a Star collected this tick already protects against this tick's hazards. Pickups are visited in id order: a portal
 * or a black hole draws from the shared random stream as it is placed.
 */
export function collectPickups(ctx: TickContext): void {
  const { state, movements, events, facts } = ctx;
  const consumed = new Set<number>();
  for (const pickup of [...state.pickups].sort((a, b) => a.id - b.id)) {
    const collectors = [...movements.values()]
      .filter(({ player }) => canCollect(pickup.type, player))
      .map((movement) => ({
        movement,
        distance: pointSegmentDistanceSquared(
          pickup.x,
          pickup.y,
          movement.oldX,
          movement.oldY,
          movement.x,
          movement.y,
        ),
      }))
      .filter(
        ({ distance }) =>
          distance <= square(RIDER_RADIUS + PICKUP_RADIUS) + EPSILON,
      )
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.movement.player.slot - b.movement.player.slot,
      );
    const collector = collectors[0]?.movement.player;
    if (!collector) continue;
    // What it does comes first: a pickup that cannot take effect after all (a portal with nowhere safe to open) stays.
    if (
      PICKUPS[pickup.type].collect({
        state,
        pickup,
        collector,
        movements,
      }) === false
    )
      continue;
    consumed.add(pickup.id);
    events.push({
      type: "pickupCollected",
      playerId: collector.id,
      pickupId: pickup.id,
    });
    facts.push({
      kind: "pickupCollected",
      playerId: collector.id,
      pickup: pickup.type,
    });
  }
  if (consumed.size > 0)
    state.pickups = state.pickups.filter((pickup) => !consumed.has(pickup.id));
}
