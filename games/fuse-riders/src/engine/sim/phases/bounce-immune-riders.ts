import type { TickContext } from "../context.js";
import { isHazardImmune } from "../../effects.js";
import { reflectAtBoundary } from "../riders.js";

/**
 * A rider no hazard can touch — a Star, shield grace, portal grace — is turned back by the wall instead of dying on it.
 * After pickups, so a Star collected this tick already bounces.
 */
export function bounceImmuneRiders(ctx: TickContext): void {
  const { state, movements, bounced } = ctx;
  for (const movement of movements.values()) {
    if (
      isHazardImmune(movement.player, state.tick) &&
      reflectAtBoundary(state, movement)
    ) {
      bounced.add(movement.player.id);
    }
  }
}
