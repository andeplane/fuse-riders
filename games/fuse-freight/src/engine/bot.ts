import {
  BOUNDS,
  CENTER_X,
  CENTER_Y,
  DOCKS,
  dockAt,
  dockCenter,
} from "./arena.js";
import {
  DIRS,
  UNIT,
  cos,
  dist2,
  div,
  headingOf,
  isqrt,
  px,
  sin,
  turnBetween,
} from "./math.js";
import { hash } from "./rng.js";
import { LEFT, RIGHT } from "./input.js";
import { nose, speedOf } from "./step.js";
import { wagons } from "./trail.js";
import * as T from "./tuning.js";
import { played, type Train, type World } from "./world.js";

/**
 * The AI driver. It reads the world as any player could and answers with ordinary held bits once per log tick; it
 * gets no physics of its own. It picks one thing to drive at (the cheapest cart, a rival's tail worth cutting, or a
 * dock when it has enough to bank, is being chased, or is running out of time) and steers for it, keeping clear of
 * the walls and of rival locomotives. A temperament from the seed makes some bots greedier and some bolder thieves.
 */
interface Aim {
  x: number;
  y: number;
  /** Driving to a dock: the walls there are where it wants to be. */
  dock: boolean;
  /** The rival whose tail it is after, whose locomotive it need not dodge. */
  victim?: Train;
}

/** Radius of the turning circle at this speed, in sub-units: speed ÷ (TURN × 2π ÷ DIRS). */
const turnRadius = (speed: number) => div(speed * DIRS * 1000, T.TURN * 6283);

export function botInput(world: World, train: Train): number {
  if (world.phase !== "play") return 0;
  const aim = choose(world, train);
  return steer(world, train, aim);
}

function temperament(world: World, train: Train) {
  const roll = hash(world.seed, train.slot, 0xb07);
  return {
    /** Wagons it likes to bank at once. */
    greed: 3 + (roll % 4),
    /** How much a cut is worth to it against a cart, in pixels of detour per wagon it would take. */
    daring: px(8 + ((roll >>> 8) % 4) * 11),
  };
}

function choose(world: World, train: Train): Aim {
  const { greed, daring } = temperament(world, train);
  const speed = speedOf(train),
    radius = turnRadius(speed),
    left = world.length - played(world),
    [nx, ny] = nose(train);
  const reach = (x: number, y: number) => {
    const dx = x - nx,
      dy = y - ny,
      distance = isqrt(dx * dx + dy * dy),
      turn = Math.abs(turnBetween(train.dir, headingOf(dx, dy)));
    // Path length, roughly: the straight line plus the arc it must turn through first.
    return distance + div(turn * radius * 6283, DIRS * 1000);
  };

  // Bank when full, greedy enough, chased, or short of time.
  const carrying = train.cargo.length;
  if (carrying > 0) {
    const docks = DOCKS.map((_, index) => dockCenter(index)),
      costs = docks.map((dock) => reach(dock.x, dock.y)),
      best = costs[0]! <= costs[1]! ? 0 : 1,
      steps = div(costs[best]!, Math.max(1, speed));
    if (
      carrying >= T.MAX_WAGONS ||
      carrying >= greed ||
      left < steps + 45 ||
      (carrying >= 2 && chased(world, train))
    )
      return { ...docks[best]!, dock: true };
  }

  let aim: Aim | undefined,
    cheapest = Number.POSITIVE_INFINITY;
  for (const cart of world.carts) {
    if (carrying >= T.MAX_WAGONS) break;
    const cost = reach(cart.x, cart.y),
      eta = div(cost, Math.max(1, speed));
    if (cart.cool > eta) continue;
    // A cart a rival is much nearer to is probably gone by the time it gets there.
    const contested = world.trains.some((rival) => {
      if (rival === train) return false;
      const [rx, ry] = nose(rival);
      return dist2(rx, ry, cart.x, cart.y) * 4 < cost * cost;
    });
    const total = cost + (contested ? px(160) : 0);
    if (total < cheapest) {
      cheapest = total;
      aim = { x: cart.x, y: cart.y, dock: false };
    }
  }
  for (const victim of world.trains) {
    if (victim === train || victim.guard > 0 || victim.cargo.length === 0)
      continue;
    const points = wagons(victim),
      // The second wagon when there is one: nearly all of the tail, and clear of the rival's locomotive.
      index = points.length > 1 ? 1 : 0,
      [wx, wy] = points[index]!,
      cost = reach(wx, wy),
      eta = Math.min(90, div(cost, Math.max(1, speed)));
    if (cost > px(260)) continue;
    // Where that wagon will be by then, following its locomotive.
    const lead = div(speedOf(victim) * eta, 2),
      x = wx + div(lead * cos(victim.dir), UNIT),
      y = wy + div(lead * sin(victim.dir), UNIT);
    const total = cost - daring * (points.length - index);
    if (total < cheapest) {
      cheapest = total;
      aim = { x, y, dock: false, victim };
    }
  }
  if (aim) return aim;
  if (carrying > 0) {
    const docks = DOCKS.map((_, index) => dockCenter(index));
    const best =
      reach(docks[0]!.x, docks[0]!.y) <= reach(docks[1]!.x, docks[1]!.y)
        ? 0
        : 1;
    return { ...docks[best]!, dock: true };
  }
  return { x: CENTER_X, y: CENTER_Y, dock: false };
}

/** A rival nose close behind one of its wagons and closing on it. */
function chased(world: World, train: Train): boolean {
  const points = wagons(train);
  return world.trains.some((rival) => {
    if (rival === train) return false;
    const [rx, ry] = nose(rival),
      hx = cos(rival.dir),
      hy = sin(rival.dir);
    return points.some(
      ([wx, wy]) =>
        dist2(rx, ry, wx, wy) < px(110) * px(110) &&
        hx * (wx - rx) + hy * (wy - ry) > 0,
    );
  });
}

function steer(world: World, train: Train, aim: Aim): number {
  const speed = speedOf(train),
    radius = turnRadius(speed),
    hx = cos(train.dir),
    hy = sin(train.dir);
  // A little wander from the seed, so two bots after one cart do not drive one line.
  const wobble = hash(world.seed, train.slot, div(world.step, 40));
  const tx = aim.x + ((wobble % 25) - 12) * 64,
    ty = aim.y + (((wobble >>> 8) % 25) - 12) * 64;

  // Walls: where it will be a turning circle ahead. Near a dock it is after, the wall is where it wants to go.
  const look = 2 * radius,
    ax = train.x + div(hx * look, UNIT),
    ay = train.y + div(hy * look, UNIT),
    margin = px(4);
  const walled =
    ax < BOUNDS.left + margin ||
    ax > BOUNDS.right - margin ||
    ay < BOUNDS.top + margin ||
    ay > BOUNDS.bottom - margin;
  if (walled && !(aim.dock && dockAt(ax, ay, px(40)) >= 0))
    return turnTo(hx, hy, CENTER_X - train.x, CENTER_Y - train.y);

  // Rival locomotives just ahead: swerve, unless it is the one whose tail it wants.
  for (const rival of world.trains) {
    if (rival === train || rival === aim.victim) continue;
    const dx = rival.x - train.x,
      dy = rival.y - train.y;
    if (
      dist2(0, 0, dx, dy) < px(62) * px(62) &&
      hx * dx + hy * dy > 0 &&
      Math.abs(hx * dy - hy * dx) < px(34) * UNIT
    )
      return hx * dy - hy * dx > 0 ? LEFT : RIGHT;
  }

  const dx = tx - train.x,
    dy = ty - train.y,
    cross = hx * dy - hy * dx,
    dot = hx * dx + hy * dy;
  // Inside the turning circle on its side: no turn gets there, so drive on and come round wider.
  const side = cross > 0 ? 1 : -1,
    cx = train.x + div(-hy * radius * side, UNIT),
    cy = train.y + div(hx * radius * side, UNIT);
  if (dist2(cx, cy, tx, ty) < div(radius * radius * 9, 10)) return 0;
  // Close enough to straight ahead: about three degrees.
  if (dot > 0 && Math.abs(cross) * 19 < dot) return 0;
  return side > 0 ? RIGHT : LEFT;
}

const turnTo = (hx: number, hy: number, dx: number, dy: number): number =>
  hx * dy - hy * dx > 0 ? RIGHT : LEFT;
