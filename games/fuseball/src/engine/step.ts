import {
  apart,
  inShape,
  resolveSolids,
  settle,
  type Body,
  type Space,
  type Touch,
} from "./collide.js";
import { meetGadgets } from "./gadgets.js";
import { BTN, DOWN, LEFT, RIGHT, isInput } from "./input.js";
import { SUB, abs, clamp, div, isqrt, toward } from "./math.js";
import { boxesOf, mapOf, type Box } from "./maps.js";
import * as T from "./tuning.js";
import {
  resetPoint,
  type Bubble,
  type Rider,
  type Slot,
  type World,
} from "./world.js";

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

/**
 * After something other than its own flight has moved a body (a rider, a bubble) from `(fromX, fromY)`, where the
 * solids had left it: the shove is held to less than the body's radius, so its centre cannot be carried into or
 * through a solid in one step. The solids then have the last word (`resolveSolids`), and whatever is left of an
 * overlap with the thing that shoved is taken up on later steps.
 */
function hold(body: Body, radius: number, fromX: number, fromY: number): void {
  const mx = body.x - fromX,
    my = body.y - fromY,
    most = radius - SUB;
  if (mx * mx + my * my <= most * most) return;
  const held = toward(mx, my, most);
  body.x = fromX + held.x;
  body.y = fromY + held.y;
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

/**
 * The ball: gravity, the solids, then every rider touching it, all measured from where the solids left it, then the
 * bubbles, and the solids again so that nothing can push the ball into one.
 */
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
  // The gadgets next: a field or a bumper throws it, a portal carries it, and the riders meet it where that left it.
  if (meetGadgets(mapOf(world.mapId), world.barriers, ball) > 0)
    ball.bounces = count(ball.bounces);

  let pushX = 0,
    pushY = 0,
    kickX = 0,
    kickY = 0,
    kickers = 0,
    kicker: -1 | 0 | 1 = -1,
    hard = false;
  const reach = T.RIDER_R + T.BALL_R,
    fromX = ball.x,
    fromY = ball.y;
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
  if (ball.x !== fromX || ball.y !== fromY)
    unpin(world, fromX, fromY, boxes, space);
}

/**
 * The ball has been pushed by riders or bubbles from `(fromX, fromY)`: the solids take it back out, and when that
 * leaves it still under whoever pushed, it is pinned between the two. A pinned ball squirts out along the solid,
 * away from a rider or bubble beside it, or up the wall when the solid is one, so standing or landing on the ball
 * never buries it. A hard bubble that keeps the ball pinned with no way out gives: it pops.
 */
function unpin(
  world: World,
  fromX: number,
  fromY: number,
  boxes: readonly Box[],
  space: Space,
): void {
  const ball = world.ball,
    solids = (): Touch =>
      resolveSolids(
        ball,
        T.BALL_R,
        boxes,
        space,
        T.BALL_BOUNCE_NUM,
        T.BALL_BOUNCE_DEN,
      );
  hold(ball, T.BALL_R, fromX, fromY);
  const heldX = ball.x,
    heldY = ball.y;
  solids();
  const backX = ball.x - heldX,
    backY = ball.y - heldY;
  // Unmoved by the solids: nothing is squeezing it against one.
  if (backX === 0 && backY === 0) return;
  // A floor or a ceiling pushed back: the way out is sideways. Otherwise it is a wall, and the way out is up it.
  const sideways = abs(backY) >= abs(backX);
  let way = 0,
    pinned = false;
  const pinnedBy = (x: number, y: number, reach: number, tie: number) => {
    const { dx, dy } = apart(ball.x, ball.y, x, y, space),
      room = reach - T.PIN_SLACK;
    if (dx * dx + dy * dy >= room * room) return false;
    if (sideways) way += dx > 0 ? 1 : dx < 0 ? -1 : tie;
    else way += dy > div(reach, 2) ? 1 : -1;
    pinned = true;
    return true;
  };
  for (const rider of world.riders)
    if (!rider.zapped)
      pinnedBy(rider.x, rider.y, T.RIDER_R + T.BALL_R, rider.facing);
  const pinning = world.bubbles.filter(
    (bubble, slot) =>
      bubble.active &&
      pinnedBy(bubble.x, bubble.y, T.BALL_R + T.BUBBLE_R, slot === 0 ? 1 : -1),
  );
  if (!pinned) return;
  // Squeezed, not struck: the speed it was given into the solid is not thrown back at whoever is on it.
  if (sideways) ball.vy = 0;
  else ball.vx = 0;
  const before = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  /** Squirts the ball along the solid towards `side`; returns how far it got. */
  const squirt = (side: -1 | 1): number => {
    if (sideways) {
      ball.x += side * T.SQUIRT;
      if (ball.vx * side < T.SQUIRT) ball.vx = side * T.SQUIRT;
    } else {
      ball.y += side * T.SQUIRT;
      if (ball.vy * side < T.SQUIRT) ball.vy = side * T.SQUIRT;
    }
    solids();
    return (sideways ? ball.x - before.x : ball.y - before.y) * side;
  };
  let out = 0;
  if (way !== 0) {
    const side = way > 0 ? 1 : -1;
    out = squirt(side);
    if (out < div(T.SQUIRT, 2)) {
      // The way out is shut (a corner): the ball goes the other way instead, under whoever is on it, and comes out
      // on their far side over the next steps.
      Object.assign(ball, before);
      const back = squirt(side > 0 ? -1 : 1);
      if (back < div(T.SQUIRT, 2)) Object.assign(ball, before);
      else if (pinning.length === 0) out = back;
    }
  }
  // Pinned from both sides at once, or the way out is shut too (a corner): a bubble holding the ball there pops
  // rather than keep it.
  if (out < div(T.SQUIRT, 2))
    for (const bubble of pinning) bubble.active = false;
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
  if (world.freeze > 0) {
    // The freeze after a goal: nothing moves, and what is held is remembered as in a countdown.
    a.prev = bitsA;
    b.prev = bitsB;
    if (!(bitsA & BTN)) world.bubbles[0].hard = false;
    if (!(bitsB & BTN)) world.bubbles[1].hard = false;
    if (--world.freeze === 0) world.speed = T.ZAP_SPEED;
    return;
  }
  if (world.phase === "zap" && --world.phaseSteps === 0) {
    // The celebration is over: the match too if that was the winning point, otherwise back to the marks.
    if (winnerOf(world) >= 0) {
      world.phase = "over";
      world.speed = T.SPEED_FULL;
      world.budget = 0;
    } else resetPoint(world);
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
  const ax = a.x,
    ay = a.y,
    bx = b.x,
    by = b.y;
  meetBubble(a, world.bubbles[1], map);
  meetBubble(b, world.bubbles[0], map);
  bumpRiders(a, b, map);
  // A rider thrown by a bubble or shouldered by the other rider is not thrown into a solid.
  if (a.x !== ax || a.y !== ay) {
    hold(a, T.RIDER_R, ax, ay);
    resolveSolids(a, T.RIDER_R, boxes, map, 0, 1);
  }
  if (b.x !== bx || b.y !== by) {
    hold(b, T.RIDER_R, bx, by);
    resolveSolids(b, T.RIDER_R, boxes, map, 0, 1);
  }
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

  if (world.phase === "play") {
    const goal = map.goals.find((each) =>
      inShape(world.ball.x, world.ball.y, each, map),
    );
    if (goal) score(world, goal.team);
  }
}

/**
 * The ball is in `team`'s goal: a point for that team whoever sent it, and the other rider is zapped. It is that
 * rider's own goal when they (or their bubble) were the last to send the ball; otherwise it is the scorer's.
 */
function score(world: World, team: Slot): void {
  const scorer = world.riders[team],
    other = world.riders[team === 0 ? 1 : 0],
    ball = world.ball;
  world.score[team]++;
  world.lastScorer = team;
  if (ball.touch === other.slot) other.ownGoals++;
  else scorer.goals++;
  other.zapped = true;
  other.vx = 0;
  other.vy = 0;
  other.slide = 0;
  ball.live = false;
  ball.vx = 0;
  ball.vy = 0;
  world.phase = "zap";
  world.phaseSteps = T.ZAP_STEPS;
  world.speed = 0;
  world.budget = 0;
  world.linger = 0;
  world.freeze = T.GOAL_FREEZE_STEPS;
  world.suddenDeath =
    world.score[0] >= T.TARGET - 1 && world.score[1] >= T.TARGET - 1;
}

/** The slot that has won the match, or −1 while nobody has. */
export const winnerOf = (world: World): -1 | Slot =>
  world.score[0] >= T.TARGET ? 0 : world.score[1] >= T.TARGET ? 1 : -1;

/** Whether the ball is in play with its centre inside a cloud: what slows the arena down. */
export function slowed(world: World): boolean {
  if (world.phase !== "play") return false;
  const map = mapOf(world.mapId);
  return map.clouds.some((cloud) =>
    inShape(world.ball.x, world.ball.y, cloud, map),
  );
}

/** The speed the ball's place in the clouds asks for: slower the nearer a cloud's centre, or −1 outside them all. */
function cloudSpeed(world: World): number {
  const map = mapOf(world.mapId);
  let speed = -1;
  for (const cloud of map.clouds) {
    if (!inShape(world.ball.x, world.ball.y, cloud, map)) continue;
    const { dx, dy } = apart(
        world.ball.x,
        world.ball.y,
        cloud.x * SUB,
        cloud.y * SUB,
        map,
      ),
      here =
        T.CLOUD_SPEED_CORE +
        div(
          (T.CLOUD_SPEED_EDGE - T.CLOUD_SPEED_CORE) * isqrt(dx * dx + dy * dy),
          cloud.r * SUB,
        );
    if (speed < 0 || here < speed) speed = here;
  }
  return speed;
}

/** The pace of one log tick: the speed, hold and leftover it leaves in the world, and the micro-steps it runs. */
interface Pace {
  speed: number;
  budget: number;
  linger: number;
  steps: number;
}

function paceOf(world: World): Pace {
  // A goal's freeze: the clock runs on at its full six steps a tick, each of which moves nothing. The last tick of
  // it runs only what is left, so the zap starts on a tick of its own.
  if (world.freeze > 0)
    return {
      speed: 0,
      budget: 0,
      linger: 0,
      steps: Math.min(T.STEPS_PER_TICK, world.freeze),
    };
  let speed = T.SPEED_FULL,
    linger = 0;
  if (world.phase === "zap") speed = T.ZAP_SPEED;
  else if (world.phase === "play") {
    let target = cloudSpeed(world);
    linger = world.linger;
    if (target >= 0) linger = T.SLOW_HOLD_TICKS;
    else if (linger > 0) {
      linger--;
      target = world.speed;
    } else target = T.SPEED_FULL;
    speed =
      world.speed > target
        ? Math.max(target, world.speed - T.SLOW_EASE_IN)
        : Math.min(target, world.speed + T.SLOW_EASE_OUT);
  } else return { speed, budget: 0, linger, steps: T.STEPS_PER_TICK };
  const owed = world.budget + speed * T.STEPS_PER_TICK;
  return {
    speed,
    budget: owed % T.SPEED_FULL,
    linger,
    steps: div(owed, T.SPEED_FULL),
  };
}

/**
 * How many micro-steps the next 50 ms log tick runs, read from the world as it stands at the start of the tick:
 * six at full speed and through a goal's freeze (where they move nothing), fewer in slow motion, never fewer than
 * one. It changes nothing; `paceTick` gives the same answer and sets the pace.
 */
export const stepsPerTick = (world: World): number => paceOf(world).steps;

/**
 * Starts a log tick: eases the arena's speed toward what the ball's place asks for, and returns the micro-steps
 * this tick runs. Call it once per log tick, before the tick's `stepWorld` calls.
 */
export function paceTick(world: World): number {
  const pace = paceOf(world);
  world.speed = pace.speed;
  world.budget = pace.budget;
  world.linger = pace.linger;
  return pace.steps;
}
