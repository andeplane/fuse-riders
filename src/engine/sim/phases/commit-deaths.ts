import type { DeathFact, TickContext } from "../context.js";
import { takeOutOfRound } from "../riders.js";

/**
 * Today's behaviour, named rather than chosen. The sweep finds every death of the tick and only then commits them.
 * The instant hits commit each rider's death before looking at the next rider. That used to matter: Target Bomb's
 * blast burnt each rider's trail in the same pass, and a wreck's trail takes its piece ids from the same counter a
 * burnt trail does. Since Target Bomb was removed (`fuse-p2p-39`) only bullets are instant and nothing burns between
 * two commits, so both settings number pieces alike. While this is true `resolveInstantHits` drains the queue rider by
 * rider and the `commitInstantDeaths` phase finds it empty; stage A4 can turn it off.
 */
export const INSTANT_DEATHS_COMMIT_PER_RIDER = true;

/**
 * The one place a rider dies during a tick: every fact in the queue, in the order the detectors stated them. The rider
 * leaves the round here; who is credited with what is for `recordFacts`.
 */
export function commitDeaths(ctx: TickContext): void {
  for (const death of ctx.deaths.splice(0)) commitDeath(ctx, death);
}

function commitDeath(ctx: TickContext, death: DeathFact): void {
  const { state, events, facts, observations } = ctx;
  const { victim, cause, owners } = death;
  takeOutOfRound(state, victim);
  facts.push({ kind: "died", death });
  events.push({ type: "playerEliminated", playerId: victim.id, cause });
  observations.deaths.push({
    victimId: victim.id,
    cause,
    owners: [...owners],
    x: death.x,
    y: death.y,
    ...(death.trailAge === undefined ? {} : { trailAge: death.trailAge }),
    ...(death.landingHit === undefined ? {} : { landingHit: death.landingHit }),
    ...(death.shellHit === undefined ? {} : { shellHit: death.shellHit }),
  });
}
