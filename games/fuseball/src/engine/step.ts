import { apart, resolveSolids, settle, type Space } from "./collide.js";
import { BTN, DOWN, LEFT, RIGHT, isInput } from "./input.js";
import { abs, clamp, div, isqrt, toward } from "./math.js";
import { boxesOf, mapOf, type Box } from "./maps.js";
import * as T from "./tuning.js";
import type { Bubble, Rider, World } from "./world.js";

/**
 * One micro-step of the arena (120 a second): a pure function of the world and the bits each rider holds. Both
 * riders act on the world as it stood before the step and what they do to the ball is summed, so the order they are
 * stored in decides nothing.
 */
const stickOf = (bits: number): -1 | 0 | 1 =>
  bits & RIGHT ? 1 : bits & LEFT ? -1 : 0;

/** A slide's speed with `left` steps to go: fastest at the start, easing to a run. */
const slideSpeed = (left: number): number =>
  T.SLIDE_END + div((T.SLIDE_START - T.SLIDE_END) * left, T.SLIDE_STEPS);

const count = (value: number): number => (value + 1) % T.COUNTER;

/** What the riders' jumps do to the ball this step, summed over both before it is applied. */
interface Lift {
  riders: number;
  vx: number;
  slot: -1 | 0 | 1;
}

function popUp(rider: Rider): void {
  rider.slide = 0;
  rider.vy = -T.SLIDE_POP;
  rider.grounded = false;
}

/** The button: jump, lift, air-jump, quick drop or slide, from the rider's state before this step. */
function control(
  world: World,
  rider: Rider,
  bits: number,
  space: Space,
  lift: Lift,
): void {
  const pressed = (bits & BTN) !== 0 && (rider.prev & BTN) === 0;
  if (rider.slide > 0) {
    // A slide ends when the button comes up, the ground runs out or its time does, and always with a hop.
    if (!(bits & BTN) || !rider.grounded) popUp(rider);
    else if (--rider.slide === 0) popUp(rider);
    return;
  }
  if (!pressed) return;
  if (rider.grounded) {
    if (bits & DOWN) {
      rider.slide = T.SLIDE_STEPS;
      const stick = stickOf(bits);
      if (stick) rider.facing = stick;
      return;
    }
    rider.vy = (rider.vy < 0 ? rider.vy : 0) - T.JUMP;
    rider.grounded = false;
    rider.jumps = count(rider.jumps);
    const ball = world.ball;
    if (ball.live) {
      const { dx, dy } = apart(ball.x, ball.y, rider.x, rider.y, space);
      if (abs(dx) < T.LIFT_X && abs(dy) < T.LIFT_Y) {
        lift.riders++;
        lift.vx += div(rider.vx * T.LIFT_CARRY_NUM, T.LIFT_CARRY_DEN);
        lift.slot = lift.riders === 1 ? rider.slot : -1;
      }
    }
    return;
  }
  if (bits & DOWN) rider.vy = (rider.vy > 0 ? rider.vy : 0) + T.QUICK_DROP;
  else rider.vy = (rider.vy < 0 ? rider.vy : 0) - T.JUMP;
  rider.jumps = count(rider.jumps);
  // Every press in the air leaves the rider's one bubble where they are; it is hard until the button comes up.
  const bubble = world.bubbles[rider.slot];
  bubble.active = true;
  bubble.hard = true;
  bubble.x = rider.x;
  bubble.y = rider.y;
  bubble.seq = count(bubble.seq);
}

/**
 * A rider against the other rider's bubble: touching a normal one pops it, and a hard one throws the rider back off
 * its surface and stays. A rider's own bubble is nothing to them.
 */
function meetBubble(rider: Rider, bubble: Bubble, space: Space): void {
  if (rider.zapped || !bubble.active) return;
  let { dx, dy } = apart(rider.x, rider.y, bubble.x, bubble.y, space);
  let d2 = dx * dx + dy * dy;
  const reach = T.RIDER_R + T.BUBBLE_R;
  if (d2 >= reach * reach) return;
  if (!bubble.hard) {
    bubble.active = false;
    rider.pops = count(rider.pops);
    return;
  }
  if (d2 === 0) {
    dx = 0;
    dy = -1;
    d2 = 1;
  }
  const d = isqrt(d2),
    depth = reach - d;
  rider.x += div(dx * depth, d);
  rider.y += div(dy * depth, d);
  const closing = rider.vx * dx + rider.vy * dy;
  if (closing < 0) {
    rider.vx -= div(2 * closing * dx, d2);
    rider.vy -= div(2 * closing * dy, d2);
  }
  // Bounced off: whatever the rider was doing on the ground is over.
  rider.slide = 0;
}

/** Gravity, running and drag, then the move and the solids. */
function moveRider(
  rider: Rider,
  bits: number,
  boxes: readonly Box[],
  space: Space,
): void {
  const stick = stickOf(bits);
  if (rider.slide > 0) rider.vx = rider.facing * slideSpeed(rider.slide);
  else {
    if (stick) {
      rider.facing = stick;
      // Reversing the stick kills the speed the other way at once.
      if (rider.vx * stick < 0) rider.vx = 0;
      if (abs(rider.vx) < T.RUN_SPEED) rider.vx += stick * T.RUN_ACCEL;
    }
    rider.vx -= div(
      rider.vx,
      rider.grounded && !stick ? T.GROUND_DRAG : T.DRAG,
    );
    if (!stick && abs(rider.vx) < T.DRAG) rider.vx = 0;
  }
  rider.vy += rider.vy < 0 ? T.GRAVITY_RISE : T.GRAVITY_FALL;
  if (bits & DOWN) rider.vy += T.GRAVITY_DOWN;
  rider.vx = clamp(rider.vx, -T.MAX_VX, T.MAX_VX);
  rider.vy = clamp(rider.vy, -T.MAX_RISE, T.MAX_FALL);
  rider.x += rider.vx;
  rider.y += rider.vy;
  rider.grounded = resolveSolids(rider, T.RIDER_R, boxes, space, 0, 1).ground;
}

/** Two riders in contact are pushed apart by the same amount and trade their speed along the line between them. */
function bumpRiders(a: Rider, b: Rider, space: Space): void {
  if (a.zapped || b.zapped) return;
  const { dx, dy } = apart(a.x, a.y, b.x, b.y, space),
    d2 = dx * dx + dy * dy,
    reach = 2 * T.RIDER_R;
  if (d2 >= reach * reach || d2 === 0) return;
  const d = isqrt(d2),
    depth = reach - d,
    sx = div(dx * depth, 2 * d),
    sy = div(dy * depth, 2 * d);
  a.x += sx;
  a.y += sy;
  b.x -= sx;
  b.y -= sy;
  const closing = (a.vx - b.vx) * dx + (a.vy - b.vy) * dy;
  if (closing >= 0) return;
  const ix = div(closing * dx, d2),
    iy = div(closing * dy, d2);
  a.vx -= ix;
  a.vy -= iy;
  b.vx += ix;
  b.vy += iy;
}

/** The ball: gravity, the solids, then every rider touching it, all measured from where the solids left it. */
function moveBall(world: World, boxes: readonly Box[], space: Space): void {
  const ball = world.ball;
  ball.vy += T.BALL_GRAVITY;
  ball.vx = clamp(ball.vx, -T.BALL_MAX, T.BALL_MAX);
  ball.vy = clamp(ball.vy, -T.BALL_MAX, T.BALL_MAX);
  ball.x += ball.vx;
  ball.y += ball.vy;
  const touch = resolveSolids(
    ball,
    T.BALL_R,
    boxes,
    space,
    T.BALL_BOUNCE_NUM,
    T.BALL_BOUNCE_DEN,
  );
  if (touch.hit) {
    ball.vx -= div(ball.vx, T.BALL_SCRUB);
    ball.vy -= div(ball.vy, T.BALL_SCRUB);
    if (abs(ball.vx) < T.BALL_SCRUB) ball.vx = 0;
    if (abs(ball.vy) < T.BALL_SCRUB) ball.vy = 0;
    if (touch.impact >= T.BOUNCE_FX) ball.bounces = count(ball.bounces);
  }

  let pushX = 0,
    pushY = 0,
    kickX = 0,
    kickY = 0,
    kickers = 0,
    kicker: -1 | 0 | 1 = -1,
    hard = false;
  const reach = T.RIDER_R + T.BALL_R;
  for (const rider of world.riders) {
    if (rider.zapped) continue;
    let { dx, dy } = apart(ball.x, ball.y, rider.x, rider.y, space);
    let d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) continue;
    if (d2 === 0) {
      dx = 0;
      dy = -1;
      d2 = 1;
    }
    const d = isqrt(d2),
      depth = reach - d;
    pushX += div(dx * depth, d);
    pushY += div(dy * depth, d);
    const closing = (ball.vx - rider.vx) * dx + (ball.vy - rider.vy) * dy;
    if (closing < 0) {
      kickX -= div(closing * dx * T.KICK_NUM, d2 * T.KICK_DEN);
      kickY -= div(closing * dy * T.KICK_NUM, d2 * T.KICK_DEN);
      if (div(-closing, d) >= T.BOUNCE_FX) hard = true;
    }
    kickers++;
    kicker = kickers === 1 ? rider.slot : -1;
  }
  if (kickers) {
    ball.x += pushX;
    ball.y += pushY;
    ball.vx += kickX;
    ball.vy += kickY;
    ball.touch = kicker;
    if (hard) ball.bounces = count(ball.bounces);
  }
  bumpBall(world, space);
}

/**
 * The ball against the bubbles, either rider's: a bubble halves the ball's speed and throws it away from its centre.
 * A normal bubble pops doing it; a hard one stays. Both bubbles are measured from the same ball, and their throws
 * are summed.
 */
function bumpBall(world: World, space: Space): void {
  const ball = world.ball,
    reach = T.BALL_R + T.BUBBLE_R;
  let pushX = 0,
    pushY = 0,
    throwX = 0,
    throwY = 0,
    bumps = 0,
    owner: -1 | 0 | 1 = -1;
  for (const slot of [0, 1] as const) {
    const bubble = world.bubbles[slot];
    if (!bubble.active) continue;
    const { dx, dy } = apart(ball.x, ball.y, bubble.x, bubble.y, space),
      d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) continue;
    const out = toward(dx, dy, reach - isqrt(d2)),
      away = toward(dx, dy, T.BUMP);
    pushX += out.x;
    pushY += out.y;
    throwX += away.x;
    throwY += away.y;
    bumps++;
    owner = bumps === 1 ? slot : -1;
    if (!bubble.hard) bubble.active = false;
  }
  if (!bumps) return;
  ball.x += pushX;
  ball.y += pushY;
  ball.vx = div(ball.vx, 2) + throwX;
  ball.vy = div(ball.vy, 2) + throwY;
  ball.touch = owner;
  ball.bounces = count(ball.bounces);
}

export function stepWorld(
  world: World,
  inputs: ReadonlyMap<string, number>,
): void {
  if (world.phase === "over" || world.step >= T.MAX_STEP) return;
  world.step++;
  const map = mapOf(world.mapId),
    boxes = boxesOf(world.mapId),
    [a, b] = world.riders;
  const held = (rider: Rider): number => {
    const bits = inputs.get(rider.id);
    return !rider.zapped && isInput(bits) ? bits : 0;
  };
  const bitsA = held(a),
    bitsB = held(b);

  if (world.phase === "countdown") {
    // Everything waits on its mark; only what is held is remembered, so a press made here is not one later.
    a.prev = bitsA;
    b.prev = bitsB;
    if (--world.phaseSteps === 0) world.phase = "play";
    return;
  }

  const lift: Lift = { riders: 0, vx: 0, slot: -1 };
  control(world, a, bitsA, map, lift);
  control(world, b, bitsB, map, lift);
  if (lift.riders) {
    world.ball.vy = -T.LIFT_SPEED;
    world.ball.vx += lift.vx;
    world.ball.touch = lift.slot;
    world.ball.bounces = count(world.ball.bounces);
  }

  // A bubble stays hard only while its owner keeps holding the press that placed it.
  if (!(bitsA & BTN)) world.bubbles[0].hard = false;
  if (!(bitsB & BTN)) world.bubbles[1].hard = false;

  if (!a.zapped) moveRider(a, bitsA, boxes, map);
  if (!b.zapped) moveRider(b, bitsB, boxes, map);
  meetBubble(a, world.bubbles[1], map);
  meetBubble(b, world.bubbles[0], map);
  bumpRiders(a, b, map);
  if (world.ball.live) moveBall(world, boxes, map);

  for (const rider of world.riders) {
    settle(rider, T.RIDER_R, map);
    rider.vx = clamp(rider.vx, -T.MAX_VX, T.MAX_VX);
    rider.vy = clamp(rider.vy, -T.MAX_RISE, T.MAX_FALL);
  }
  settle(world.ball, T.BALL_R, map);
  world.ball.vx = clamp(world.ball.vx, -T.BALL_MAX, T.BALL_MAX);
  world.ball.vy = clamp(world.ball.vy, -T.BALL_MAX, T.BALL_MAX);
  a.prev = bitsA;
  b.prev = bitsB;
}
