import { DUCK, JUMP } from "./input.js";
import { div, mix } from "./math.js";
import * as T from "./tuning.js";
import {
  HIGH,
  LOW,
  speedAt,
  type Kind,
  type Surge,
  type World,
} from "./world.js";

/**
 * A bot's controls for the tick about to run: ordinary held bits, read off the world like a player reads the deck.
 * It has no memory and moves no generator, so every device that folds a tick asks the same question and gets the
 * same answer. `planInput` is the sound plan; a bot follows it except for the surges it fumbles, which are chosen by
 * mixing the match's seed with the surge, so a fumble is the same on every device and lasts the surge's whole run.
 */
export type BotLevel = 0 | 1 | 2;
export const BOT_LEVELS: readonly BotLevel[] = [0, 1, 2];
export const isBotLevel = (value: unknown): value is BotLevel =>
  value === 0 || value === 1 || value === 2;

/** A bot is asked once a tick: it jumps this many steps ahead of a low surge so it is over it in time. */
const JUMP_LEAD = 14;
const DUCK_LEAD = 8;
/** A winner's last hop starts with more of the break left than this, so it has landed when the next round counts in. */
const LAST_HOP = 110;
/** Fumbles per thousand surges at the standard pace's starting speed, by level; faster surges are fumbled more. */
const FUMBLES = [230, 125, 60] as const;
const MOST_FUMBLES = 600;

/** The height a surge will strike at when it reaches the riders: a flip still to come counts. */
const strikeKind = (surge: Surge): Kind =>
  surge.flip ? (surge.kind === LOW ? HIGH : LOW) : surge.kind;

/** The nearest surge this rider still has to deal with. */
function threat(world: World, slot: number): Surge | undefined {
  const rider = world.riders[slot]!;
  const bit = 1 << slot;
  return world.surges.find(
    (surge) => !(surge.done & bit) && surge.x - rider.x >= -T.REACH,
  );
}

/** Whether a rider already in the air stays above a low surge for its whole pass by simply holding jump. */
function carries(y: number, vy: number, from: number, until: number): boolean {
  for (let step = 1; step <= until; step++) {
    vy -= T.GRAVITY;
    y += vy;
    if (y <= 0) return false;
    if (step >= from && y <= T.LOW_TOP + T.U) return false;
  }
  return true;
}

/** The sound answer for `slot`: jump the low ones, duck the high ones, dive out of the air when it has to. */
export function planInput(world: World, slot: number): number {
  const rider = world.riders[slot];
  if (!rider || rider.out) return 0;
  if (world.phase !== "play") {
    // A round's winner hops on the spot through the break, and is back on the deck before it ends.
    const won = world.phase === "break" && world.lastWinners & (1 << slot);
    return won && world.phaseSteps > LAST_HOP && world.phaseSteps % 72 >= 36
      ? JUMP
      : 0;
  }
  const next = threat(world, slot);
  if (!next) return 0;
  const speed = speedAt(world.clock, world.rules.pace);
  const gap = next.x - rider.x - T.REACH;
  const eta = gap <= 0 ? 0 : div(gap, speed);
  const air = rider.y !== 0 || rider.vy !== 0;
  if (strikeKind(next) === HIGH) {
    if (air) return DUCK;
    return eta <= DUCK_LEAD ? DUCK : 0;
  }
  if (!air) return eta <= JUMP_LEAD ? JUMP : 0;
  const pass = div(2 * T.REACH, speed) + 2;
  return carries(rider.y, rider.vy, eta, eta + pass) ? JUMP : DUCK;
}

/** What a bot of `level` holds: the plan, or for a surge it fumbles, the wrong move or none at all. */
export function botInput(world: World, slot: number, level: BotLevel): number {
  const plan = planInput(world, slot);
  if (world.phase !== "play") return plan;
  const rider = world.riders[slot];
  const next = rider && !rider.out ? threat(world, slot) : undefined;
  if (!next || !rider) return plan;
  const speed = speedAt(world.clock, world.rules.pace);
  const rate = div(FUMBLES[level] * speed, T.SPEED_BASE[1]);
  const roll = mix(world.seed, world.round, next.id, slot) % 1000;
  if (roll >= (rate > MOST_FUMBLES ? MOST_FUMBLES : rate)) return plan;
  // Half the fumbles freeze; the other half read the surge upside down.
  if (roll % 2 === 0) return 0;
  const gap = next.x - rider.x - T.REACH;
  if (gap > JUMP_LEAD * speed) return 0;
  return strikeKind(next) === HIGH ? JUMP : DUCK;
}
