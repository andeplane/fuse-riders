import {
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  cloneWorld,
  stepWorld,
  toView,
  type World,
  type WorldView,
} from "../engine/index.js";
import type { BotInput, Room } from "../online/game.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded world is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * tick the clock has run past it, with the bits each rider holds, and draws that. A press shows within one log tick
 * (25 ms on average) instead of two. The copy is thrown away: nothing here reaches the room.
 *
 * `ahead` is in steps (0–`MAX_AHEAD`, fractional); the two whole steps either side are blended, so a 120 Hz screen
 * moves the riders and the surges every frame.
 */
export interface ForwardInputs {
  /** What the rider in `slot` is taken to hold: a human's last logged bits (or this device's own, live), 0 when away. */
  held(world: World, slot: number): number;
}

/** The furthest the screen plays past the newest folded world: one log tick, plus one more while the fold is late. */
export const MAX_AHEAD = STEPS_PER_TICK * 2;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** `a` and `b` a moment apart, `t` of the way from one to the other; counts and flags are `a`'s until `t` reaches 1. */
export function blendViews(a: WorldView, b: WorldView, t: number): WorldView {
  if (t <= 0) return a;
  if (t >= 1) return b;
  // A new round puts everyone back on the start line: never smear across one.
  if (a.round !== b.round) return a;
  return {
    ...a,
    riders: a.riders.map((rider, slot) => {
      const next = b.riders[slot] ?? rider;
      return {
        ...rider,
        x: mix(rider.x, next.x, t),
        y: mix(rider.y, next.y, t),
      };
    }),
    surges: a.surges.map((surge) => {
      const next = b.surges.find((each) => each.id === surge.id);
      return next ? { ...surge, x: mix(surge.x, next.x, t) } : surge;
    }),
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
  const copy = cloneWorld(world);
  const held = world.riders.map((_, slot) => inputs.held(world, slot));
  for (let i = 0; i < whole; i++) stepWorld(copy, held);
  const a = toView(copy);
  if (part <= 0.001 || copy.phase === "over") return a;
  stepWorld(copy, held);
  return blendViews(a, toView(copy), part);
}

/**
 * How many steps past the newest frame the clock is, from the runtime's frame timing: `tick` is the presentation's
 * game clock and `lead` how far the clock runs past it, in log ticks. Normally 0–6.
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
 * The bits the forward run plays for each rider: a bot answers as the fold would, a seated human holds what it last
 * logged, and with `localLead` this device's own rider holds what its player holds right now, logged or not.
 */
export function forwardInputs(
  room: Room,
  me: string,
  live: number,
  localLead: boolean,
  bot: BotInput,
): ForwardInputs {
  return {
    held(world, slot) {
      const id = world.riders[slot]?.id ?? "";
      const seat = room.seats.get(id);
      if (seat?.bot) return bot(world, slot, room.play.bot);
      if (!seat?.connected) return 0;
      if (localLead && id === me) return live;
      return room.held[id] ?? 0;
    },
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

/** The bot's answer for a world is the same every frame until the next tick is folded: ask it once per step and rider. */
export function memoBot(bot: BotInput): BotInput {
  const cache = new Map<string, number>();
  let at = -1;
  return (world, slot, level) => {
    if (world.step !== at) {
      at = world.step;
      cache.clear();
    }
    const key = `${slot}:${level}:${world.seed}`;
    let bits = cache.get(key);
    if (bits === undefined) {
      bits = bot(world, slot, level);
      cache.set(key, bits);
    }
    return bits;
  };
}
