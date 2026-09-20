import type { TickContext } from "../context.js";
import { advanceScenery, mapTracks } from "../../scenery-motion.js";

/**
 * Scenery that moves takes its step before any rider does, so the whole tick — steps, shells, bullets, blasts — is
 * judged against where it stands at the end of the tick. Where each piece stood before is kept for the hazard sweep:
 * a rider is let out of scenery it already stood in, not of scenery that has just rolled onto it. Each piece advances
 * on its own, so the order they are stored in decides nothing.
 */
export function moveScenery({ state, sceneryBefore }: TickContext): void {
  const tracks = mapTracks(state.map);
  for (const obstacle of state.obstacles) {
    if (!obstacle.motion) continue;
    sceneryBefore.set(obstacle.id, { x: obstacle.x, y: obstacle.y });
    advanceScenery(obstacle, state.width, state.height, tracks);
  }
}
