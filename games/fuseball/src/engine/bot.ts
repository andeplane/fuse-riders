import { apart, inShape, resolveSolids, settle } from "./collide.js";
import { BTN, DOWN, LEFT, RIGHT } from "./input.js";
import { SUB, abs, clamp, delta, div, isqrt } from "./math.js";
import { boxesOf, isCircle, mapOf, type MapDef } from "./maps.js";
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
/** The other rider this close to a sitting ball is pinning it. */
const PIN = 30 * SUB;
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
 * From the ball to the goal in `slot`'s colour that is cheapest to reach. A goal in a wall sits on the seam back to
 * back with the other colour's, so it is only approached from inside the field. A round goal hangs in open space
 * and may be reached round the seam, but never along a line that crosses the other colour's goal first. Upwards
 * costs double: the ball falls by itself.
 */
function aim(
  map: MapDef,
  slot: Slot,
  bx: number,
  by: number,
): { x: number; y: number } {
  let best = { x: 0, y: 0 },
    cheapest = -1;
  const weigh = (x: number, y: number, penalty: number) => {
    const cost = abs(x) + (y < 0 ? -2 * y : y) + penalty;
    if (cheapest < 0 || cost < cheapest) {
      best = { x, y };
      cheapest = cost;
    }
  };
  for (const goal of map.goals) {
    if (goal.team !== slot) continue;
    if (!isCircle(goal)) {
      weigh(
        div((goal.x * 2 + goal.w) * SUB, 2) - bx,
        div((goal.y * 2 + goal.h) * SUB, 2) - by,
        0,
      );
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
 * is passed by its corner that makes the shortest trip, among the corners a rider fits at.
 */
function route(
  world: World,
  rider: Rider,
  map: MapDef,
  to: { dx: number; dy: number },
): { dx: number; dy: number } {
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
  const resting = solidAt(rider.x + to.dx, rider.y + to.dy);
  for (let i = 1; i < LOOKS; i++) {
    const box = solidAt(
      rider.x + div(to.dx * i, LOOKS),
      rider.y + div(to.dy * i, LOOKS),
    );
    if (!box || box === resting) continue;
    const at = apart(box.cx, box.cy, rider.x, rider.y, map);
    let best = to,
      shortest = -1;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const dx = at.dx + sx * (box.hw + body),
          dy = at.dy + sy * (box.hh + body);
        // A corner it already stands at leads nowhere.
        if (abs(dx) <= CLEAR && abs(dy) <= CLEAR) continue;
        if (!fits(rider.x + dx, rider.y + dy)) continue;
        const trip = abs(dx) + abs(dy) + abs(to.dx - dx) + abs(to.dy - dy);
        if (shortest < 0 || trip < shortest) {
          best = { dx, dy };
          shortest = trip;
        }
      }
    return best;
  }
  return to;
}

export function botInput(world: World, rider: Rider): number {
  if (world.phase !== "play" || rider.zapped || !world.ball.live) return 0;
  // A breather now and then, at different moments for each side, so two bots never mirror each other for long.
  const spell = div(world.step, SPELL);
  if ((spell * 5 + rider.slot * 4 + div(spell, SPELLS)) % SPELLS < REST_OF)
    return 0;
  const map = mapOf(world.mapId);
  const ahead = flight(world, map, world.ball, SIGHT, rider);
  // It is going in by itself: stay out of its way.
  if (ahead.into === rider.slot) return 0;
  const bx = ahead.x,
    by = ahead.y;
  const goal = aim(map, rider.slot, bx, by),
    reach = isqrt(goal.x * goal.x + goal.y * goal.y);
  const ux = reach ? div(goal.x * UNIT, reach) : 0,
    uy = reach ? div(goal.y * UNIT, reach) : UNIT;
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
  const { dx, dy } = route(
    world,
    rider,
    map,
    apart(bx + ox, by + oy, rider.x, rider.y, map),
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
    if (lifts && along < 0 && sitting) {
      // A sitting ball wants a lift when the goal is above, and when the other rider is leaning on its far side:
      // then the two take turns, so a pair of bots never lifts as one.
      const other = world.riders[rider.slot === 0 ? 1 : 0],
        gap = apart(other.x, other.y, world.ball.x, world.ball.y, map),
        pinned = !other.zapped && abs(gap.dx) + abs(gap.dy) < PIN,
        turn = (div(world.step, 2 * T.STEPS_PER_TICK) + rider.slot) % 2 === 0;
      if (uy < 0 || (pinned && turn)) return way | (fresh ? BTN : 0);
    }
    if (dy < -CLIMB) return way | (fresh && (!lifts || along < 0) ? BTN : 0);
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
