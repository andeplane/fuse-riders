import { apart, inShape, resolveSolids, settle } from "./collide.js";
import { BTN, DOWN, LEFT, RIGHT } from "./input.js";
import { SUB, abs, clamp, delta, div, isqrt } from "./math.js";
import { boxesOf, isCircle, mapOf, type Box, type MapDef } from "./maps.js";
import * as T from "./tuning.js";
import type { Rider, Slot, World } from "./world.js";

/**
 * The computer's rider. It reads the world the way a player reads the screen and answers with the bits it holds for
 * the next log tick: nothing here moves anything, so it has no physics a player lacks. It keeps no memory and rolls
 * no dice — its answer is a function of the world alone — so every device folding a bot seat gets the same bits, and
 * a rollback replays them. It is part of the rules: changing it must bump `RULES`.
 *
 * The plan is one a beginner would recognise: see where the ball is going, get to the far side of it from the goal
 * in its own colour, then fly through it towards that goal. On the wrong side it goes round the ball instead of
 * through it, since knocking the ball the other way is how own goals happen; and a ball already on its way into its
 * goal is left alone. Every so often it takes a breather, which is what makes it beatable.
 *
 * Nothing here knows an arena by name. With several goals in its colour it takes the one cheapest to reach, the
 * short way round a seam included; a line to a goal that a wall, a kerb or the other colour's goal stands on is no
 * line, and then the ball is lobbed or lifted over. It finds its own way round solids the same way, by their
 * corners, and takes the long way round a seam when that is the shorter trip. It still gives points away: a hard
 * shot that misses comes back off a wall, and in an arena with the other colour's goal behind it that is an own goal.
 */
const UNIT = 1024;
/** How far ahead it reads the ball's flight, in micro-steps, and how coarsely it looks for a meeting point. */
const SIGHT = 180,
  STRIDE = 6;
/** Within this of the ball it weighs what its touch would do, reading the shot this many micro-steps ahead. */
const WARY = 44 * SUB,
  FORESIGHT = 420;
/** The speed it reckons it can close on the ball at, in sub-units a step: a little under a run. */
const PACE = 6500;
/** How far behind the ball it lines up, and how wide it swings to get round it. */
const STANDOFF = 20 * SUB,
  ROUND = 30 * SUB;
/** Inside this it is behind the ball closely enough to go for it. */
const LINED_UP = 14 * SUB;
/** The stick is centred when the target is this close sideways. */
const DEAD = 3 * SUB;
/** It flaps when the target is this far above, and dives when it is this far below. */
const CLIMB = 4 * SUB,
  SINK = 26 * SUB,
  DIVE = 70 * SUB;
/** How much room it leaves between itself and a platform it is going round. */
const CLEAR = 5 * SUB;
/** How many points along the straight line to its target it checks for a solid in the way. */
const LOOKS = 16;
/** A slide is worth it from this far along the floor, and ends this close. */
const SLIDE_FROM = 110 * SUB,
  SLIDE_UNTIL = 40 * SUB;
/** A ball slower than this, in sub-units a step, is sitting: next to it on the floor the move is a lift. */
const SITTING = 600;
/** A goal within `NUDGE_RANGE` and not above is nudged at: from `NUDGE_FROM` behind the ball, no faster than `NUDGE`. */
const NUDGE_RANGE = 300 * SUB,
  NUDGE_FROM = 60 * SUB,
  NUDGE = 3200;
/** With the ball's centre this close to its own, it is standing in the ball. */
const BURIED = div(T.RIDER_R + T.BALL_R, 2);
/** The other rider this close to a sitting ball is pinning it. */
const PIN = 30 * SUB;
/** Running at least this fast, a lift takes the ball along. */
const CARRY = 4000;
/** A line to a goal is clear when the ball has this much room either side of it, and ends this far inside the mouth. */
const BALL_ROOM = T.BALL_R - SUB,
  MOUTH = 12 * SUB;
/** A solid this close in front of it on the ground is one to hop. */
const HOP = 4 * SUB;
/** A lob's direction, in `UNIT`s: three along and four up. */
const LOB_X = div(UNIT * 3, 5),
  LOB_Y = div(UNIT * 4, 5);
/** How far along a lob it looks for the other colour's goal, in sub-units per `UNIT` of direction: 260 pixels. */
const LOB_REACH = div(260 * SUB, UNIT);
/** Its attention comes in spells this many micro-steps long; in `REST_OF` of every `SPELLS` it does nothing. */
const SPELL = 84,
  SPELLS = 9,
  REST_OF = 1;

/** Where the ball is heading by itself: the meeting point it offers this rider, and the goal it ends in, if any. */
interface Flight {
  x: number;
  y: number;
  /** The colour of the goal it falls into within `SIGHT`, or −1. */
  into: -1 | Slot;
}

/** One micro-step of a ball nobody touches: gravity and the solids, as `step.ts` moves it. */
function drift(
  ball: { x: number; y: number; vx: number; vy: number },
  boxes: readonly Box[],
  map: MapDef,
): void {
  ball.vy += T.BALL_GRAVITY;
  ball.vx = clamp(ball.vx, -T.BALL_MAX, T.BALL_MAX);
  ball.vy = clamp(ball.vy, -T.BALL_MAX, T.BALL_MAX);
  ball.x += ball.vx;
  ball.y += ball.vy;
  const touch = resolveSolids(
    ball,
    T.BALL_R,
    boxes,
    map,
    T.BALL_BOUNCE_NUM,
    T.BALL_BOUNCE_DEN,
  );
  if (touch.hit) {
    ball.vx -= div(ball.vx, T.BALL_SCRUB);
    ball.vy -= div(ball.vy, T.BALL_SCRUB);
  }
  settle(ball, T.BALL_R, map);
}

/**
 * A ball flown forward from `(x, y)` at `(vx, vy)` with nobody touching it: gravity and the solids, as `step.ts`
 * moves it, for `steps` micro-steps or until it falls into a goal. With a `rider`, the point returned is the first
 * one that rider could reach in time; without, where the ball ends up.
 */
function flight(
  world: World,
  map: MapDef,
  from: { x: number; y: number; vx: number; vy: number },
  steps: number,
  rider?: Rider,
): Flight {
  const boxes = boxesOf(world.mapId);
  const ball = { x: from.x, y: from.y, vx: from.vx, vy: from.vy };
  let meet: { x: number; y: number } | undefined;
  for (let step = 1; step <= steps; step++) {
    drift(ball, boxes, map);
    const goal = map.goals.find((each) => inShape(ball.x, ball.y, each, map));
    if (goal) return { ...(meet ?? ball), into: goal.team };
    if (rider && !meet && step % STRIDE === 0) {
      const gap = apart(ball.x, ball.y, rider.x, rider.y, map),
        far = abs(gap.dx) + abs(gap.dy) - STANDOFF;
      if (far <= PACE * step) meet = { x: ball.x, y: ball.y };
    }
  }
  return { ...(meet ?? ball), into: -1 };
}

/**
 * Whether touching the ball now, at the speeds the two are closing at, would send it into the other colour's goal:
 * the kick `step.ts` would give it, flown forward.
 */
function ownGoalShot(world: World, rider: Rider, map: MapDef): boolean {
  const ball = world.ball,
    gap = apart(ball.x, ball.y, rider.x, rider.y, map),
    d2 = gap.dx * gap.dx + gap.dy * gap.dy;
  if (d2 === 0 || d2 > WARY * WARY) return false;
  const closing = (ball.vx - rider.vx) * gap.dx + (ball.vy - rider.vy) * gap.dy;
  if (closing >= 0) return false;
  const shot = {
    x: ball.x,
    y: ball.y,
    vx: ball.vx - div(closing * gap.dx * T.KICK_NUM, d2 * T.KICK_DEN),
    vy: ball.vy - div(closing * gap.dy * T.KICK_NUM, d2 * T.KICK_DEN),
  };
  const into = flight(world, map, shot, FORESIGHT).into;
  return into !== -1 && into !== rider.slot;
}

/** One way from the ball to a goal along an axis, or the other way round the seam. */
const ways = (
  to: number,
  from: number,
  size: number,
  wraps: boolean,
): number[] => {
  const direct = to - from;
  return wraps
    ? [direct, direct > 0 ? direct - size : direct + size]
    : [direct];
};

/**
 * Whether the straight line from a point along `(dx, dy)` passes through a box `hw` by `hh` about `(cx, cy)`, the
 * centre given from the line's start: the stretch of the line inside the box, kept as two fractions and compared by
 * cross-multiplying, is not empty.
 */
function meets(
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): boolean {
  let inN = 0,
    inD = 1,
    outN = 1,
    outD = 1;
  const axis = (d: number, low: number, high: number): boolean => {
    if (d === 0) return low < 0 && high > 0;
    const den = abs(d),
      near = d > 0 ? low : -high,
      far = d > 0 ? high : -low;
    if (near * inD > inN * den) {
      inN = near;
      inD = den;
    }
    if (far * outD < outN * den) {
      outN = far;
      outD = den;
    }
    return true;
  };
  return (
    axis(dx, cx - hw, cx + hw) &&
    axis(dy, cy - hh, cy + hh) &&
    inN * outD < outN * inD
  );
}

/** The same box seen from `(bx, by)`: the short way round, and one field over each way on an axis that wraps. */
function meetsAny(
  map: MapDef,
  dx: number,
  dy: number,
  at: { dx: number; dy: number },
  hw: number,
  hh: number,
): boolean {
  for (const kx of map.wrapX ? [0, -1, 1] : [0])
    for (const ky of map.wrapY ? [0, -1, 1] : [0])
      if (meets(dx, dy, at.dx + kx * T.WORLD_W, at.dy + ky * T.WORLD_H, hw, hh))
        return true;
  return false;
}

/**
 * Whether a ball at `(bx, by)` sent straight along `(dx, dy)` would run into a solid or into the other colour's
 * goal on the way: a wall in front of a goal, a kerb, a pit that is not this rider's. The solid the ball is lying
 * on is not in the way — a ball rolls along a floor.
 */
function barred(
  world: World,
  map: MapDef,
  slot: Slot,
  bx: number,
  by: number,
  dx: number,
  dy: number,
): boolean {
  for (const box of boxesOf(world.mapId)) {
    const at = apart(box.cx, box.cy, bx, by, map);
    if (
      abs(dy) <= abs(dx) &&
      abs(at.dx) <= box.hw &&
      at.dy > 0 &&
      at.dy - box.hh <= T.BALL_R + 2 * SUB
    )
      continue;
    if (meetsAny(map, dx, dy, at, box.hw + BALL_ROOM, box.hh + BALL_ROOM))
      return true;
  }
  return gifts(map, slot, bx, by, dx, dy);
}

/** Whether that line runs through the other colour's goal, or within a ball's width of it. */
function gifts(
  map: MapDef,
  slot: Slot,
  bx: number,
  by: number,
  dx: number,
  dy: number,
): boolean {
  for (const goal of map.goals) {
    if (goal.team === slot || isCircle(goal)) continue;
    const hw = div(goal.w * SUB, 2),
      hh = div(goal.h * SUB, 2),
      at = apart(goal.x * SUB + hw, goal.y * SUB + hh, bx, by, map);
    if (meetsAny(map, dx, dy, at, hw + BALL_ROOM, hh + BALL_ROOM)) return true;
  }
  return false;
}

/**
 * From the ball to the goal in `slot`'s colour that is cheapest to reach. A goal in a wall sits on the seam back to
 * back with the other colour's, so it is only approached from inside the field, at its middle or near either end,
 * whichever the ball has a clear line to. A round goal hangs in open space and may be reached round the seam, but
 * never along a line that crosses the other colour's goal first. Upwards costs double: the ball falls by itself.
 * `over` says no line was clear: the ball has to go over whatever is in the way.
 */
function aim(
  world: World,
  map: MapDef,
  slot: Slot,
  bx: number,
  by: number,
): { x: number; y: number; over: boolean } {
  let best = { x: 0, y: 0, over: false },
    cheapest = -1;
  const weigh = (x: number, y: number, penalty: number, over = false) => {
    const cost = abs(x) + (y < 0 ? -2 * y : y) + penalty;
    if (cheapest < 0 || cost < cheapest) {
      best = { x, y, over };
      cheapest = cost;
    }
  };
  for (const goal of map.goals) {
    if (goal.team !== slot) continue;
    if (!isCircle(goal)) {
      const cx = div((goal.x * 2 + goal.w) * SUB, 2) - bx,
        cy = div((goal.y * 2 + goal.h) * SUB, 2) - by,
        // The mouth runs along the goal's longer side; the ends are aimed at a ball's width in.
        tall = goal.h >= goal.w,
        end = div((tall ? goal.h : goal.w) * SUB, 2) - MOUTH;
      for (const off of end > 0 ? [0, -end, end] : [0]) {
        const x = tall ? cx : cx + off,
          y = tall ? cy + off : cy,
          shut = barred(world, map, slot, bx, by, x, y);
        weigh(x, y, shut ? T.WORLD_W : 0, shut);
      }
      continue;
    }
    for (const x of ways(goal.x * SUB, bx, T.WORLD_W, map.wrapX)) {
      // The other colour's round goals that this line would carry the ball under or over.
      const crosses = map.goals.some((other) => {
        if (other.team === slot || !isCircle(other)) return false;
        const at = other.x * SUB - bx,
          reach = (other.r + T.BALL_RADIUS) * SUB;
        return [at, at - T.WORLD_W, at + T.WORLD_W].some((ox) =>
          x > 0 ? ox > -reach && ox < x : ox < reach && ox > x,
        );
      });
      for (const y of ways(goal.y * SUB, by, T.WORLD_H, map.wrapY))
        weigh(x, y, crosses ? T.WORLD_W : 0);
    }
  }
  return best;
}

/**
 * The way to a spot `to` away, round whatever solid stands on the straight line there: the first one the line meets
 * is passed by its corner that makes the shortest trip, among the corners a rider fits at. `ball` is where the ball
 * it is after will be.
 */
function route(
  world: World,
  rider: Rider,
  map: MapDef,
  to: { dx: number; dy: number },
  ball: { x: number; y: number },
  depth = 0,
): { dx: number; dy: number; clear: boolean; trip: number } {
  const boxes = boxesOf(world.mapId),
    snug = T.RIDER_R - SUB,
    body = T.RIDER_R + CLEAR;
  const solidAt = (x: number, y: number) =>
    boxes.find((box) => {
      const at = apart(x, y, box.cx, box.cy, map);
      return abs(at.dx) < box.hw + snug && abs(at.dy) < box.hh + snug;
    });
  const fits = (x: number, y: number) =>
    (map.wrapX || (x >= T.RIDER_R && x <= T.WORLD_W - T.RIDER_R)) &&
    (map.wrapY || (y >= T.RIDER_R && y <= T.WORLD_H - T.RIDER_R)) &&
    !solidAt(x, y);
  // A spot hard against a solid (a ball lying on the floor) is as near as it gets: that solid is not in the way.
  // Unless the ball is on its far face: a ball on a ledge is not reached through the ledge from below.
  let resting = solidAt(rider.x + to.dx, rider.y + to.dy);
  if (resting) {
    const mine = apart(rider.x, rider.y, resting.cx, resting.cy, map),
      its = apart(ball.x, ball.y, resting.cx, resting.cy, map);
    if (
      (mine.dy >= resting.hh && its.dy <= -resting.hh) ||
      (mine.dy <= -resting.hh && its.dy >= resting.hh)
    )
      resting = undefined;
  }
  /** The first solid on the straight line from the rider along `(dx, dy)`, but for `skip`. */
  const blocks = (dx: number, dy: number, skip?: Box) => {
    for (let i = 1; i < LOOKS; i++) {
      const box = solidAt(
        rider.x + div(dx * i, LOOKS),
        rider.y + div(dy * i, LOOKS),
      );
      if (box && box !== skip) return box;
    }
    return undefined;
  };
  const box = blocks(to.dx, to.dy, resting),
    straight = abs(to.dx) + abs(to.dy);
  if (!box) return { ...to, clear: true, trip: straight };
  const at = apart(box.cx, box.cy, rider.x, rider.y, map);
  // With no corner to go round by, it presses on, and the trip counts as longer than any other way.
  let best = { ...to, clear: false, trip: straight + T.WORLD_W + T.WORLD_H },
    open = false,
    behind = false;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const dx = at.dx + sx * (box.hw + body),
        dy = at.dy + sy * (box.hh + body);
      // A corner it already stands at leads nowhere.
      if (abs(dx) <= CLEAR && abs(dy) <= CLEAR) continue;
      if (!fits(rider.x + dx, rider.y + dy)) continue;
      // A corner behind something else (a kerb hanging beside the roof's end) is a longer trip than it looks.
      const shut = blocks(dx, dy, box) !== undefined,
        trip =
          abs(dx) +
          abs(dy) +
          abs(to.dx - dx) +
          abs(to.dy - dy) +
          (shut ? T.WORLD_W : 0);
      if (!open || trip < best.trip) {
        best = { dx, dy, clear: false, trip };
        open = true;
        behind = shut;
      }
    }
  if (behind && depth < 2) {
    // The corner to make for is itself behind something: that is gone round first.
    const via = route(world, rider, map, best, ball, depth + 1);
    return { dx: via.dx, dy: via.dy, clear: false, trip: best.trip };
  }
  return best;
}

/**
 * The way to a spot: the short way when nothing stands on it. When something does and the arena wraps, the long
 * way round a seam is taken instead if that makes the shorter trip, going round whatever stands on it: a roof between
 * it and a ball just the other side of the seam is not flown into for ever.
 */
function path(
  world: World,
  rider: Rider,
  map: MapDef,
  to: { dx: number; dy: number },
  ball: { x: number; y: number },
): { dx: number; dy: number } {
  const short = route(world, rider, map, to, ball);
  if (short.clear || !(map.wrapX || map.wrapY)) return short;
  const otherX = to.dx > 0 ? to.dx - T.WORLD_W : to.dx + T.WORLD_W,
    otherY = to.dy > 0 ? to.dy - T.WORLD_H : to.dy + T.WORLD_H;
  let best = short;
  for (const dx of map.wrapX ? [to.dx, otherX] : [to.dx])
    for (const dy of map.wrapY ? [to.dy, otherY] : [to.dy]) {
      if (dx === to.dx && dy === to.dy) continue;
      const round = route(world, rider, map, { dx, dy }, ball);
      if (round.trip < best.trip) best = round;
    }
  return best;
}

export function botInput(world: World, rider: Rider): number {
  if (world.phase !== "play" || rider.zapped || !world.ball.live) return 0;
  // A breather now and then, at different moments for each side, so two bots never mirror each other for long.
  const spell = div(world.step, SPELL);
  if ((spell * 5 + rider.slot * 4 + div(spell, SPELLS)) % SPELLS < REST_OF)
    return 0;
  const map = mapOf(world.mapId);
  const ahead = flight(world, map, world.ball, SIGHT, rider);
  // It is going in by itself: stay out of its way. Unless it is under this rider's feet, where it is going nowhere.
  const on = apart(world.ball.x, world.ball.y, rider.x, rider.y, map),
    touching =
      on.dx * on.dx + on.dy * on.dy < (T.RIDER_R + T.BALL_R + SUB) ** 2;
  if (ahead.into === rider.slot && !touching) return 0;
  // Standing in the ball (it is jammed under it in a corner) helps nobody: step off it, away from the wall.
  if (on.dx * on.dx + on.dy * on.dy < BURIED * BURIED)
    return on.dx > 0 || (on.dx === 0 && rider.x * 2 > T.WORLD_W) ? LEFT : RIGHT;
  const bx = ahead.x,
    by = ahead.y;
  const goal = aim(world, map, rider.slot, bx, by),
    reach = isqrt(goal.x * goal.x + goal.y * goal.y);
  // With nothing clear to aim along, the shot is a lob: up and towards the goal's side, over what is in the way.
  const side = goal.x !== 0 ? (goal.x > 0 ? 1 : -1) : rider.slot === 0 ? 1 : -1;
  // Unless a lob from here would drop the ball into the other colour's goal: then it is sent along the level.
  const flat =
    goal.over &&
    gifts(
      map,
      rider.slot,
      bx,
      by,
      side * LOB_X * LOB_REACH,
      -LOB_Y * LOB_REACH,
    );
  const ux = flat
      ? side * UNIT
      : goal.over
        ? side * LOB_X
        : reach
          ? div(goal.x * UNIT, reach)
          : 0,
    uy = flat
      ? 0
      : goal.over
        ? -LOB_Y
        : reach
          ? div(goal.y * UNIT, reach)
          : UNIT;
  // Where this rider is, seen from the ball: `along` the way to the goal (positive is the wrong side) and `across`.
  const from = apart(rider.x, rider.y, bx, by, map),
    along = div(from.dx * ux + from.dy * uy, UNIT),
    across = div(from.dx * uy - from.dy * ux, UNIT);

  // The spot to fly to, as an offset from the ball.
  let ox: number, oy: number;
  if (along < 0 && abs(across) < LINED_UP) {
    // Behind it and lined up: through the ball, a touch low so the kick lifts it.
    ox = 0;
    oy = SUB * 3;
  } else {
    ox = -div(ux * STANDOFF, UNIT);
    oy = -div(uy * STANDOFF, UNIT);
    if (along > -LINED_UP) {
      // Level with the ball or past it: swing round on the side it is already on, over the top when in doubt.
      const over = across !== 0 ? (across > 0 ? 1 : -1) : uy > 0 ? 1 : -1;
      ox += over * div(uy * ROUND, UNIT);
      oy -= over * div(ux * ROUND, UNIT);
    }
  }
  const { dx, dy } = path(
    world,
    rider,
    map,
    apart(bx + ox, by + oy, rider.x, rider.y, map),
    { x: bx, y: by },
  );

  const fresh = (rider.prev & BTN) === 0;
  if (ownGoalShot(world, rider, map)) {
    // This touch would be an own goal: pull out of it and come again.
    const gap = apart(rider.x, rider.y, world.ball.x, world.ball.y, map);
    return (
      (gap.dx < 0 ? LEFT : RIGHT) |
      (!rider.grounded && gap.dy <= 0 && rider.vy > 0 && fresh ? BTN : 0)
    );
  }
  let way = dx > DEAD ? RIGHT : dx < -DEAD ? LEFT : 0;
  // A goal that is near and not above wants a nudge, not a shot that comes back off the far wall: lined up and
  // closing fast, it lets go of the stick, or pulls it back, until it is down to a walk.
  const gap = apart(world.ball.x, world.ball.y, rider.x, rider.y, map),
    far = isqrt(gap.dx * gap.dx + gap.dy * gap.dy);
  if (far > 0 && far < NUDGE_FROM && reach < NUDGE_RANGE && uy * 4 > -UNIT) {
    const closing = div(
      (rider.vx - world.ball.vx) * gap.dx + (rider.vy - world.ball.vy) * gap.dy,
      far,
    );
    if (closing > NUDGE) {
      way = closing > 2 * NUDGE ? (gap.dx > 0 ? LEFT : RIGHT) : 0;
      // Dropping onto it too fast: a flap takes the edge off.
      if (!rider.grounded && gap.dy > 0 && rider.vy > NUDGE)
        return way | (fresh ? BTN : 0);
    }
  }
  if (rider.slide > 0)
    // Keep sliding while there is floor to cover; letting go ends it with a hop.
    return abs(dx) > SLIDE_UNTIL && abs(dy) < SINK ? DOWN | BTN | way : way;
  if (rider.grounded) {
    // Next to the ball a jump is a lift, which is only wanted from behind it.
    const near = apart(rider.x, rider.y, world.ball.x, world.ball.y, map),
      lifts = abs(near.dx) < T.LIFT_X && abs(near.dy) < T.LIFT_Y,
      sitting = abs(world.ball.vx) < SITTING && abs(world.ball.vy) < SITTING;
    if (lifts && sitting) {
      // A sitting ball wants a lift when the goal is above, and when the other rider is leaning on its far side:
      // then the two take turns, so a pair of bots never lifts as one.
      const other = world.riders[rider.slot === 0 ? 1 : 0],
        gap = apart(other.x, other.y, world.ball.x, world.ball.y, map),
        pinned = !other.zapped && abs(gap.dx) + abs(gap.dy) < PIN,
        turn = (div(world.step, 2 * T.STEPS_PER_TICK) + rider.slot) % 2 === 0;
      if (along < 0) {
        if (uy < 0 || (pinned && turn)) return way | (fresh ? BTN : 0);
      } else if (pinned) {
        // On the wrong side of it with the other rider where it wants to stand: a lift carries the ball along
        // with whoever lifts it, so it runs for the goal and lifts once it is moving.
        const goalward = ux > 0 || (ux === 0 && rider.slot === 0) ? 1 : -1;
        return (
          (goalward > 0 ? RIGHT : LEFT) |
          (fresh && rider.vx * goalward > CARRY ? BTN : 0)
        );
      }
    }
    if (dy < -CLIMB) return way | (fresh && (!lifts || along < 0) ? BTN : 0);
    // Walking into a kerb or the foot of a wall gets nowhere: hop it.
    const stick = way & RIGHT ? 1 : way & LEFT ? -1 : 0,
      kerb =
        stick !== 0 &&
        boxesOf(world.mapId).some((box) => {
          const at = apart(box.cx, box.cy, rider.x, rider.y, map);
          return (
            at.dx * stick > 0 &&
            abs(at.dx) < box.hw + T.RIDER_R + HOP &&
            abs(at.dy) < box.hh + T.RIDER_R - SUB
          );
        });
    if (kerb) return way | (fresh && (!lifts || along < 0) ? BTN : 0);
    if (dy > SINK)
      // The target is below this ledge: walk off it, whichever way it was already going.
      return way || (rider.facing > 0 ? RIGHT : LEFT);
    if (abs(dx) > SLIDE_FROM && fresh) return way | DOWN | BTN;
    return way;
  }
  if (dy < -CLIMB) {
    // Flap, unless it is already rising fast enough to get there.
    const rising =
      rider.vy < 0 ? div(rider.vy * rider.vy, 2 * T.GRAVITY_RISE) : 0;
    return way | (fresh && rising < -dy ? BTN : 0);
  }
  if (dy > DIVE && fresh && rider.vy < T.QUICK_DROP) return way | DOWN | BTN;
  if (dy > SINK) return way | DOWN;
  return way;
}
