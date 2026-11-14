import { DUCK, JUMP } from "./input.js";
import { approach, div, xorshift } from "./math.js";
import * as T from "./tuning.js";
import {
  HIGH,
  LOW,
  footholdX,
  gapAt,
  limitOf,
  speedAt,
  startRound,
  type Kind,
  type Rider,
  type World,
} from "./world.js";

/**
 * One step of a match, 1/120 s: riders move by what they hold, surges advance, strike or are dodged, the next
 * surge is drawn from the world's own generator, and the round's end is settled. Everything is integer arithmetic
 * on the world it is given, so every device that folds the same inputs holds the same world.
 */

const airborne = (rider: Rider): boolean => rider.y !== 0 || rider.vy !== 0;

/** Gravity on a rider with the deck under it. */
function fallOnDeck(rider: Rider, gravity: number): boolean {
  rider.vy -= gravity;
  if (rider.vy < -T.MAX_FALL_V) rider.vy = -T.MAX_FALL_V;
  rider.y += rider.vy;
  if (rider.y > 0) return false;
  rider.y = 0;
  rider.vy = 0;
  return true;
}

/** A rider knocked out tumbles to the edge and drops into the pit, where it rests. */
function tumble(rider: Rider): void {
  rider.x = approach(rider.x, T.OUT_X, T.KNOCK_SPEED);
  if (rider.x >= T.EDGE_X) {
    if (airborne(rider)) fallOnDeck(rider, T.GRAVITY);
    return;
  }
  if (rider.y <= -T.FALL_DEPTH) return;
  rider.vy -= T.GRAVITY;
  if (rider.vy < -T.MAX_FALL_V) rider.vy = -T.MAX_FALL_V;
  rider.y += rider.vy;
  if (rider.y <= -T.FALL_DEPTH) {
    rider.y = -T.FALL_DEPTH;
    rider.vy = 0;
  }
}

function moveRider(world: World, rider: Rider, bits: number): void {
  const jump = (bits & JUMP) !== 0,
    duck = (bits & DUCK) !== 0;
  const pressed = jump && !rider.jumpHeld;
  rider.jumpHeld = jump;
  if (rider.out) return tumble(rider);
  const goal = footholdX(rider.hits, world.rules.hits);
  if (rider.reel > 0) {
    // Thrown back: nothing it holds counts until it has reached its new foothold.
    rider.x = approach(rider.x, goal, T.KNOCK_SPEED);
    if (rider.reel > 1 || rider.x === goal) rider.reel--;
    if (rider.reel === 0) rider.grace = T.GRACE_STEPS;
    if (airborne(rider)) fallOnDeck(rider, T.GRAVITY);
    return;
  }
  if (rider.grace > 0) rider.grace--;
  rider.x = approach(rider.x, goal, T.WALK_SPEED);
  if (pressed) rider.buffer = T.JUMP_BUFFER;
  else if (rider.buffer > 0) rider.buffer--;
  if (!airborne(rider)) {
    if (rider.buffer === 0) {
      rider.duck = duck;
      return;
    }
    rider.buffer = 0;
    rider.duck = false;
    rider.vy = T.JUMP_V;
  }
  // In the air: letting go of jump cuts the rise short, and a duck without jump is a dive. While jump is held it
  // wins, so a duck let go a moment late never swallows a jump.
  const dive = duck && !jump;
  if (dive) {
    if (rider.vy > 0) rider.vy = 0;
  } else if (!jump && rider.vy > T.JUMP_CUT) rider.vy = T.JUMP_CUT;
  if (fallOnDeck(rider, dive ? T.DIVE_GRAVITY : T.GRAVITY)) rider.duck = duck;
}

/** Whether a rider's pose lets a surge of `kind` pass. */
export const clears = (rider: Rider, kind: Kind): boolean =>
  kind === LOW
    ? rider.y > T.LOW_TOP
    : rider.y + (rider.duck ? T.DUCK_H : T.STAND_H) < T.HIGH_BOTTOM;

function strike(world: World, rider: Rider): boolean {
  rider.hits++;
  if (rider.taken < T.MOST_TAKEN) rider.taken++;
  rider.streak = 0;
  rider.duck = false;
  rider.buffer = 0;
  // Thrown into a little hop off the deck; a rider struck in the air never rises faster than that hop.
  if (!airborne(rider) || rider.vy > T.POP_V) rider.vy = T.POP_V;
  rider.grace = 0;
  world.hitCounter = (world.hitCounter + 1) % T.COUNTER;
  if (rider.hits >= world.rules.hits) {
    rider.out = true;
    rider.reel = 0;
    return true;
  }
  rider.reel = T.REEL_STEPS;
  return false;
}

function dodged(world: World, rider: Rider): void {
  if (rider.dodges < T.MOST_DODGES) rider.dodges++;
  if (rider.streak < T.STREAK_FOR_STEP) rider.streak++;
  if (
    world.rules.recover &&
    rider.streak >= T.STREAK_FOR_STEP &&
    rider.hits > 0
  ) {
    rider.hits--;
    rider.streak = 0;
  }
}

/** Settles every surge against every rider it has reached; returns the riders knocked out this step, a bit each. */
function sweep(world: World): number {
  let fallen = 0;
  for (const surge of world.surges)
    for (const [slot, rider] of world.riders.entries()) {
      const bit = 1 << slot;
      if (rider.out || surge.done & bit) continue;
      const gap = surge.x - rider.x;
      if (gap > T.REACH) continue;
      if (gap < -T.REACH) {
        surge.done |= bit;
        dodged(world, rider);
      } else if (rider.reel > 0 || rider.grace > 0) {
        // It passes a rider that cannot be struck: no hit, and no dodge to its name either.
        surge.done |= bit;
      } else if (!clears(rider, surge.kind)) {
        surge.done |= bit;
        surge.hit |= bit;
        if (strike(world, rider)) fallen |= bit;
      }
    }
  return fallen;
}

const chance = (clock: number, from: number, most: number): number => {
  if (clock < from) return 0;
  const grown = 8 + div(clock - from, 120);
  return grown > most ? most : grown;
};

function spawn(world: World): void {
  if (world.nextSpawn > 0) {
    world.nextSpawn--;
    return;
  }
  const { pace } = world.rules;
  world.rng = xorshift(world.rng);
  let kind: Kind = world.rng & 1 ? HIGH : LOW;
  if (world.run >= T.MAX_RUN && kind === world.runKind)
    kind = kind === LOW ? HIGH : LOW;
  world.run = kind === world.runKind ? world.run + 1 : 1;
  world.runKind = kind;
  world.rng = xorshift(world.rng);
  const flip =
    world.rng % 100 < chance(world.clock, T.FLIP_FROM, T.FLIP_CHANCE_MAX);
  world.rng = xorshift(world.rng);
  const pair =
    world.rng % 100 < chance(world.clock, T.PAIR_FROM, T.PAIR_CHANCE_MAX);
  world.rng = xorshift(world.rng);
  // A flipping surge shows the other height until the gate; `kind` is what it strikes as.
  world.surges.push({
    id: world.nextId,
    kind: flip ? (kind === LOW ? HIGH : LOW) : kind,
    flip,
    x: T.SPAWN_X,
    done: 0,
    hit: 0,
  });
  world.nextId = world.nextId >= 0x7fff_ffff ? 1 : world.nextId + 1;
  // A pair comes as close as surges ever do; otherwise the gap is jittered a quarter either way, down to its floor.
  const gap = div(gapAt(world.clock, pace) * (192 + (world.rng % 129)), 256);
  world.nextSpawn = pair
    ? T.PAIR_GAP[pace]
    : gap < T.GAP_MIN[pace]
      ? T.GAP_MIN[pace]
      : gap;
}

function moveSurges(world: World): void {
  const speed = speedAt(world.clock, world.rules.pace);
  let kept = 0;
  for (const surge of world.surges) {
    surge.x -= speed;
    if (surge.flip && surge.x <= T.GATE_X) {
      surge.kind = surge.kind === LOW ? HIGH : LOW;
      surge.flip = false;
    }
    if (surge.x > T.EXIT_X) world.surges[kept++] = surge;
  }
  world.surges.length = kept;
}

/** Ends the round if it is decided: one rider left, the last ones gone together, or the clock run out. */
function settle(world: World, fallen: number): void {
  let standing = 0;
  for (const [slot, rider] of world.riders.entries())
    if (!rider.out) standing |= 1 << slot;
  const count = world.riders.filter((rider) => !rider.out).length;
  if (count === 1) end(world, standing, "last");
  else if (count === 0) end(world, fallen, "wipe");
  else if (world.clock >= limitOf(world.rules)) end(world, standing, "time");
}

function end(world: World, winners: number, reason: "last" | "time" | "wipe") {
  for (const [slot, rider] of world.riders.entries())
    if (winners & (1 << slot)) rider.wins++;
  world.lastWinners = winners;
  world.lastReason = reason;
  world.phase = "break";
  world.phaseSteps = T.BREAK_STEPS;
}

/** After the break: the match is over once someone has the wins, otherwise the next round counts down. */
function afterBreak(world: World): void {
  let best = 0;
  for (const rider of world.riders) if (rider.wins > best) best = rider.wins;
  if (best < world.rules.target) return startRound(world, world.round + 1);
  world.phase = "over";
  world.winners = 0;
  for (const [slot, rider] of world.riders.entries())
    if (rider.wins === best) world.winners |= 1 << slot;
}

/** Advances `world` one step with each slot's held bits; a finished match no longer moves. */
export function stepWorld(world: World, inputs: readonly number[]): void {
  if (world.phase === "over") return;
  world.step++;
  for (const [slot, rider] of world.riders.entries())
    moveRider(world, rider, inputs[slot] ?? 0);
  moveSurges(world);
  if (world.phase === "play") {
    const fallen = sweep(world);
    spawn(world);
    world.clock++;
    settle(world, fallen);
    return;
  }
  // The countdown and the break: riders may hop about, and what is left of the surges drifts off harmlessly.
  world.phaseSteps--;
  if (world.phaseSteps > 0) return;
  world.phaseSteps = 0;
  if (world.phase === "ready") world.phase = "play";
  else afterBreak(world);
}

/** The slots that won the match, a bit each; 0 until it is over. */
export const winnersOf = (world: World): number =>
  world.phase === "over" ? world.winners : 0;
