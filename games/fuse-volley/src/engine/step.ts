import { JUMP, LEFT, RIGHT, isInput } from "./input.js";
import { SINGLES, type Court } from "./court.js";
import { abs, div, isqrt, round } from "./math.js";
import * as T from "./tuning.js";
import {
  courtOf,
  otherSide,
  rng,
  serve,
  setTouches,
  touchesOf,
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

export function stepBlob(
  blob: Blob,
  bits: number,
  step: number,
  court: Court = SINGLES,
): void {
  const side = blob.side;
  if (bits & RIGHT) {
    blob.x = Math.min(blob.x + T.RUN_SPEED, court.blobMax[side]);
    startSquash(blob);
  }
  if (bits & LEFT) {
    blob.x = Math.max(blob.x - T.RUN_SPEED, court.blobMin[side]);
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

/** The top of a blob's head above its feet, px, as squashed now. */
export const headTop = (blob: Blob): number =>
  T.HEAD_UP[blob.frame]! + (T.HEAD_HIT / T.BU - T.BALL_RADIUS);

/**
 * Two teammates are solid to each other. Overlapping side by side, they are pushed apart evenly, as far as the side's
 * limits allow, so a blob running into a standing one shoves it at half speed and two pushing each other stand still.
 * A blob whose feet are above the other's head passes over it; one coming down onto the head pops back up and slides
 * off. Blobs on opposite sides never meet: the net keeps them 80 px apart.
 */
export function separate(a: Blob, b: Blob, court: Court): void {
  const gap = 2 * T.BLOB_HALF - abs(b.x - a.x);
  if (gap <= 0 || a.side !== b.side) return;
  const [low, high] = a.y <= b.y ? [a, b] : [b, a];
  const over = low.y + headTop(low) * T.HU - high.y;
  if (over <= 0) return;
  // Mostly above the other's head and coming down onto it: a pop up, as well as the push off below.
  if (high.y > low.y && over < gap * T.HU && high.vy <= low.vy) {
    high.vy = T.HEAD_BOUNCE;
    high.air = true;
    if (low.frame === 0 && low.dir === 0) low.dir = 1;
  }
  // Worked in the side's own frame (from its wall towards the net), so both sides of the court play alike: the blob
  // nearer the wall, or level, the lower slot (passed first), goes towards the wall and takes the smaller half.
  const side = a.side,
    sign = side === 0 ? 1 : -1;
  const at = (blob: Blob) => sign * blob.x;
  const [outer, inner] = at(b) < at(a) ? [b, a] : [a, b];
  const wall = side === 0 ? court.blobMin[0] : -court.blobMax[1],
    limit = side === 0 ? court.blobMax[0] : -court.blobMin[1];
  let o = at(outer) - div(gap, 2),
    i = at(inner) + gap - div(gap, 2);
  if (o < wall) {
    i += wall - o;
    o = wall;
  }
  if (i > limit) {
    o -= i - limit;
    i = limit;
  }
  outer.x = sign * o;
  inner.x = sign * i;
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

/** The ball against every blob's head, then every body, and the net's top (0x443bf0). */
export function collide(world: World): void {
  const ball = world.ball,
    court = courtOf(world);
  const speed = isqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const circles: [Blob, { x: number; y: number }, number, number][] = [
    ...world.blobs.map(
      (blob) =>
        [blob, headCentre(blob), T.HEAD_HIT, T.HEAD_OUT] as [
          Blob,
          { x: number; y: number },
          number,
          number,
        ],
    ),
    ...world.blobs.map(
      (blob) =>
        [blob, bodyCentre(blob), T.BODY_HIT, T.BODY_OUT] as [
          Blob,
          { x: number; y: number },
          number,
          number,
        ],
    ),
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
      setTouches(world, otherSide(blob.side), 0);
    }
    ball.vx = round(dx * T.HIT_SPEED, d);
    ball.vy = round(dy * T.HIT_SPEED, d);
    pushOut(world, centre.x, centre.y, out);
  }
  let dx = ball.x - court.netTopX,
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
    pushOut(world, court.netTopX, T.NET_TOP_Y, T.NET_OUT);
  }
}

/** The ball moves, falls, and bounces off the sand, the walls and the net's pole (0x4441d0, 0x444100). */
export function stepBall(world: World): void {
  const ball = world.ball,
    court = courtOf(world);
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
      pointAgainst(world, ball.x >= court.netTopX ? 1 : 0, false);
  }
  if (ball.x < court.ballLeft) {
    ball.vx = -ball.vx;
    ball.x = court.ballLeft;
  }
  if (ball.x > court.ballRight) {
    ball.vx = -ball.vx;
    ball.x = court.ballRight;
  }
  // The pole, read the same way from either side: a ball's back edge (from the right) or its front edge seen in a
  // mirror (from the left) inside the band turns it back. The exe floors both edges in screen space, which makes the
  // left side's band a pixel narrower; mirroring keeps the court fair.
  if (div(ball.y, T.BU) - T.BALL_RADIUS <= T.POLE_TOP) {
    const back = div(ball.x, T.BU) - T.BALL_RADIUS,
      front = div(2 * court.netTopX - ball.x, T.BU) - T.BALL_RADIUS;
    if (ball.vx < 0 && court.poleLow <= back && back < court.poleHigh) {
      ball.x = court.polePutRight;
      ball.vx = -ball.vx;
      world.netCounter = count(world.netCounter);
    } else if (
      ball.vx > 0 &&
      court.poleLow <= front &&
      front < court.poleHigh
    ) {
      ball.x = court.polePutLeft;
      ball.vx = -ball.vx;
      world.netCounter = count(world.netCounter);
    }
  }
  // The tunnelling guard, on the last step's position: a low ball never ends up inside or across the pole. The exe
  // watches one line left of the net; its mirror on the right is watched too.
  const across = (line: number) => ball.prevX >= line !== ball.x >= line;
  const crossed =
    ball.live && (across(court.guardLine) || across(court.guardMirror));
  if (
    ((court.guardLow <= ball.x && ball.x <= court.guardHigh) || crossed) &&
    ball.y <= T.GUARD_Y &&
    ball.prevY < T.GUARD_PREV_Y
  ) {
    ball.x =
      ball.prevX > court.netTopX
        ? court.guardPutRight
        : ball.prevX < court.netTopX
          ? court.guardPutLeft
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
  const ball = world.ball,
    court = courtOf(world);
  if (ball.x >= court.clearRight) setTouches(world, 0, 0);
  else if (ball.x <= court.clearLeft) setTouches(world, 1, 0);
  for (const blob of world.blobs) {
    const playing = world.phase === "serve" || world.phase === "rally";
    if (blob.contact && !blob.prevContact) {
      // Teammates share the count: three touches a side, however they split them.
      setTouches(world, blob.side, touchesOf(world, blob.side) + 1);
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

/** Every blob's feet on the sand. */
const grounded = (world: World): boolean =>
  world.blobs.every((blob) => !blob.air);

/** One step with `inputs[slot]` held by each blob; a missing or malformed input holds nothing. */
export function stepWorld(world: World, inputs: readonly number[]): void {
  if (world.phase === "over" || world.step >= T.MAX_STEP) return;
  // During the settle after a point nobody starts a jump, so both blobs come down and the next serve can start
  // even while two players hold jump.
  const settling = world.phase === "dead";
  const bits = (slot: number) => {
    const held = inputs[slot];
    return isInput(held) ? (settling ? held & ~JUMP : held) : 0;
  };
  const court = courtOf(world),
    blobs = world.blobs;
  for (const [slot, blob] of blobs.entries())
    stepBlob(blob, bits(slot), world.step, court);
  // Teammates (slots two apart) after both have moved.
  for (let slot = 0; slot + 2 < blobs.length; slot++)
    separate(blobs[slot]!, blobs[slot + 2]!, court);
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
