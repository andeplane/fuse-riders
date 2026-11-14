/**
 * The snail. A Worker standing wholly on it mounts, and it crawls toward that Worker's own goal only while the rider
 * holds that way; nothing is banked, so the other team can ride it back. An enemy Worker touching its head is caught:
 * the snail halts for the meal and then the Worker dies. The rider being killed, or leaving, frees the Worker. The
 * button hops the rider off, but not during a meal. An invulnerable Worker cannot be caught.
 */
import { arenaOf, wrapX } from "./maps.js";
import { approach, dirOf } from "./motion.js";
import {
  DISMOUNT_SPEED,
  EAT_STEPS,
  EAT_STEPS_SPEED,
  MOUNT_WAIT,
  MOUTH_REACH,
  REACH_HALF,
  S,
  SNAIL_ACCEL,
  SNAIL_HALF,
  SNAIL_HEIGHT,
  SNAIL_SPEED,
  WORKER_HALF,
  WORKER_HEIGHT,
  speedy,
} from "./tuning.js";
import type { Input, Round, Unit } from "./types.js";
import {
  boxesTouch,
  dropBerry,
  freeVictim,
  freeWorker,
  killUnit,
  release,
  settle,
  turnOrder,
  within,
} from "./units.js";

/** -1 toward the left goal (team 0), 1 toward the right (team 1). */
export const goalDir = (team: number): -1 | 1 => (team === 0 ? -1 : 1);

/** How long the snail takes over a Worker with this rider. */
export const mealSteps = (rider: Unit | undefined): number =>
  rider?.speed ? EAT_STEPS_SPEED : EAT_STEPS;

/** Mounting, dismounting, crawling and eating. Returns the team that rode the snail home this step, or -1. */
export function stepSnail(state: Round, inputs: readonly Input[]): number {
  const arena = arenaOf(state.mapId);
  const snail = state.snail;
  const track = arena.snail.y;
  let rider = state.units[snail.rider];
  if (rider && snail.victim < 0 && inputs[rider.slot]!.pressed) {
    // The button hops off at 45 degrees: the held way, or back the way the snail came.
    const input = inputs[rider.slot]!;
    const way = dirOf(input);
    const dir: -1 | 1 = way !== 0 ? way : rider.team === 0 ? 1 : -1;
    release(state, rider);
    rider.vx = dir * DISMOUNT_SPEED;
    rider.vy = -DISMOUNT_SPEED;
    rider.facing = dir;
    rider.ground = -1;
    rider.light = false;
    rider.flapped = true;
    rider.mountWait = MOUNT_WAIT;
    rider = undefined;
  }
  if (!rider)
    for (const slot of turnOrder(state)) {
      const unit = state.units[slot]!;
      if (
        freeWorker(unit) &&
        unit.gate < 0 &&
        unit.mountWait === 0 &&
        unit.ground >= 0 &&
        Math.abs(unit.y - track) <= S &&
        within(unit, snail.x, track, SNAIL_HALF, SNAIL_HEIGHT)
      ) {
        settle(unit);
        unit.riding = true;
        snail.rider = slot;
        snail.vx = 0;
        snail.facing = goalDir(unit.team);
        state.events.push({ type: "snailMount", slot });
        rider = unit;
        break;
      }
    }
  if (!rider) {
    snail.vx = 0;
    return -1;
  }
  const dir = goalDir(rider.team);
  snail.facing = dir;
  const mouth = wrapX(snail.x + dir * (SNAIL_HALF + WORKER_HALF));
  if (snail.victim >= 0) {
    snail.vx = 0;
    snail.eat -= 1;
    const victim = state.units[snail.victim]!;
    victim.x = mouth;
    victim.y = track;
    if (snail.eat <= 0) {
      state.events.push({
        type: "snailEat",
        victim: victim.slot,
        rider: rider.slot,
      });
      killUnit(state, victim, rider.slot);
    }
  } else {
    const head = snail.x + dir * (SNAIL_HALF + Math.trunc(MOUTH_REACH / 2));
    for (const slot of turnOrder(state)) {
      const unit = state.units[slot]!;
      // An invulnerable Worker (fresh from a respawn, a gate or a hive hole) walks past the mouth unharmed.
      if (
        !freeWorker(unit) ||
        unit.team === rider.team ||
        unit.mountWait > 0 ||
        unit.invuln > 0 ||
        !boxesTouch(
          unit.x,
          unit.y,
          REACH_HALF,
          WORKER_HEIGHT,
          head,
          track,
          Math.trunc(MOUTH_REACH / 2),
          SNAIL_HEIGHT,
        )
      )
        continue;
      // Caught: it lets go of everything.
      dropBerry(state, unit);
      release(state, unit);
      settle(unit);
      unit.eaten = true;
      unit.x = mouth;
      unit.y = track;
      unit.ground = -1;
      snail.victim = slot;
      snail.eat = mealSteps(rider);
      snail.vx = 0;
      state.events.push({
        type: "snailCatch",
        victim: slot,
        rider: rider.slot,
      });
      break;
    }
    if (snail.victim < 0) {
      const pushing = dirOf(inputs[rider.slot]!) === dir;
      snail.vx = pushing
        ? approach(
            snail.vx,
            dir * speedy(SNAIL_SPEED, rider.speed),
            SNAIL_ACCEL,
          )
        : 0;
      snail.x += snail.vx;
    }
  }
  rider.x = snail.x;
  rider.y = track;
  rider.vx = 0;
  rider.vy = 0;
  rider.ground = 0;
  rider.facing = dir;
  const goal = arena.snail.goals[rider.team === 0 ? 0 : 1];
  return (snail.x - goal) * dir >= 0 ? rider.team : -1;
}
