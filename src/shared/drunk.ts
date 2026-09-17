export const DRUNK_DURATION_TICKS = 80;
export const DRUNK_FADE_TICKS = 10;
/** Fast stagger: the rider leans the other way every few ticks, by a different amount each time, which draws the jagged trail. */
export const DRUNK_STAGGER_KNOT_TICKS = 5;
export const DRUNK_STAGGER_MAX = Math.PI / 6;
/** No lean is gentler than this share of the maximum, so the zigzag never flattens into a straight run. */
const DRUNK_STAGGER_FLOOR = 0.25;
/** Slow lurch: an aimless drift under the stagger, so even a rider who holds a line does not travel straight. */
export const DRUNK_LURCH_KNOT_TICKS = 18;
export const DRUNK_LURCH_MAX = Math.PI / 12;
/** Knots sit on a regular grid, each nudged by up to this share of the spacing, so no two waves are the same length. */
const KNOT_JITTER = 0.25;
export const DRUNK_MAX_HEADING_OFFSET = DRUNK_STAGGER_MAX + DRUNK_LURCH_MAX;

const STAGGER_CHANNEL = 0x51ed270b;
const LURCH_CHANNEL = 0x2f6b8a35;
const TIMING_CHANNEL = 0x7c15d3a9;

function riderHash(seed: number, playerId: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash = Math.imul(hash ^ playerId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/** Independent uniform value in [0, 1] per rider, channel and knot: integer mixing only, so every engine agrees. */
function knotValue(rider: number, channel: number, knot: number): number {
  let hash = (rider ^ channel ^ Math.imul(knot + 1, 0x9e3779b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

/** Smooth curve through one value per knot, each within [-1, 1]. */
function noise(
  age: number,
  knotTicks: number,
  rider: number,
  channel: number,
  valueAt: (knot: number) => number,
): number {
  const timeOf = (knot: number) =>
    knot === 0
      ? 0
      : (knot +
          (knotValue(rider, channel ^ TIMING_CHANNEL, knot) * 2 - 1) *
            KNOT_JITTER) *
        knotTicks;
  let knot = Math.floor(age / knotTicks);
  if (age < timeOf(knot)) knot -= 1;
  else if (age >= timeOf(knot + 1)) knot += 1;
  const from = valueAt(knot);
  const start = timeOf(knot);
  return (
    from +
    (valueAt(knot + 1) - from) *
      smoothstep((age - start) / (timeOf(knot + 1) - start))
  );
}

/** An absolute heading offset, never angular velocity: integrate differences only. */
export function drunkHeadingOffset(
  seed: number,
  playerId: string,
  tick: number,
  startedTick: number,
  untilTick: number,
): number {
  if (
    ![tick, startedTick, untilTick].every(Number.isFinite) ||
    tick <= startedTick ||
    tick >= untilTick
  )
    return 0;
  const age = tick - startedTick;
  const fade = smoothstep(
    Math.min(1, age / DRUNK_FADE_TICKS, (untilTick - tick) / DRUNK_FADE_TICKS),
  );
  const rider = riderHash(seed, playerId);
  const stagger = noise(
    age,
    DRUNK_STAGGER_KNOT_TICKS,
    rider,
    STAGGER_CHANNEL,
    (knot) => {
      const lean =
        DRUNK_STAGGER_FLOOR +
        (1 - DRUNK_STAGGER_FLOOR) * knotValue(rider, STAGGER_CHANNEL, knot);
      return (knot + rider) % 2 === 0 ? lean : -lean;
    },
  );
  const lurch = noise(
    age,
    DRUNK_LURCH_KNOT_TICKS,
    rider,
    LURCH_CHANNEL,
    (knot) => knotValue(rider, LURCH_CHANNEL, knot) * 2 - 1,
  );
  return fade * (DRUNK_STAGGER_MAX * stagger + DRUNK_LURCH_MAX * lurch);
}
