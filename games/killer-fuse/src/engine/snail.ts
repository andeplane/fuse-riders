/**
 * The snail. A Worker who touches it on the floor mounts and moves it toward that Worker's own goal; nothing is
 * banked, so the other team can ride it back. An enemy Worker standing in front of its mouth is caught: the snail
 * halts for EAT_STEPS and then the Worker dies. Killing the rider (or the rider hopping off) frees the Worker.
 */
import { arenaOf, wrapDelta } from "./maps.js";
import {
  EAT_STEPS,
  JUMP_SPEED,
  MOUNT_WAIT,
  MOUTH_REACH,
  S,
  SNAIL_HALF,
  SNAIL_HEIGHT,
  SNAIL_SPEED,
  SPEED_DEN,
  SPEED_NUM,
  speedy,
} from "./tuning.js";
import type { Input, Round } from "./types.js";
import {
  freeVictim,
  freeWorker,
  killUnit,
  turnOrder,
  unitTouches,
} from "./units.js";

/** -1 toward the left goal (team 0), 1 toward the right (team 1). */
export const goalDir = (team: number): -1 | 1 => (team === 0 ? -1 : 1);

/** Mounting, dismounting, crawling and eating. Returns the team that rode the snail home this step, or -1. */
export function stepSnail(state: Round, inputs: readonly Input[]): number {
  const arena = arenaOf(state.mapId);
  const snail = state.snail;
  const track = arena.snail.y;
  let rider = state.units[snail.rider];
  if (rider && inputs[rider.slot]!.pressed) {
    // The button hops off, and whoever was being eaten walks away.
    rider.riding = false;
    rider.vy = -JUMP_SPEED;
    rider.ground = -1;
    rider.mountWait = MOUNT_WAIT;
    snail.rider = -1;
    freeVictim(state);
    rider = undefined;
  }
  if (!rider)
    for (const slot of turnOrder(state)) {
      const unit = state.units[slot]!;
      if (
        freeWorker(unit) &&
        !unit.carrying &&
        unit.gate < 0 &&
        unit.mountWait === 0 &&
        unit.ground >= 0 &&
        Math.abs(unit.y - track) <= S &&
        unitTouches(unit, snail.x, track, SNAIL_HALF, SNAIL_HEIGHT)
      ) {
        unit.riding = true;
        snail.rider = slot;
        snail.facing = goalDir(unit.team);
        state.events.push({ type: "snailMount", slot });
        rider = unit;
        break;
      }
    }
  if (!rider) return -1;
  const dir = goalDir(rider.team);
  snail.facing = dir;
  if (snail.victim >= 0) {
    snail.eat -= 1;
    if (snail.eat <= 0) {
      const victim = state.units[snail.victim]!;
      state.events.push({
        type: "snailEat",
        victim: victim.slot,
        rider: rider.slot,
      });
      killUnit(state, victim, rider.slot);
    }
  } else {
    const mouth = snail.x + dir * SNAIL_HALF;
    for (const slot of turnOrder(state)) {
      const unit = state.units[slot]!;
      if (
        freeWorker(unit) &&
        unit.team !== rider.team &&
        Math.abs(unit.y - track) <= S &&
        Math.abs(wrapDelta(unit.x, mouth + (dir * MOUTH_REACH) / 2)) <=
          MOUTH_REACH / 2 + S
      ) {
        if (unit.gate >= 0) continue;
        unit.eaten = true;
        unit.vx = 0;
        unit.vy = 0;
        snail.victim = slot;
        // A speed rider's snail eats 1.35 times faster.
        snail.eat = rider.speed
          ? Math.trunc((EAT_STEPS * SPEED_DEN) / SPEED_NUM)
          : EAT_STEPS;
        break;
      }
    }
    if (snail.victim < 0) snail.x += dir * speedy(SNAIL_SPEED, rider.speed);
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
