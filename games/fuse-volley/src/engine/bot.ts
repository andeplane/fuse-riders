import { JUMP, LEFT, RIGHT } from "./input.js";
import { div, mix } from "./math.js";
import { stepBall, stepWorld } from "./step.js";
import * as T from "./tuning.js";
import { otherSide, type Side, type World } from "./world.js";

/**
 * The bot: ordinary held bits read off the world like a player reads the screen, asked once per log tick inside the
 * fold, so every device computes the same answer (it is covered by `RULES` and the golden recording). It gets no
 * privileged physics: it plays out a few ways of meeting the ball on a copy of the world, with the other blob standing
 * still, and does whatever sends the ball over the net best. It never moves the world: its aim error comes from the
 * match seed and the touch count, not from the world's generator.
 *
 * It thinks in its own frame, as if it played the left side: x runs from its own wall (0) to the net (400).
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
/** Where it waits for the other side's ball. */
const HOME = 190;
/** How far behind the ball (towards its own wall) it tries standing, px. */
const OFFSETS = [4, 16, 28] as const;
/** Close enough: it moves 18 px a tick, so nearer than this it stands still. */
const SLACK = 9;

/** x in px seen from `side`'s own wall. */
const own = (side: Side, px: number): number =>
  side === 0 ? px : T.COURT_W - px;
/** A ball x (in ball units) in px seen from `side`'s own wall, rounded the same way on both sides. */
const ownBall = (side: Side, units: number): number =>
  div(side === 0 ? units : T.COURT_W * T.BU - units, T.BU);

/** A copy of the world the bot can play forward without touching the real one. */
function copy(world: World): World {
  return {
    ...world,
    ball: { ...world.ball },
    blobs: [{ ...world.blobs[0] }, { ...world.blobs[1] }],
    score: [world.score[0], world.score[1]],
  };
}

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
      return ownBall(side, ghost.ball.x);
  }
  return;
}

/**
 * How good it is to walk towards `target` (and jump at once, if `jump`): the touch is played out on a copy and scored
 * by where the ball then comes down. Over the net is best; a set on its own side with touches to spare is next; a
 * miss or a fourth touch is worst.
 */
function plan(world: World, side: Side, target: number, jump: boolean): number {
  const ghost = copy(world);
  const hits = ghost.hitCounter,
    points = ghost.pointCounter;
  const forward = side === 0 ? RIGHT : LEFT,
    back = side === 0 ? LEFT : RIGHT;
  let bits = 0;
  for (let i = 0; i < REACH; i++) {
    if (i % T.STEPS_PER_TICK === 0) {
      const x = own(side, ghost.blobs[side].x);
      bits = target > x + SLACK ? forward : target < x - SLACK ? back : 0;
      const blob = ghost.blobs[side];
      if (jump && (i === 0 || (blob.air && blob.vy > 0))) bits |= JUMP;
    }
    const inputs: [number, number] = side === 0 ? [bits, 0] : [0, bits];
    stepWorld(ghost, inputs);
    if (ghost.pointCounter !== points)
      return ghost.lastFault === side ? -1000 : 1000;
    if (ghost.hitCounter !== hits && ghost.lastTouch === side) {
      const land = landing(ghost, side, T.BALL_FLOOR / T.BU);
      if (land === undefined) return 0;
      if (land > T.NET_X) {
        // Over: deep or tight to the net are both hard to return; the middle of their half is easiest for them.
        const depth = land - T.NET_X;
        return 800 + (depth > 200 ? depth - 200 : 200 - depth);
      }
      const used = ghost.blobs[side].touches;
      return used >= T.MAX_TOUCHES ? -800 : 200 - used * 50;
    }
  }
  return -100;
}

export function botInput(
  world: World,
  side: Side,
  level: BotLevel = 2,
): number {
  const skill = SKILL[level];
  const me = world.blobs[side],
    ball = world.ball,
    x = own(side, me.x),
    bx = ownBall(side, ball.x);
  const forward = side === 0 ? RIGHT : LEFT,
    back = side === 0 ? LEFT : RIGHT;
  const walk = (target: number): number =>
    target > x + SLACK ? forward : target < x - SLACK ? back : 0;
  if (world.phase === "over" || world.phase === "dead") return walk(HOME);
  // Holding jump while rising makes the most of a jump it already chose; it lets go before landing, or holding it
  // through the landing would jump again.
  if (me.air) return (me.vy > 0 ? JUMP : 0) | walk(bx - OFFSETS[1]);

  let centre: number;
  if (world.phase === "serve" && !ball.live) {
    if (world.server !== side) return walk(HOME);
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
    if (land === undefined || land > T.NET_X - 8) return walk(HOME);
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
  for (const offset of OFFSETS) {
    const target = centre - offset + aim;
    for (const jump of serving || skill.attacks ? [false, true] : [false]) {
      // A serve needs a jump: the ball hovers above a standing head.
      if (serving && !jump) continue;
      const score = plan(world, side, target, jump);
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
