/**
 * Presentation time, in one place: what is drawn between two simulated ticks, and the local rider led ahead of
 * them. Nothing here feeds the simulation; a view goes in, a view comes out.
 */
import {
  advanceRiderPose,
  gravityBend,
  wrapDelta,
  type MotionControls,
} from "../../engine/view-kit.js";
import type { WorldView } from "../../engine/view.js";

/** All discrete state belongs to the earlier tick; never expose future trail/death state. */
export function interpolateWorld(
  older: WorldView | undefined,
  newer: WorldView,
  fraction: number,
): WorldView {
  if (
    !older ||
    older.round !== newer.round ||
    older.phase !== newer.phase ||
    fraction >= 1
  )
    return newer;
  const f = Math.max(0, Math.min(1, fraction));
  // Over open edges a rider or shell that crossed between the two ticks went the short way round, through the edge.
  const open = newer.openEdges;
  const dx = (delta: number): number =>
    open ? wrapDelta(delta, newer.width) : delta;
  const dy = (delta: number): number =>
    open ? wrapDelta(delta, newer.height) : delta;
  return {
    ...older,
    tick: older.tick + (newer.tick - older.tick) * f,
    players: older.players.map((previous) => {
      const player = newer.players.find((p) => p.id === previous.id);
      if (
        !player ||
        !previous.alive ||
        !player.alive ||
        previous.portalCooldownUntilTick !== player.portalCooldownUntilTick
      )
        return previous;
      const delta = Math.atan2(
        Math.sin(player.angle - previous.angle),
        Math.cos(player.angle - previous.angle),
      );
      return {
        ...previous,
        x: previous.x + dx(player.x - previous.x) * f,
        y: previous.y + dy(player.y - previous.y) * f,
        angle: previous.angle + delta * f,
      };
    }),
    bombs: older.bombs.map((previous) => {
      const bomb = newer.bombs.find((b) => b.id === previous.id);
      if (
        !bomb?.shell ||
        !previous.shell ||
        bomb.shell.vx !== previous.shell.vx ||
        bomb.shell.vy !== previous.shell.vy
      )
        return previous;
      return {
        ...previous,
        x: previous.x + dx(bomb.x - previous.x) * f,
        y: previous.y + dy(bomb.y - previous.y) * f,
      };
    }),
  };
}

export interface LocalRider {
  id: string;
  controls: MotionControls;
  lead: number;
}
/**
 * The speculative world at a fractional presentation tick between the two most recent simulated ticks. The local
 * rider is advanced `lead` ticks further with the controls it holds right now: steering shows on the next frame
 * while the simulation catches up. Deaths, pickups and scores come from the newest tick as simulated.
 */
export function presentWorld(
  older: WorldView | undefined,
  newer: WorldView,
  presentationTick: number,
  local?: LocalRider,
): WorldView {
  // Two frames are one log tick apart, which is several game ticks when a bots-only endgame runs extra steps per tick.
  const shown =
    older && presentationTick < newer.tick
      ? interpolateWorld(
          older,
          newer,
          (presentationTick - older.tick) /
            Math.max(1, newer.tick - older.tick),
        )
      : newer;
  const rider =
    local && newer.phase === "playing"
      ? shown.players.find((p) => p.id === local.id)
      : undefined;
  if (!rider || !rider.alive || local!.lead <= 0) return shown;
  const lead = Math.min(1, local!.lead);
  // The step the simulation will give this rider on the tick after `newer`, as the newest view states it.
  const next = newer.players.find((p) => p.id === rider.id) ?? rider;
  const motion = { distance: next.speed, turn: next.turn };
  const pose = advanceRiderPose(
    {
      x: rider.x,
      y: rider.y,
      angle:
        rider.angle +
        gravityBend(
          newer.gravityFields.filter(
            (field) => field.expiresAtTick > newer.tick + 1,
          ),
          rider,
          motion.turn * lead,
        ),
      drunkHeadingOffset: 0,
    },
    local!.controls,
    {
      distance: motion.distance * lead,
      turn: motion.turn * lead,
      drunkHeadingOffset: 0,
    },
  );
  const distance = Math.hypot(pose.x - rider.x, pose.y - rider.y);
  const trail =
    distance > 0 && distance <= motion.distance + 1e-6
      ? [
          ...rider.trail,
          {
            x1: rider.x,
            y1: rider.y,
            x2: pose.x,
            y2: pose.y,
            createdTick: newer.tick,
            expiresAtTick: newer.tick + 4,
          },
        ]
      : rider.trail;
  return {
    ...shown,
    players: shown.players.map((p) =>
      p.id === rider.id
        ? {
            ...p,
            x: pose.x,
            y: pose.y,
            angle: pose.angle,
            trail,
            presentationTick: presentationTick + lead,
          }
        : p,
    ),
  };
}

/** `presentWorld` over what a runtime hands out (`RoomRuntime.presentation()`): two frames, a time and a lead. */
export function presentFrames(frames: {
  older?: WorldView;
  newer: WorldView;
  tick: number;
  local?: LocalRider;
}): WorldView {
  return presentWorld(frames.older, frames.newer, frames.tick, frames.local);
}
