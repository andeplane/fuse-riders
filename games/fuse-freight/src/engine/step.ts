import { BOUNDS, FLOOR, dockAt } from "./arena.js";
import { looseTarget, rollCarts, spawnCart } from "./cargo.js";
import {
  DIRS,
  UNIT,
  clamp,
  cos,
  dist2,
  div,
  headingOf,
  isqrt,
  sin,
  wrapDir,
} from "./math.js";
import { INPUT_MASK, steering } from "./input.js";
import { along, layTrail, wagonDistance, wagons } from "./trail.js";
import * as T from "./tuning.js";
import { FX, effect, played, type Train, type World } from "./world.js";

/**
 * One simulation step. The order is part of the rules:
 *
 * 1. every train steers and drives, bouncing off the walls;
 * 2. locomotives that touch bump apart, pairs in slot order;
 * 3. loose carts roll and their cooldowns run down;
 * 4. cuts: every locomotive nose touching a rival wagon is found first, against the same positions, then each
 *    victim loses the wagon nearest its locomotive that any nose touched, and everything behind it;
 * 5. collection: each cart goes to the nearest nose touching it (the lower slot on a tie) with room for a wagon;
 * 6. delivery: a locomotive inside a dock banks every wagon it pulls;
 * 7. a new cart may arrive, timers run down, and the whistle blows when the round's time is up.
 *
 * So a wagon cut this step cannot be delivered or collected this step, and a wagon is only ever in one train, one
 * cart or one score. `inputs` holds each train's held bits by id; a missing id holds nothing (it drives straight).
 */
export function stepWorld(
  world: World,
  inputs: ReadonlyMap<string, number>,
): void {
  world.step++;
  for (const train of world.trains)
    train.input = (inputs.get(train.id) ?? 0) & INPUT_MASK;
  world.fx = world.fx.filter((fx) => world.step - fx.at <= T.FX_LIFE);
  if (world.phase === "countdown") {
    if (world.step >= T.COUNTDOWN_STEPS) {
      world.phase = "play";
      world.phaseAt = world.step;
    }
    return;
  }
  // After the whistle the trains stand where they stopped; only rolling carts come to rest.
  if (world.phase === "outro") {
    rollCarts(world);
    return;
  }
  for (const train of world.trains) drive(world, train);
  bumps(world);
  rollCarts(world);
  cuts(world);
  collect(world);
  deliver(world);
  if (world.step >= world.spawnAt) {
    world.spawnAt = world.step + T.SPAWN_EVERY;
    if (world.carts.length < looseTarget(world)) spawnCart(world, true);
  }
  for (const train of world.trains) {
    if (train.guard > 0) train.guard--;
    if (train.bump > 0) train.bump--;
  }
  if (played(world) >= world.length) {
    world.phase = "outro";
    world.phaseAt = world.step;
  }
}

/** The round is over once the whistle has blown and the scores have stood for `OUTRO_STEPS`. */
export const roundDone = (world: World): boolean =>
  world.phase === "outro" && world.step - world.phaseAt >= T.OUTRO_STEPS;

/** A train's speed: slower for every wagon it pulls. */
export const speedOf = (train: Train): number =>
  T.SPEED - T.SPEED_LOSS * train.cargo.length;

/** The locomotive's nose: what collects carts and cuts rival wagons. */
export const nose = (train: Train): [number, number] => [
  train.x + div(T.NOSE * cos(train.dir), UNIT),
  train.y + div(T.NOSE * sin(train.dir), UNIT),
];

function drive(world: World, train: Train): void {
  train.dir = wrapDir(train.dir + steering(train.input) * T.TURN);
  const speed = speedOf(train),
    fromX = train.x,
    fromY = train.y;
  train.x += div(speed * cos(train.dir), UNIT);
  train.y += div(speed * sin(train.dir), UNIT);
  // A wall mirrors the heading (and the overshoot), so a bounce is always the one you would expect.
  let knocked = false;
  if (train.x < BOUNDS.left || train.x > BOUNDS.right) {
    const wall = train.x < BOUNDS.left ? BOUNDS.left : BOUNDS.right;
    train.x = 2 * wall - train.x;
    train.dir = wrapDir(DIRS / 2 - train.dir);
    knocked = true;
  }
  if (train.y < BOUNDS.top || train.y > BOUNDS.bottom) {
    const wall = train.y < BOUNDS.top ? BOUNDS.top : BOUNDS.bottom;
    train.y = 2 * wall - train.y;
    train.dir = wrapDir(-train.dir);
    knocked = true;
  }
  layTrail(train, fromX, fromY);
  if (knocked && train.bump === 0) {
    effect(world, FX.wall, train.x, train.y, train.slot);
    train.bump = T.BUMP_COOL;
  }
}

/** Mirrors a heading in the contact line if it points into the contact (normal `n`, in `UNIT`s). */
function deflect(train: Train, nx: number, ny: number): void {
  const hx = cos(train.dir),
    hy = sin(train.dir),
    dot = hx * nx + hy * ny;
  if (dot <= 0) return;
  train.dir = headingOf(
    hx - div(2 * dot * nx, UNIT * UNIT),
    hy - div(2 * dot * ny, UNIT * UNIT),
  );
}

const keepIn = (train: Train) => {
  train.x = clamp(train.x, BOUNDS.left, BOUNDS.right);
  train.y = clamp(train.y, BOUNDS.top, BOUNDS.bottom);
};

/** Locomotives never pass through each other: each one heading into the contact mirrors off it, and both part. */
function bumps(world: World): void {
  const reach = 2 * T.LOCO_R;
  const trains = world.trains;
  for (let i = 0; i < trains.length; i++)
    for (let j = i + 1; j < trains.length; j++) {
      const a = trains[i]!,
        b = trains[j]!,
        dx = b.x - a.x,
        dy = b.y - a.y,
        d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const d = isqrt(d2);
      // Exactly on top of each other: part across a's heading.
      const nx = d === 0 ? cos(a.dir + DIRS / 4) : div(dx * UNIT, d),
        ny = d === 0 ? sin(a.dir + DIRS / 4) : div(dy * UNIT, d);
      deflect(a, nx, ny);
      deflect(b, -nx, -ny);
      const push = div(reach - d, 2) + 1;
      a.x -= div(nx * push, UNIT);
      a.y -= div(ny * push, UNIT);
      b.x += div(nx * push, UNIT);
      b.y += div(ny * push, UNIT);
      keepIn(a);
      keepIn(b);
      if (a.bump === 0 || b.bump === 0)
        effect(
          world,
          FX.bump,
          (a.x + b.x) >> 1,
          (a.y + b.y) >> 1,
          a.slot,
          0,
          b.slot,
        );
      a.bump = b.bump = T.BUMP_COOL;
    }
}

interface Hit {
  thief: Train;
  victim: Train;
  index: number;
}

function cuts(world: World): void {
  const points = new Map(world.trains.map((train) => [train, wagons(train)]));
  const reach = (T.NOSE_R + T.WAGON_R) * (T.NOSE_R + T.WAGON_R);
  const hits: Hit[] = [];
  for (const thief of world.trains) {
    const [nx, ny] = nose(thief);
    for (const victim of world.trains) {
      if (victim === thief || victim.guard > 0) continue;
      const index = points
        .get(victim)!
        .findIndex(([wx, wy]) => dist2(nx, ny, wx, wy) < reach);
      if (index >= 0) hits.push({ thief, victim, index });
    }
  }
  for (const victim of world.trains) {
    let best: Hit | undefined;
    for (const hit of hits)
      if (
        hit.victim === victim &&
        (!best ||
          hit.index < best.index ||
          (hit.index === best.index && hit.thief.slot < best.thief.slot))
      )
        best = hit;
    if (best) cutLoose(world, best, points.get(victim)!);
  }
}

/** Wagon `index` and everything behind it leave the victim as cooling carts, scattering off the line. */
function cutLoose(
  world: World,
  { thief, victim, index }: Hit,
  points: readonly [number, number][],
): void {
  const kinds = victim.cargo.splice(index);
  const [noseX, noseY] = nose(thief);
  kinds.forEach((kind, k) => {
    const [x, y] = points[index + k]!;
    if (world.carts.length >= T.MAX_LOOSE) {
      effect(world, FX.scrap, x, y, victim.slot, kind);
      return;
    }
    // The wagon that was hit flies off the nose; the ones behind it spill to alternate sides of the track.
    let dx: number, dy: number;
    if (k === 0) {
      dx = x - noseX;
      dy = y - noseY;
    } else {
      const distance = wagonDistance(index + k);
      const [ax, ay] = along(victim, distance - T.CRUMB),
        [bx, by] = along(victim, distance + T.CRUMB),
        side = k % 2 === 0 ? 1 : -1;
      dx = -(ay - by) * side;
      dy = (ax - bx) * side;
    }
    const length = isqrt(dx * dx + dy * dy),
      speed = Math.max(T.SCATTER_MIN, T.SCATTER - k * (T.SCATTER >> 3));
    world.carts.push({
      id: world.nextId++,
      kind,
      x: clamp(x, FLOOR.left + T.CART_R, FLOOR.right - T.CART_R),
      y: clamp(y, FLOOR.top + T.CART_R, FLOOR.bottom - T.CART_R),
      vx: length === 0 ? 0 : div(dx * speed, length),
      vy: length === 0 ? 0 : div(dy * speed, length),
      cool: T.CUT_COOL,
    });
  });
  victim.guard = T.CUT_GUARD;
  thief.stolen += kinds.length;
  victim.lost += kinds.length;
  const [x, y] = points[index]!;
  effect(world, FX.cut, x, y, thief.slot, kinds.length, victim.slot);
}

function collect(world: World): void {
  const reach = (T.NOSE_R + T.CART_R) * (T.NOSE_R + T.CART_R);
  const noses = world.trains.map(nose);
  world.carts = world.carts.filter((cart) => {
    if (cart.cool > 0) return true;
    let best = -1,
      nearest = reach;
    world.trains.forEach((train, index) => {
      if (train.cargo.length >= T.MAX_WAGONS) return;
      const [nx, ny] = noses[index]!,
        d = dist2(nx, ny, cart.x, cart.y);
      if (d < nearest) {
        best = index;
        nearest = d;
      }
    });
    if (best < 0) return true;
    const train = world.trains[best]!;
    train.cargo.push(cart.kind);
    train.collected++;
    effect(world, FX.collect, cart.x, cart.y, train.slot, cart.kind);
    return false;
  });
}

function deliver(world: World): void {
  for (const train of world.trains) {
    if (!train.cargo.length) continue;
    const dock = dockAt(train.x, train.y);
    if (dock < 0) continue;
    const count = train.cargo.length;
    train.score = Math.min(T.MAX_SCORE, train.score + count);
    train.deliveries++;
    train.cargo = [];
    effect(world, FX.deliver, train.x, train.y, train.slot, count, dock);
  }
}

/**
 * Places by score, best first; equal scores share a place (two trains on 5 are both second after a 7, and the next
 * is fourth).
 */
export function places(scores: readonly number[]): number[] {
  return scores.map(
    (score) => 1 + scores.filter((other) => other > score).length,
  );
}
