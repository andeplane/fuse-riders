import {
  STEPS_PER_SECOND,
  advanceRider,
  toView,
  type BikeView,
  type RiderView,
  type WheelView,
  type World,
  type WorldView,
} from "../engine/index.js";
import type { Room } from "../online/game.js";

/**
 * What the screen draws of a race whose riders each run on their own clock. The room's newest folded world holds
 * every bike as far as its device has said it rode; the screen plays each one on, on a copy, to where it is now:
 * this device's own bike to this device's clock with the bits it holds (`LocalRide`), so a press shows on the frame
 * it is made and nothing the network does moves it; the others a few steps past what was heard, eased, as ghosts.
 * The copy is thrown away: nothing here reaches the room.
 */
export interface RiderPlan {
  /** The step of the rider's own clock to draw, fractional. */
  to: number;
  /** What the rider holds on a step of its own clock. */
  bits(step: number): number;
}

/** A copy of the world deep enough for the engine to run on without touching the original. */
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

/** The folded world with each planned rider played on to its plan's step, as a view to draw. */
export function project(
  world: World,
  plans: readonly (RiderPlan | undefined)[],
): WorldView {
  if (world.phase === "over") return toView(world);
  const copy = copyWorld(world);
  const parts = plans.map((plan, slot) => {
    const rider = copy.riders[slot];
    if (!plan || !rider) return 0;
    const whole = Math.floor(plan.to);
    for (let step = rider.step; step < whole; step++)
      advanceRider(copy, slot, step + 1, plan.bits(step));
    return rider.step === whole ? plan.to - whole : 0;
  });
  const a = toView(copy);
  if (!parts.some((part) => part > 0.001)) return a;
  for (const [slot, part] of parts.entries()) {
    const rider = copy.riders[slot];
    if (part > 0.001 && rider)
      advanceRider(copy, slot, rider.step + 1, plans[slot]!.bits(rider.step));
  }
  const b = toView(copy);
  return {
    ...a,
    riders: a.riders.map((rider, slot) =>
      blendRider(rider, b.riders[slot] ?? rider, parts[slot] ?? 0),
    ),
  };
}

const STEP_MS = 1000 / STEPS_PER_SECOND;
/** A ghost is drawn at most this many steps past what its device has said: its last held bits carry it there. */
export const GHOST_AHEAD = 10;
/** Where a ghost's drawn clock settles past the newest word of it, and the share of its error closed a frame. */
const GHOST_LEAD = 2,
  GHOST_EASE = 0.1;

/**
 * The other riders' drawn clocks. Word of a bike arrives a tick at a time and late; each ghost's clock runs on the
 * wall clock between words and eases towards a little past the newest one, so it moves every frame at an even
 * pace instead of in the steps the network delivers.
 */
export function createGhosts(): (
  room: Room,
  me: string,
  nowMs: number,
) => (RiderPlan | undefined)[] {
  let key = "",
    last = 0,
    clocks: number[] = [];
  return (room, me, nowMs) => {
    const world = room.world;
    if (!world) return [];
    const race = `${room.matchId}:${room.round}`;
    if (race !== key) {
      key = race;
      clocks = [];
      last = nowMs;
    }
    const elapsed = Math.max(0, Math.min(250, nowMs - last)) / STEP_MS;
    last = nowMs;
    return world.riders.map((rider, slot) => {
      const seat = room.seats.get(rider.id);
      if (rider.id === me || !seat || seat.bot || !seat.connected) {
        clocks[slot] = rider.step;
        return undefined;
      }
      let clock = clocks[slot] ?? rider.step;
      clock += elapsed;
      clock += (rider.step + GHOST_LEAD - clock) * GHOST_EASE;
      clock = Math.max(rider.step, Math.min(rider.step + GHOST_AHEAD, clock));
      clocks[slot] = clock;
      const held = room.held[rider.id] ?? 0;
      return { to: clock, bits: () => held };
    });
  };
}
