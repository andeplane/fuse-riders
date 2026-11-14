import {
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  stepWorld,
  toView,
  type BikeView,
  type RiderView,
  type WheelView,
  type World,
  type WorldView,
} from "../engine/index.js";
import type { Room } from "../online/game.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded world is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * tick the clock has run past it, with the bits each rider holds, and draws that. A press shows within one log tick
 * (25 ms on average) instead of two. The copy is thrown away: nothing here reaches the room.
 *
 * `ahead` is in steps (0–`MAX_AHEAD`, fractional); the two whole steps either side are blended, so a 120 Hz screen
 * moves the bikes every frame.
 */
export interface ForwardInputs {
  /** What the rider in `slot` is taken to hold `step` steps past the folded world: its last logged bits, or this device's own. */
  held(world: World, slot: number, step?: number): number;
  /** Whether somebody is steering the rider in `slot`: a rider who is away coasts, as in the fold. */
  present(world: World, slot: number): boolean;
}

/** The furthest the screen plays past the newest folded world: one log tick, plus one more while the fold is late. */
export const MAX_AHEAD = STEPS_PER_TICK * 2;

/** A copy of the world deep enough for `stepWorld` to run on without touching the original. */
export function copyWorld(world: World): World {
  return {
    ...world,
    riders: world.riders.map((rider) => ({
      ...rider,
      bike: { ...rider.bike },
    })),
  };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const point = <P extends { x: number; y: number }>(
  a: P,
  b: P,
  t: number,
): P => ({
  ...a,
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
});
/** An angle part of the way from `a` to `b`; a turn of more than half a circle in one step is a wrap, not a spin. */
const angle = (a: number, b: number, t: number) =>
  Math.abs(b - a) > Math.PI ? a : mix(a, b, t);
const wheel = (a: WheelView, b: WheelView, t: number): WheelView => ({
  ...point(a, b, t),
  rot: angle(a.rot, b.rot, t),
});

/** A bike further than this from where it was a step ago was put back on the start: never smear across that. */
export const TELEPORT = 2;

function blendBike(a: BikeView, b: BikeView, t: number): BikeView {
  return {
    ...point(a, b, t),
    rot: angle(a.rot, b.rot, t),
    left: wheel(a.left, b.left, t),
    right: wheel(a.right, b.right, t),
    body: point(a.body, b.body, t),
    head: point(a.head, b.head, t),
    flipped: a.flipped,
  };
}

function blendRider(a: RiderView, b: RiderView, t: number): RiderView {
  if (
    a.id !== b.id ||
    a.status !== b.status ||
    b.run < a.run ||
    Math.hypot(b.bike.x - a.bike.x, b.bike.y - a.bike.y) > TELEPORT
  )
    return a;
  return { ...a, bike: blendBike(a.bike, b.bike, t) };
}

/** `a` and `b` one step apart, `t` of the way from one to the other; clocks and flags are `a`'s until `t` reaches 1. */
export function blendViews(a: WorldView, b: WorldView, t: number): WorldView {
  if (t <= 0) return a;
  if (t >= 1) return b;
  // Another level or a new race starts over: never smear across one.
  if (a.level !== b.level || a.riders.length !== b.riders.length) return a;
  return {
    ...a,
    riders: a.riders.map((rider, slot) =>
      blendRider(rider, b.riders[slot] ?? rider, t),
    ),
  };
}

/** The newest world played forward `ahead` steps, as a view to draw. */
export function forward(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
): WorldView {
  const steps = Math.max(0, Math.min(MAX_AHEAD, ahead));
  const whole = Math.floor(steps),
    part = steps - whole;
  const copy = copyWorld(world);
  const held = (step: number) =>
      world.riders.map((_, slot) => inputs.held(world, slot, step)),
    present = world.riders.map((_, slot) => inputs.present(world, slot));
  for (let i = 0; i < whole; i++) stepWorld(copy, held(i), present);
  const a = toView(copy);
  if (part <= 0.001 || copy.phase === "over") return a;
  stepWorld(copy, held(whole), present);
  return blendViews(a, toView(copy), part);
}

/**
 * How many steps past the newest frame the clock is, from the runtime's frame timing: `tick` is the presentation's
 * game clock and `lead` how far the clock runs past it, in log ticks. Normally 0–4.
 */
export function stepsAhead(
  timing: { tick: number; lead: number },
  newerTick: number,
): number {
  return Math.max(
    0,
    Math.min(
      STEPS_PER_TICK,
      timing.tick + timing.lead * STEPS_PER_TICK - newerTick,
    ),
  );
}

/**
 * The bits the forward run plays for each rider: a seated, connected rider holds what it last logged, and this
 * device's own bike holds, step by step, what this device has logged for the steps the room has not folded yet
 * (`live` as a function of the step) — the same bits on the same steps the fold will play, so the picture is the
 * bike the room is about to compute and nothing snaps back when it does.
 */
export function forwardInputs(
  room: Room,
  me: string,
  live: number | ((step: number) => number),
): ForwardInputs {
  const seated = (world: World, slot: number) => {
    const seat = room.seats.get(world.riders[slot]?.id ?? "");
    return seat && !seat.bot && seat.connected ? seat : undefined;
  };
  return {
    held(world, slot, step = 0) {
      const seat = seated(world, slot);
      if (!seat) return 0;
      if (seat.id !== me) return room.held[seat.id] ?? 0;
      return typeof live === "number" ? live : live(step);
    },
    present: (world, slot) => seated(world, slot) !== undefined,
  };
}

const STEP_MS = 1000 / STEPS_PER_SECOND;

/**
 * Keeps the drawn clock moving when the fold is a few milliseconds late. The runtime folds a log tick on a 10 ms
 * timer, so for a moment after the clock passes a tick boundary its newest world is still the one before, and
 * `stepsAhead` stops at a whole tick: the picture would hold still for that frame, then jump. While it is pinned
 * there, the wall clock carries the count on from the last unpinned frame, up to `MAX_AHEAD`; once the next tick is
 * folded the runtime's own timing takes over again, from the same place in time.
 */
export function createLeadClock(): (
  ahead: number,
  newerTick: number,
  nowMs: number,
) => number {
  let tick = Number.NaN,
    origin = 0;
  return (ahead, newerTick, nowMs) => {
    if (newerTick !== tick || ahead < STEPS_PER_TICK) {
      tick = newerTick;
      origin = nowMs - ahead * STEP_MS;
      return ahead;
    }
    return Math.max(ahead, Math.min(MAX_AHEAD, (nowMs - origin) / STEP_MS));
  };
}
