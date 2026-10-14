import { SUB, clamp, div, isqrt, px } from "./math.js";
import { hash } from "./rng.js";
import * as T from "./tuning.js";
import { CAMERA_END, EXIT_X, sawY, segmentsNear, span } from "./level.js";
import { DOWN, FIRE, LEFT, RIGHT, UP } from "./input.js";
import { shooting } from "./settings.js";
import { flying, played } from "./step.js";
import type { Chopper, World } from "./world.js";

/**
 * The AI pilot. It reads the world as any player could, looking a little way ahead for the open corridor nearest
 * its height, and answers with ordinary held bits once per log tick: it gets no physics of its own. A jitter from
 * the seed keeps two bots from flying one line.
 */
export function botInput(world: World, chopper: Chopper): number {
  if (!flying(chopper)) return 0;
  const speed = Math.max(px(0.8), world.scroll + chopper.vx),
    look = (dx: number, threats: 0 | 1 | 2) =>
      openings(
        world,
        chopper,
        chopper.x + px(dx),
        clamp(div(px(dx), speed), 2, 90),
        threats,
      );
  // Here, every threat; further on, the rock and the rivals (a rock in flight is judged where it will meet it).
  const near = look(16, 2),
    middle = look(52, 1),
    far = look(100, 1);
  const jitter =
    ((hash(world.seed, chopper.slot, div(world.step, 45)) % 41) - 20) * SUB;
  // Each seat keeps its own lane inside a wide corridor, so five bots do not fly one line into each other.
  // The lanes rotate with the seed, so no seat keeps the middle one.
  const lane = (((chopper.slot + world.seed) % 5) - 2) * px(24);
  // The corridor it is in now, and where that corridor continues: the aim may not leave it, so a bot below a
  // floating rock passes under it rather than climbing into it.
  const home = around(near, chopper.y);
  // The gap between solid things it is in, rivals and rocks left out: an escape from a rival never goes through rock.
  const shelter = around(look(16, 0), chopper.y);
  const next = home ? overlapping(middle, home, chopper.y) : undefined;
  let target = lanes(far, pick(far, chopper.y), lane + jitter);

  let bits = 0;
  // Horizontal: stay clear of the crush zone, chase a pickup ahead, race for the gate at the end.
  let goalX = Math.max(
    world.crushX + px(260) + chopper.slot * px(50),
    world.camX + px(300) + chopper.slot * px(40),
  );
  const finale = world.camX >= (CAMERA_END - 260) * SUB;
  if (finale) goalX = EXIT_X * SUB + px(100);
  else {
    const prize = world.pickups.find(
      (pickup) =>
        pickup.x > chopper.x - px(30) &&
        pickup.x < chopper.x + px(280) &&
        inside(far, pickup.y),
    );
    if (prize) {
      goalX = prize.x;
      target = prize.y;
    }
  }
  for (const corridor of [next, home])
    if (corridor) target = clamp(target, corridor[0], corridor[1]);
  if (!home) {
    target = pick(near, chopper.y);
    if (shelter) target = clamp(target, shelter[0], shelter[1]);
  }
  // In a tight squeeze, or with its height blocked ahead, it holds its airspeed rather than racing into the rock;
  // blocked close ahead, it backs off while the crush zone leaves room.
  const tight = !home || home[1] - home[0] < px(56),
    ahead = look(52, 0),
    blocked = !inside(ahead, chopper.y) || !inside(look(100, 0), chopper.y);
  if (goalX - chopper.x > px(24) && !tight && !blocked) bits |= RIGHT;
  else if (
    goalX - chopper.x < -px(24) ||
    (!inside(ahead, chopper.y) && chopper.x - world.crushX > px(180))
  )
    bits |= LEFT;

  // Vertical: a climb or sink rate proportional to the error, never faster than it can stop before the rock
  // (v² = 2ad), and lift whenever it is falling faster than that.
  // Escaping (a rock's path or a rival covers its height): brake against the cave itself, not the blocked gap.
  const cave = span(
      world.seed,
      chopper.x - T.CHOPPER_HW,
      chopper.x + T.CHOPPER_HW + px(40),
    ),
    error = target - chopper.y,
    room: Span = home ??
      shelter ?? [
        cave.ceiling + T.CHOPPER_HH + px(8),
        cave.floor - T.CHOPPER_HH - px(8),
      ],
    below = Math.max(0, Math.min(room[1], next?.[1] ?? room[1]) - chopper.y),
    above = Math.max(0, chopper.y - Math.max(room[0], next?.[0] ?? room[0]));
  if (world.lift === "classic") {
    const brakeDown = div(isqrt(2 * (T.LIFT - T.GRAVITY) * below) * 4, 5),
      brakeUp = div(isqrt(2 * T.GRAVITY * above) * 4, 5);
    const want = clamp(
      div(error, 14),
      -Math.min(div(T.MAX_RISE * 4, 5), brakeUp),
      Math.min(div(T.MAX_FALL * 3, 5), brakeDown),
    );
    if (chopper.vy > want) bits |= UP;
  } else {
    const brake = (d: number) => div(isqrt(2 * T.THRUST * d) * 4, 5);
    const want = clamp(
      div(error, 12),
      -Math.min(T.THRUST_MAX, brake(above)),
      Math.min(T.THRUST_MAX, brake(below)),
    );
    if (chopper.vy > want + px(0.4)) bits |= UP;
    else if (chopper.vy < want - px(0.4)) bits |= DOWN;
  }

  // A trigger finger that rests now and then, and none in the first seconds of play.
  if (
    shooting(world.combat) &&
    played(world) > 180 &&
    hash(world.seed, chopper.slot, div(world.step, 40), 3) % 100 < 45 &&
    inLine(world, chopper)
  )
    bits |= FIRE;
  return bits;
}

type Span = [top: number, bottom: number];

/**
 * The open heights at world x, `steps` from now: cave, floating rock and saws subtracted; from `threats` 1 the rivals
 * nearby too, and from 2 the thrown rocks, whose whole sweep from here to the chopper is blocked.
 */
function openings(
  world: World,
  chopper: Chopper,
  x: number,
  steps: number,
  threats: 0 | 1 | 2,
): Span[] {
  const hw = T.CHOPPER_HW,
    hh = T.CHOPPER_HH,
    margin = px(14);
  const cave = span(world.seed, x - hw, x + hw);
  let open: Span[] = [[cave.ceiling + hh + margin, cave.floor - hh - margin]];
  const block = (top: number, bottom: number) => {
    open = open.flatMap(([a, b]): Span[] => {
      if (bottom <= a || top >= b) return [[a, b]];
      return [
        ...(top > a ? [[a, top] as Span] : []),
        ...(bottom < b ? [[bottom, b] as Span] : []),
      ];
    });
  };
  for (const part of segmentsNear(
    world.seed,
    div(x - hw, SUB),
    div(x + hw, SUB) + 1,
  )) {
    for (const platform of part.platforms)
      if (x + hw > platform.x * SUB && x - hw < (platform.x + platform.w) * SUB)
        block(
          platform.y * SUB - hh - margin,
          (platform.y + platform.h) * SUB + hh + margin,
        );
    for (const saw of part.saws)
      if (Math.abs(x - saw.x * SUB) < (saw.r + 30) * SUB) {
        const y = sawY(saw, world.step + steps) * SUB,
          reach = saw.r * SUB + hh + px(18);
        block(y - reach, y + reach);
      }
  }
  const result = () => open.filter(([a, b]) => b - a > px(4));
  if (threats === 0) return result();
  for (const other of world.choppers)
    if (other !== chopper && flying(other) && Math.abs(other.x - x) < px(56))
      block(other.y - px(44), other.y + px(44));
  if (threats === 1) return result();
  // A warned throw, as a player reads the dashed line: keep off its height while it is close to launching.
  for (const warning of world.warnings)
    if (warning.at - world.step < 45 && chopper.x - world.crushX < px(420))
      block(warning.y - px(52), warning.y + px(52));
  // A rock in flight: every height it passes through between now and reaching the chopper, so an escape never
  // climbs into its path.
  const closingOf = (rock: (typeof world.rocks)[number]) =>
    Math.max(px(0.5), rock.vx - (world.scroll + chopper.vx));
  for (const rock of world.rocks) {
    if (rock.x > chopper.x + T.CHOPPER_HW) continue;
    const t = div(chopper.x - rock.x, closingOf(rock));
    if (t > 80) continue;
    const later = rock.y + rock.vy * t + div(T.ROCK_GRAVITY * t * t, 2),
      reach = rock.r + hh + px(16);
    block(Math.min(rock.y, later) - reach, Math.max(rock.y, later) + reach);
  }
  return result();
}

/** `aim` moved by `offset`, kept inside the opening that holds `aim`. */
function lanes(open: Span[], aim: number, offset: number): number {
  const home = open.find(([a, b]) => aim >= a && aim <= b);
  if (!home) return aim;
  const [a, b] = home;
  return b - a < px(60) ? aim : clamp(aim + offset, a + px(12), b - px(12));
}

const inside = (open: Span[], y: number) =>
  open.some(([a, b]) => y >= a && y <= b);

/** The opening that holds `y`, if one does. */
const around = (open: Span[], y: number): Span | undefined =>
  open.find(([a, b]) => y >= a && y <= b);

/** Where `home` continues in `open`: the overlapping opening nearest `y`, or none. */
function overlapping(open: Span[], home: Span, y: number): Span | undefined {
  let best: Span | undefined,
    score = Infinity;
  for (const [a, b] of open) {
    if (b <= home[0] || a >= home[1]) continue;
    const cost = Math.abs(clamp(y, a, b) - y);
    if (cost < score) {
      score = cost;
      best = [a, b];
    }
  }
  return best;
}

/** The height to steer for: `y` itself if it is open, else the nearest open height, wider gaps preferred. */
function pick(open: Span[], y: number): number {
  let best = y,
    score = Infinity;
  for (const [a, b] of open) {
    const mid = (a + b) >> 1,
      aim = clamp(y, a + div(b - a, 4), b - div(b - a, 4)),
      cost = Math.abs(aim - y) - div(b - a, 3) + (b - a < px(40) ? px(200) : 0);
    if (cost < score) {
      score = cost;
      best = b - a < px(40) ? mid : aim;
    }
  }
  return best;
}

/** A rival or a drone ahead, level with the gun. */
function inLine(world: World, chopper: Chopper): boolean {
  const ahead = (x: number, y: number, range: number) => {
    const dx = (x - chopper.x) * chopper.face;
    return dx > px(20) && dx < range && Math.abs(y - chopper.y) < px(26);
  };
  return (
    world.choppers.some(
      (other) =>
        other !== chopper && flying(other) && ahead(other.x, other.y, px(420)),
    ) || world.drones.some((drone) => ahead(drone.x, drone.y, px(520)))
  );
}
