import { JUMP, LEFT, RIGHT } from "./input.js";
import { div, mix } from "./math.js";
import { stepBall, stepWorld } from "./step.js";
import * as T from "./tuning.js";
import {
  cloneWorld,
  courtOf,
  laneOf,
  otherSide,
  touchesOf,
  type Blob,
  type Side,
  type World,
} from "./world.js";

/**
 * The bot: ordinary held bits read off the world like a player reads the screen, asked once per log tick inside the
 * fold, so every device computes the same answer (it is covered by `RULES` and the golden recording). It gets no
 * privileged physics: it plays out a few ways of meeting the ball on a copy of the world, with the other blobs standing
 * still, and does whatever sends the ball over the net best. It never moves the world: its aim error comes from the
 * match seed and the touch count, not from the world's generator.
 *
 * Two a side, the teammate nearer where the ball comes down takes it and the other gets out of the way; between
 * rallies the one nearer the net covers the front and the other the back. A human teammate is read the same way, so a
 * bot leaves a ball its human partner is closer to.
 *
 * Three a side, each bot keeps to its lane: it plays the balls coming down in its lane and waits in the middle of it
 * otherwise. The middle lane holds the serve, so whoever plays it serves.
 *
 * It thinks in its own frame, as if it played the left side: x runs from its own wall (0) to the net.
 */
export const BOT_LEVELS = [0, 1, 2] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const isBotLevel = (value: unknown): value is BotLevel =>
  value === 0 || value === 1 || value === 2;

interface Skill {
  /** Steps it waits after the other side's touch before it reacts. */
  delay: number;
  /** Largest aim error either way, px. */
  error: number;
  /** It jumps to meet high balls instead of waiting for them to drop. */
  attacks: boolean;
}
const SKILL: Readonly<Record<BotLevel, Skill>> = {
  0: { delay: 60, error: 22, attacks: false },
  1: { delay: 24, error: 10, attacks: true },
  2: { delay: 0, error: 0, attacks: true },
};

/** Looks this many steps ahead for a landing, and this many for its own touch. */
const LOOKAHEAD = 480;
const REACH = 96;
/** The ball centre's height, px, where it meets a standing blob's head. */
const CONTACT_Y = 230;
/** Where it waits for the other side's ball, px from the net: one a side, then the front and back of two. */
const HOME = 210,
  FRONT_HOME = 220,
  BACK_HOME = 490;
/** How far behind the ball (towards its own wall) it tries standing, px. */
const OFFSETS = [4, 16, 28] as const;
/** Two a side it may stand further behind the ball too: a flatter hit carries a deep ball over the net. */
const WIDE_OFFSETS = [4, 16, 28, 40, 50] as const;
/** Close enough: it moves 18 px a tick, so nearer than this it stands still. */
const SLACK = 9;

/** x in px seen from `side`'s own wall. */
const own = (world: World, side: Side, px: number): number =>
  side === 0 ? px : courtOf(world).w - px;
/** A ball x (in ball units) in px seen from `side`'s own wall, rounded the same way on both sides. */
const ownBall = (world: World, side: Side, units: number): number =>
  div(side === 0 ? units : courtOf(world).w * T.BU - units, T.BU);

/** A copy of the world the bot can play forward without touching the real one. */
const copy = cloneWorld;

/** Where the ball, untouched, first comes down through `height` px: its own-frame x, or undefined if not soon. */
export function landing(
  world: World,
  side: Side,
  height: number,
): number | undefined {
  if (!world.ball.live) return;
  const ghost: World = { ...world, phase: "dead", ball: { ...world.ball } };
  const line = height * T.BU;
  for (let i = 0; i < LOOKAHEAD; i++) {
    stepBall(ghost);
    ghost.step++;
    if (ghost.ball.vy < 0 && ghost.ball.y <= line)
      return ownBall(world, side, ghost.ball.x);
  }
  return;
}

/**
 * How good it is to walk towards `target` (and jump at once, if `jump`): the touch is played out on a copy and scored
 * by where the ball then comes down. Over the net is best; a set on its own side with touches to spare is next; a
 * miss or a fourth touch is worst.
 */
function plan(
  world: World,
  slot: number,
  target: number,
  jump: boolean,
): number {
  const ghost = copy(world);
  const me = ghost.blobs[slot]!,
    side = me.side,
    net = courtOf(world).net;
  const hits = ghost.hitCounter,
    points = ghost.pointCounter;
  const forward = side === 0 ? RIGHT : LEFT,
    back = side === 0 ? LEFT : RIGHT;
  const inputs = world.blobs.map(() => 0);
  for (let i = 0; i < REACH; i++) {
    if (i % T.STEPS_PER_TICK === 0) {
      const x = own(world, side, me.x);
      let bits = target > x + SLACK ? forward : target < x - SLACK ? back : 0;
      if (jump && (i === 0 || (me.air && me.vy > 0))) bits |= JUMP;
      inputs[slot] = bits;
    }
    stepWorld(ghost, inputs);
    if (ghost.pointCounter !== points)
      return ghost.lastFault === side ? -1000 : 1000;
    if (ghost.hitCounter !== hits && ghost.lastTouch === side) {
      const land = landing(ghost, side, T.BALL_FLOOR / T.BU);
      if (land === undefined) return 0;
      if (land > net) {
        const depth = land - net;
        if (world.blobs.length === 2)
          // Over: deep or tight to the net are both hard to return; the middle of their half is easiest for them.
          return 800 + (depth > 200 ? depth - 200 : 200 - depth);
        // Two a side: as far from both of them as it can.
        let gap = 300;
        for (const other of ghost.blobs)
          if (other.side !== side) {
            const away = abs(land - own(world, side, other.x));
            if (away < gap) gap = away;
          }
        return 800 + gap;
      }
      const used = touchesOf(ghost, side);
      if (used >= T.MAX_TOUCHES) return -800;
      if (world.blobs.length === 2) return 200 - used * 50;
      // Two a side, a set is as good as how easily the next touch goes over: near the net, but not on it.
      const short = net - 140 - land;
      return 300 - used * 100 - (short < 0 ? -short * 2 : short) / 4;
    }
  }
  return -100;
}

const abs = (value: number): number => (value < 0 ? -value : value);

/**
 * Of two teammates, whether `me` is the one for a ball coming down at `spot` (own frame): the nearer, and level, the
 * first of the side (slots 0 and 1), which reads the same from either side, so the court stays fair.
 */
function takes(world: World, me: Blob, mate: Blob, spot: number): boolean {
  const mine = abs(spot - own(world, me.side, me.x)),
    theirs = abs(spot - own(world, mate.side, mate.x));
  return (
    mine < theirs ||
    (mine === theirs && world.blobs.indexOf(me) < world.blobs.indexOf(mate))
  );
}

export function botInput(
  world: World,
  slot: number,
  level: BotLevel = 2,
): number {
  const skill = SKILL[level];
  const me = world.blobs[slot];
  if (!me) return 0;
  const side = me.side,
    net = courtOf(world).net;
  const court = courtOf(world),
    lane = laneOf(world, slot);
  const mate =
    lane >= 0
      ? undefined
      : world.blobs.find((blob) => blob !== me && blob.side === side);
  const ball = world.ball,
    x = own(world, side, me.x),
    bx = ownBall(world, side, ball.x);
  const forward = side === 0 ? RIGHT : LEFT,
    back = side === 0 ? LEFT : RIGHT;
  const walk = (target: number): number =>
    target > x + SLACK ? forward : target < x - SLACK ? back : 0;
  // Where it waits: one a side, the middle; two a side, the one nearer the net covers the front.
  const front =
    !mate ||
    x > own(world, side, mate.x) ||
    (x === own(world, side, mate.x) &&
      world.blobs.indexOf(me) < world.blobs.indexOf(mate));
  const home =
    lane >= 0
      ? own(
          world,
          side,
          (court.laneMin[side]![lane]! + court.laneMax[side]![lane]!) / 2,
        )
      : !mate
        ? net - HOME
        : front
          ? net - FRONT_HOME
          : net - BACK_HOME;
  /** Three a side, whether a ball coming down at `spot` (own frame) is in this bot's lane. */
  const mine = (spot: number): boolean => {
    if (lane < 0) return true;
    const out = net - spot;
    return (out < T.TRIO_LANE ? 0 : out < 2 * T.TRIO_LANE ? 1 : 2) === lane;
  };
  if (world.phase === "over" || world.phase === "dead") return walk(home);
  // Holding jump while rising makes the most of a jump it already chose; it lets go before landing, or holding it
  // through the landing would jump again.
  if (me.air) return (me.vy > 0 ? JUMP : 0) | walk(bx - OFFSETS[1]);

  let centre: number;
  if (world.phase === "serve" && !ball.live) {
    if (world.server !== side) return walk(home);
    if (mate && !takes(world, me, mate, bx)) return walk(home);
    if (!mine(bx)) return walk(home);
    centre = bx;
    // A moment's pause before serving, so the other side sees it coming.
    if (world.phaseSteps < 60) return walk(bx - OFFSETS[1]);
  } else {
    // Slow to react to the other side's touch.
    if (
      world.lastTouch === otherSide(side) &&
      world.step - world.touchStep < skill.delay
    )
      return 0;
    const land = landing(world, side, CONTACT_Y);
    if (land === undefined || land > net - 8) return walk(home);
    // Two a side: the teammate nearer the ball plays it; the other makes room, front or back.
    if (mate && !takes(world, me, mate, land))
      return walk(
        land > net - (net - T.NET_GAP) / 2 ? net - BACK_HOME : net - FRONT_HOME,
      );
    // Three a side: a ball in another lane is a teammate's.
    if (!mine(land)) return walk(home);
    centre = land;
  }
  // Its own aim error for this touch of the rally, the same on every device.
  const spread = skill.error * 2 + 1;
  const aim =
    skill.error === 0
      ? 0
      : (mix(world.seed, world.hitCounter, world.pointCounter, side) % spread) -
        skill.error;
  const serving = world.phase === "serve" && !ball.live;
  let best = -Infinity,
    bits = walk(centre - OFFSETS[1] + aim);
  for (const offset of mate || lane >= 0 ? WIDE_OFFSETS : OFFSETS) {
    const target = centre - offset + aim;
    for (const jump of serving || skill.attacks ? [false, true] : [false]) {
      // A serve needs a jump: the ball hovers above a standing head.
      if (serving && !jump) continue;
      const score = plan(world, slot, target, jump);
      if (score > best) {
        best = score;
        bits = walk(target) | (jump ? JUMP : 0);
      }
    }
  }
  // Waiting is better than a jump that misses: only jump on a plan that touches the ball.
  if (bits & JUMP && best < 0) bits &= ~JUMP;
  return bits;
}
