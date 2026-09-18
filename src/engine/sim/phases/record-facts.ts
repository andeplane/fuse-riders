import type { DeathFact, TickContext } from "../context.js";
import {
  recordBombExploded,
  recordBombPlaced,
  recordDeath,
  recordPickup,
  recordPortalTransit,
  recordSurvivalTick,
} from "../../match-stats.js";
import { detectMoments } from "../../moments.js";
import { recordShot, recordShotKill } from "../../shot-log.js";
import type { GameState } from "../../state.js";

/**
 * The only phase that writes match statistics, the shot log and the highlight moments. The physics before it states
 * facts and never reads any of the three, so statistics cannot steer an outcome and a new statistic never touches a
 * phase. Facts are replayed in the order they happened: a kill looks its shot up in the log, and a Gun's pull
 * is logged on the same tick it kills. Runs once every elimination of the tick is known and before the round
 * resolves, because the round's scoring and its decided shot log read what is written here.
 */
export function recordFacts(ctx: TickContext): void {
  const { state, elapsed, events, facts, observations } = ctx;
  const stats = state.matchStats;
  for (const fact of facts) {
    switch (fact.kind) {
      case "pickupCollected":
        recordPickup(stats, fact.playerId, fact.pickup);
        break;
      case "bombExploded":
        recordBombExploded(stats, fact.ownerId);
        break;
      case "survived":
        recordSurvivalTick(
          stats,
          fact.playerId,
          fact.distance,
          fact.invulnerable,
          fact.bounced,
        );
        break;
      case "portalCrossed":
        recordPortalTransit(stats, fact.playerId);
        break;
      case "shotFired": {
        const combat = stats.get(fact.shot.shooterId)?.combat;
        if (combat) combat.uses[fact.shot.weapon] += 1;
        recordShot(state.shots, fact.shot);
        break;
      }
      case "bombPlaced":
        recordBombPlaced(stats, fact.playerId);
        break;
      case "died":
        recordDeathFact(state, elapsed, fact.death);
        break;
    }
  }
  for (const moment of detectMoments(state, elapsed, observations))
    events.push({
      type: "moment",
      moment: { ...moment, targetIds: [...moment.targetIds] },
    });
}

/**
 * A kill is credited only when exactly one rider was behind the winning cause. `recordDeath` turns a rider's own bomb
 * into a self death with no kill, and the shot log likewise never books a pull against its own shooter, so blowing
 * yourself up stays a death with no kill anywhere. The credited owner is necessarily the shot's shooter: every
 * explosion mark on the victim came from that one owner's bombs.
 */
function recordDeathFact(
  state: GameState,
  elapsed: number,
  { victim, cause, owners, shot }: DeathFact,
): void {
  const soleOwner = owners.length === 1 ? owners[0] : undefined;
  const weapon =
    shot === undefined
      ? undefined
      : state.shots.find((entry) => entry.shot === shot)?.weapon;
  recordDeath(
    state.matchStats,
    victim.id,
    cause,
    soleOwner,
    cause === "explosion"
      ? soleOwner === undefined
        ? "unknown"
        : (weapon ?? "unknown")
      : cause,
  );
  if (
    cause === "explosion" &&
    soleOwner !== undefined &&
    soleOwner !== victim.id &&
    shot !== undefined
  )
    recordShotKill(state.shots, shot, { victimId: victim.id, elapsed });
}
