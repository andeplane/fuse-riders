import {
  FINISHED,
  DEAD,
  levelOf,
  ranking,
  type Phase,
  type World,
} from "./world.js";
import * as T from "./tuning.js";

/**
 * What the presentation sees of a race: world units with y up, angles in radians counter-clockwise, timers in steps.
 * Effects are the presentation's own, driven by counters and statuses changing between two views; a rollback that
 * replays a step leaves them where they were, so nothing fires twice.
 */
export interface WheelView {
  x: number;
  y: number;
  rot: number;
}
export interface BikeView {
  /** The frame's centre and rotation. */
  x: number;
  y: number;
  rot: number;
  /** The wheel on the frame's left and right at rest; the rear and the front when not `flipped`, swapped when it is. */
  left: WheelView;
  right: WheelView;
  /** The rider's sprung body point (the hips' anchor) and the centre of the head's circle. */
  body: { x: number; y: number };
  head: { x: number; y: number };
  /** Facing left. */
  flipped: boolean;
}
export type RiderStatus = "riding" | "dead" | "finished";
export interface RiderView {
  id: string;
  slot: number;
  status: RiderStatus;
  bike: BikeView;
  /** The apples eaten this run: bit `n` is the level's `n`th apple. */
  taken: bigint;
  apples: number;
  /** Which way is down: 0 up, 1 down, 2 left, 3 right. */
  gravity: number;
  /** Steps the current run has lasted; the finishing run's length once finished. */
  run: number;
  /** The race step it finished on, or 0. */
  finish: number;
  /** 1 for the leader; finishers first. */
  place: number;
  deaths: number;
  /** Dead: steps until the restart. */
  wait: number;
  gas: boolean;
  brake: boolean;
}
export interface WorldView {
  /** Index into `LEVELS` (`view-kit.ts`). */
  level: number;
  /** Apples the level holds. */
  apples: number;
  phase: Phase;
  /** Countdown: steps until the start. */
  go: number;
  /** Steps raced since the start. */
  step: number;
  /** Steps until the race closes. */
  left: number;
  /** True once somebody is home and the rest are on the clock. */
  closing: boolean;
  riders: RiderView[];
}

const bitCount = (bits: bigint): number => {
  let count = 0;
  for (; bits; bits &= bits - 1n) count++;
  return count;
};

export function toView(world: World): WorldView {
  const places = ranking(world);
  return {
    level: world.level,
    apples: levelOf(world).apples.length,
    phase: world.phase,
    go: world.go,
    step: world.step,
    left: Math.max(0, world.close - world.step),
    closing: world.close < T.RACE_LIMIT,
    riders: world.riders.map((rider, slot) => {
      const b = rider.bike;
      return {
        id: rider.id,
        slot,
        status:
          rider.status === FINISHED
            ? "finished"
            : rider.status === DEAD
              ? "dead"
              : "riding",
        bike: {
          x: b.fx,
          y: b.fy,
          rot: b.frot,
          left: { x: b.lx, y: b.ly, rot: b.lrot },
          right: { x: b.rx, y: b.ry, rot: b.rrot },
          body: { x: b.bx, y: b.by },
          head: { x: b.hx, y: b.hy },
          flipped: b.flipped === 0,
        },
        taken: rider.taken,
        apples: bitCount(rider.taken),
        gravity: b.gravity,
        run: rider.run,
        finish: rider.finish,
        place: places.indexOf(slot) + 1,
        deaths: rider.deaths,
        wait: rider.wait,
        gas: (rider.prev & 1) !== 0,
        brake: (rider.prev & 2) !== 0,
      };
    }),
  };
}

/** Steps as a clock in hundredths of a second. */
export const centiseconds = (steps: number): number =>
  Math.floor((steps * 100) / T.STEPS_PER_SECOND);
