import type { DeathFact, TickContext } from "../context.js";
import { recordDeath } from "../../match-stats.js";
import { logShotKill } from "../recording.js";
import { takeOutOfRound } from "../riders.js";

/**
 * Today's behaviour, named rather than chosen. The sweep finds every death of the tick and only then commits them.
 * The instant hits — a Target Bomb's blast, a bullet — have always committed each rider's death before the next
 * rider's trail is burnt, and a wreck's trail takes its piece ids from the same counter a burnt trail does. Committing
 * them after the whole pass, as the sweep does, would number those pieces differently: a rules change. While this is
 * true `resolveInstantHits` drains the queue rider by rider and the `commitInstantDeaths` phase finds it empty; stage
 * A4 can turn it off in its own `[rules]` commit.
 */
export const INSTANT_DEATHS_COMMIT_PER_RIDER = true;

/** The one place a rider dies during a tick: every fact in the queue, in the order the detectors stated them. */
export function commitDeaths(ctx: TickContext): void {
  for (const death of ctx.deaths.splice(0)) commitDeath(ctx, death);
}

function commitDeath(ctx: TickContext, death: DeathFact): void {
  const { state, events, observations } = ctx;
  const { victim, cause, owners } = death;
  takeOutOfRound(state, victim);
  // A kill is credited only when exactly one rider was behind the winning cause; `recordDeath` and the shot log both
  // turn a rider's own bomb into a death nobody is credited with.
  const soleOwner = owners.length === 1 ? owners[0] : undefined;
  recordDeath(
    state.matchStats,
    victim.id,
    cause,
    soleOwner,
    cause === "explosion"
      ? soleOwner !== undefined
        ? (state.shots.find((entry) => entry.shot === death.shot)?.weapon ??
          "unknown")
        : "unknown"
      : cause,
  );
  if (cause === "explosion")
    logShotKill(state, victim.id, soleOwner, death.shot);
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
