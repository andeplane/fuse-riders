import type { TickContext } from "../context.js";
import {
  type InputIntent,
  type PlayerState,
  sortedPlayers,
} from "../../state.js";
import { advanceRiderPose } from "../../rider-motion.js";
import { drunkHeadingOffset } from "../../drunk.js";
import { gravityBend } from "../../gravity.js";
import { riderMotionStep } from "../../tuning.js";
import { sweepGunAim } from "../../gun.js";

/**
 * Every living rider's step for this tick is worked out and held in the context; nobody is moved yet.
 * Spent speed effects are dropped first, so the step is taken at the speed the state now carries.
 */
export function moveRiders(ctx: TickContext): void {
  const { state, inputs, movements } = ctx;
  for (const player of sortedPlayers(state))
    expireSpeedEffects(player, state.tick);
  for (const player of sortedPlayers(state).filter(
    (candidate) => candidate.alive,
  )) {
    const input = inputs.get(player.id) ?? NEUTRAL_INPUT;
    const offset = drunkHeadingOffset(
      state.seed,
      player.id,
      state.tick,
      player.drunkStartedTick,
      player.drunkUntilTick,
    );
    const { distance, turn, aimSlowTicks, aimSlowSpentTicks } = riderMotionStep(
      player,
      state.tick,
      state.roundStartedTick,
    );
    player.aimSlowTicks = aimSlowTicks;
    player.aimSlowSpentTicks = aimSlowSpentTicks;
    // A held Gun takes the steering for its sight: the rider runs straight while left and right sweep the aim.
    // The release tick still counts as held, so a steering key down as the trigger lets go swings the sight one last
    // step rather than turning the rider under the shot.
    const aiming =
      player.gunAim !== undefined &&
      (input.bomb ||
        (input.bombCommands ?? []).some(
          (command) => command.action === "release",
        ));
    if (aiming) player.gunAim = sweepGunAim(player.gunAim!, input);
    // Curved space turns the rider before the kernel does, so steering and the hole add up inside one ordinary turn-then-move step.
    const pose = advanceRiderPose(
      {
        ...player,
        angle: player.angle + gravityBend(state.gravityFields, player, turn),
      },
      aiming ? NEUTRAL_INPUT : input,
      { distance, turn, drunkHeadingOffset: offset },
    );
    player.drunkHeadingOffset = pose.drunkHeadingOffset;
    movements.set(player.id, {
      player,
      oldX: player.x,
      oldY: player.y,
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
    });
  }
}

/** Drops spent deadlines before movement, so state carries only the effects still in force. */
function expireSpeedEffects(player: PlayerState, tick: number): void {
  const spent = (until: number) => until <= tick;
  if (player.nitroUntilTicks.some(spent))
    player.nitroUntilTicks = player.nitroUntilTicks.filter(
      (until) => !spent(until),
    );
  if (player.snailUntilTicks.some(spent))
    player.snailUntilTicks = player.snailUntilTicks.filter(
      (until) => !spent(until),
    );
}

const NEUTRAL_INPUT: InputIntent = Object.freeze({
  left: false,
  right: false,
  bomb: false,
});
