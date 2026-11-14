import { JUMP, LEFT, RIGHT, isInput } from "./input.js";
import { div, isqrt, round } from "./math.js";
import * as T from "./tuning.js";
import {
  otherSide,
  rng,
  serve,
  type Blob,
  type Side,
  type World,
} from "./world.js";

/**
 * One step of the court (120 a second), a pure function of the world and the bits each blob holds. The order inside
 * a step is the exe's round loop (0x4443e8): blobs move, the ball meets blobs and the net on every second step, the
 * ball moves, and once every original frame (four steps) touches are counted.
 */

const count = (value: number): number => (value + 1) % T.COUNTER;

/** Walking starts the squash cycle on the ground. */
function startSquash(blob: Blob): void {
  if (!blob.air && blob.frame === 0 && blob.dir === 0) blob.dir = 1;
}

export function stepBlob(blob: Blob, bits: number, step: number): void {
  const side = blob.side;
  if (bits & RIGHT) {
    blob.x = Math.min(blob.x + T.RUN_SPEED, T.BLOB_MAX[side]);
    startSquash(blob);
  }
  if (bits & LEFT) {
    blob.x = Math.max(blob.x - T.RUN_SPEED, T.BLOB_MIN[side]);
    startSquash(blob);
  }
  const jump = (bits & JUMP) !== 0;
  if (jump && !blob.air) {
    blob.air = true;
    blob.vy = T.JUMP_SPEED;
    if (blob.frame !== T.SQUASH_FRAMES) blob.dir = 1;
  }
  if (blob.air) {
    blob.y += blob.vy;
    // Holding jump halves gravity: the longer the hold, the higher the jump.
    blob.vy -= jump ? T.BLOB_GRAVITY : 2 * T.BLOB_GRAVITY;
    if (blob.y <= T.BLOB_FLOOR) {
      blob.y = T.BLOB_FLOOR;
      blob.vy = 0;
      blob.air = false;
      blob.frame = 0;
      blob.dir = 1;
    }
  }
  if (step % T.FRAME_STEPS === 0) {
    if (blob.frame !== 0 || blob.dir !== -1) {
      blob.frame += blob.dir;
      if (blob.frame >= T.SQUASH_FRAMES) {
        blob.frame = T.SQUASH_FRAMES;
        blob.dir = -1;
      }
      if (blob.frame <= 0) blob.frame = 0;
    } else blob.dir = 0;
  }
}

/** The head's or body's centre in ball units. */
export function headCentre(blob: Blob): { x: number; y: number } {
  return {
    x: blob.x * T.BU,
    y: div(blob.y, T.HU / T.BU) + T.HEAD_UP[blob.frame]! * T.BU,
  };
}
export function bodyCentre(blob: Blob): { x: number; y: number } {
  return {
    x: blob.x * T.BU,
    y: div(blob.y, T.HU / T.BU) + T.BODY_UP[blob.frame]! * T.BU,
  };
}

/** Moves the ball out along its new speed until it is `out` from (cx, cy), in at most `PUSH_PASSES` passes. */
function pushOut(world: World, cx: number, cy: number, out: number): void {
  const ball = world.ball;
  for (let pass = 0; pass < T.PUSH_PASSES; pass++) {
    const dx = ball.x - cx,
      dy = ball.y - cy;
    if (dx * dx + dy * dy > out * out) return;
    ball.x += div(ball.vx, T.PUSH_DIV);
    ball.y += div(ball.vy, T.PUSH_DIV);
  }
}

/** The ball against the four blob circles and the net's top (0x443bf0). */
export function collide(world: World): void {
  const ball = world.ball;
  const speed = isqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const circles: [Blob, { x: number; y: number }, number, number][] = [
    [world.blobs[0], headCentre(world.blobs[0]), T.HEAD_HIT, T.HEAD_OUT],
    [world.blobs[1], headCentre(world.blobs[1]), T.HEAD_HIT, T.HEAD_OUT],
    [world.blobs[0], bodyCentre(world.blobs[0]), T.BODY_HIT, T.BODY_OUT],
    [world.blobs[1], bodyCentre(world.blobs[1]), T.BODY_HIT, T.BODY_OUT],
  ];
  for (const [blob, centre, hit, out] of circles) {
    let dx = ball.x - centre.x,
      dy = ball.y - centre.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= hit * hit) continue;
    let d = isqrt(d2);
    if (d === 0) {
      dx = 0;
      dy = 1;
      d = 1;
    }
    ball.live = true;
    // A contact where the ball is already leaving along the normal is a graze: it bounces but is not a touch.
    if (
      T.GRAZE_DEN * (ball.vx * dx + ball.vy * dy) <=
      T.GRAZE_NUM * d * speed
    ) {
      blob.contact = true;
      world.blobs[otherSide(blob.side)].touches = 0;
    }
    ball.vx = round(dx * T.HIT_SPEED, d);
    ball.vy = round(dy * T.HIT_SPEED, d);
    pushOut(world, centre.x, centre.y, out);
  }
  let dx = ball.x - T.NET_TOP_X,
    dy = ball.y - T.NET_TOP_Y;
  if (dy > 0 && dx * dx + dy * dy < T.NET_HIT * T.NET_HIT) {
    let d = isqrt(dx * dx + dy * dy);
    if (d === 0) {
      dx = 0;
      dy = 1;
      d = 1;
    }
    ball.live = true;
    ball.vx = round(dx * T.NET_SPEED, d);
    ball.vy = round(dy * T.NET_SPEED, d);
    // Straight down on the top: a nudge either way so it never balances there.
    if (ball.vx === 0) ball.vx = rng(world, 5) - 2;
    world.netCounter = count(world.netCounter);
    pushOut(world, T.NET_TOP_X, T.NET_TOP_Y, T.NET_OUT);
  }
}

/** The ball moves, falls, and bounces off the sand, the walls and the net's pole (0x4441d0, 0x444100). */
export function stepBall(world: World): void {
  const ball = world.ball;
  ball.x += ball.vx;
  ball.y += ball.vy;
  let gravity = T.BALL_GRAVITY + (world.step & 1);
  if (ball.vy < 0) gravity -= div(div(-ball.vy, T.DRAG_DIV), T.DRAG_SHIFT_DIV);
  if (ball.live) ball.vy -= gravity;
  if (ball.y < T.BALL_FLOOR) {
    const impact = -ball.vy;
    ball.vy = div(-ball.vy * T.FLOOR_KEEP_NUM, T.FLOOR_KEEP_DEN);
    ball.vx = div(ball.vx * T.FLOOR_KEEP_NUM, T.FLOOR_KEEP_DEN);
    ball.y = T.BALL_FLOOR;
    if (impact > T.BU) world.floorCounter = count(world.floorCounter);
    if (world.phase === "rally" || world.phase === "serve")
      pointAgainst(world, ball.x >= T.NET_X * T.BU ? 1 : 0, false);
  }
  if (ball.x < T.BALL_LEFT) {
    ball.vx = -ball.vx;
    ball.x = T.BALL_LEFT;
  }
  if (ball.x > T.BALL_RIGHT) {
    ball.vx = -ball.vx;
    ball.x = T.BALL_RIGHT;
  }
  // The pole, read the same way from either side: a ball's back edge (from the right) or its front edge seen in a
  // mirror (from the left) inside the band turns it back. The exe floors both edges in screen space, which makes the
  // left side's band a pixel narrower; mirroring keeps the court fair.
  if (div(ball.y, T.BU) - T.BALL_RADIUS <= T.POLE_TOP) {
    const back = div(ball.x, T.BU) - T.BALL_RADIUS,
      front = div(T.COURT_W * T.BU - ball.x, T.BU) - T.BALL_RADIUS;
    if (ball.vx < 0 && T.POLE_LOW <= back && back < T.POLE_HIGH) {
      ball.x = T.POLE_PUT_RIGHT;
      ball.vx = -ball.vx;
      world.netCounter = count(world.netCounter);
    } else if (ball.vx > 0 && T.POLE_LOW <= front && front < T.POLE_HIGH) {
      ball.x = T.POLE_PUT_LEFT;
      ball.vx = -ball.vx;
      world.netCounter = count(world.netCounter);
    }
  }
  // The tunnelling guard, on the last step's position: a low ball never ends up inside or across the pole. The exe
  // watches one line left of the net; its mirror on the right is watched too.
  const across = (line: number) => ball.prevX >= line !== ball.x >= line;
  const crossed =
    ball.live &&
    (across(T.GUARD_LINE) || across(T.COURT_W * T.BU - T.GUARD_LINE + 1));
  if (
    ((T.GUARD_LOW <= ball.x && ball.x <= T.GUARD_HIGH) || crossed) &&
    ball.y <= T.GUARD_Y &&
    ball.prevY < T.GUARD_PREV_Y
  ) {
    ball.x =
      ball.prevX > T.NET_X * T.BU
        ? T.GUARD_PUT_RIGHT
        : ball.prevX < T.NET_X * T.BU
          ? T.GUARD_PUT_LEFT
          : ball.x;
    ball.y = ball.prevY;
    ball.vx = -ball.vx;
  }
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  ball.spin = (((ball.spin + ball.vx) % T.COUNTER) + T.COUNTER) % T.COUNTER;
}

/** The rally is over and went against `loser`: score it, change the serve, maybe end the match. */
export function pointAgainst(world: World, loser: Side, fault: boolean): void {
  const won = otherSide(loser);
  if (world.scoring === "rally" || world.server === won)
    world.score[won] = Math.min(world.score[won] + 1, T.SCORE_CAP);
  world.server = won;
  world.lastFault = loser;
  world.pointCounter = count(world.pointCounter);
  for (const blob of world.blobs) blob.touches = 0;
  if (fault) {
    world.ball.vx = div(world.ball.vx, 2);
    world.ball.vy = div(world.ball.vy, 2);
  }
  if (decided(world.score, won, world.target)) world.winner = won;
  world.phase = "dead";
  world.phaseSteps = T.DEAD_STEPS;
}

/** `side` has won: the target with a lead of two, or the score cap. */
export function decided(
  score: readonly [number, number],
  side: Side,
  target: number,
): boolean {
  const mine = score[side],
    theirs = score[otherSide(side)];
  return mine >= T.SCORE_CAP || (mine >= target && mine - theirs >= 2);
}

/** Once a frame: touches counted, carrying timed, and a side's count cleared once the ball is well over the net. */
export function countTouches(world: World): void {
  const ball = world.ball;
  if (ball.x >= T.CLEAR_RIGHT) world.blobs[0].touches = 0;
  else if (ball.x <= T.CLEAR_LEFT) world.blobs[1].touches = 0;
  for (const blob of world.blobs) {
    const playing = world.phase === "serve" || world.phase === "rally";
    if (blob.contact && !blob.prevContact) {
      blob.touches++;
      blob.hold = 0;
      blob.hits = Math.min(blob.hits + 1, T.MOST_HITS);
      world.hitCounter = count(world.hitCounter);
      world.lastTouch = blob.side;
      world.touchStep = world.step;
      if (playing && blob.touches > T.MAX_TOUCHES)
        pointAgainst(world, blob.side, true);
    } else if (blob.contact) {
      blob.hold++;
      if (playing && blob.hold > T.MAX_HOLD)
        pointAgainst(world, blob.side, true);
    }
    blob.prevContact = blob.contact;
    blob.contact = false;
  }
}

/** Both feet on the sand. */
const grounded = (world: World): boolean =>
  !world.blobs[0].air && !world.blobs[1].air;

export function stepWorld(
  world: World,
  inputs: readonly [number, number],
): void {
  if (world.phase === "over" || world.step >= T.MAX_STEP) return;
  // During the settle after a point nobody starts a jump, so both blobs come down and the next serve can start
  // even while two players hold jump.
  const settling = world.phase === "dead";
  const bits = (side: Side) => {
    const held = inputs[side];
    return isInput(held) ? (settling ? held & ~JUMP : held) : 0;
  };
  stepBlob(world.blobs[0], bits(0), world.step);
  stepBlob(world.blobs[1], bits(1), world.step);
  const playing = world.phase === "serve" || world.phase === "rally";
  if (playing && world.step % 2 === 0) collide(world);
  if (world.phase === "serve" && world.ball.live) {
    world.phase = "rally";
    world.phaseSteps = 0;
  }
  stepBall(world);
  if (
    world.step % T.FRAME_STEPS === T.FRAME_STEPS - 1 &&
    (world.phase === "serve" || world.phase === "rally")
  )
    countTouches(world);
  if (world.phase === "serve") {
    // A server who never touches the ball loses it to gravity.
    if (++world.phaseSteps >= T.SERVE_TIMEOUT) {
      world.ball.live = true;
      world.phase = "rally";
      world.phaseSteps = 0;
    }
  } else if (world.phase === "dead") {
    if (world.phaseSteps > 0) world.phaseSteps--;
    else if (grounded(world)) {
      if (world.winner !== -1) world.phase = "over";
      else serve(world);
    }
  }
  world.step++;
}

/** The slot that has won the match, or −1 while nobody has. */
export const winnerOf = (world: World): -1 | Side =>
  world.phase === "over" ? world.winner : -1;
