import { clamp, div } from "./math.js";
import { DOWN, INPUT_MASK, JUMP, LEFT, RIGHT, UP, pressed } from "./input.js";
import * as T from "./tuning.js";
import type { Hero, HeroState, World } from "./world.js";

/**
 * One 1/60 s step, as a pure function: the input world is left untouched. The order is part of the rules: every
 * hero in id order reads its seat's held bits, walks, jumps or falls and is held to the floor band and the screen;
 * then the camera follows. `held` holds each seat's bits by seat index; a missing seat holds nothing.
 */
export function step(world: World, held: readonly number[]): World {
  const next: World = {
    ...world,
    step: world.step + 1,
    heroes: world.heroes.map((hero) => ({ ...hero })),
  };
  for (const hero of next.heroes)
    moveHero(next, hero, (held[hero.seat] ?? 0) & INPUT_MASK);
  advanceCamera(next);
  return next;
}

/**
 * One 50 ms log tick of `STEPS_PER_TICK` steps, as Choppers folds them: the first step takes `first` (by seat, the
 * last bits logged this tick together with every tap logged during it, so a tap shorter than a tick still
 * presses) and the others take `held` (the last bits logged).
 */
export function stepTick(
  world: World,
  held: readonly number[],
  first: readonly number[] = held,
): World {
  let next = world;
  for (let index = 0; index < T.STEPS_PER_TICK; index++)
    next = step(next, index === 0 ? first : held);
  return next;
}

function setState(hero: Hero, state: HeroState): void {
  if (hero.state === state) return;
  hero.state = state;
  hero.timer = 0;
}

/** The walk the held directions ask for; opposite directions cancel and a diagonal is no faster than straight. */
function walk(hero: Hero, bits: number): void {
  const dx = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0),
    dy = (bits & DOWN ? 1 : 0) - (bits & UP ? 1 : 0),
    speed = T.WALK[hero.kind],
    scale = dx !== 0 && dy !== 0 ? T.DIAGONAL : 256;
  hero.vx = dx * div(speed.x * scale, 256);
  hero.vy = dy * div(speed.y * scale, 256);
  if (dx !== 0) hero.facing = dx > 0 ? 1 : -1;
}

function moveHero(world: World, hero: Hero, bits: number): void {
  const presses = pressed(bits, hero.held);
  hero.held = bits;
  hero.timer++;
  if (hero.state === "land" && hero.timer >= T.LAND_STEPS)
    setState(hero, "idle");
  if (hero.state === "idle" || hero.state === "walk") {
    walk(hero, bits);
    if (presses & JUMP) {
      setState(hero, "jump");
      hero.vz = T.JUMP_VZ;
    } else setState(hero, hero.vx !== 0 || hero.vy !== 0 ? "walk" : "idle");
  }
  // A jump keeps the momentum it launched with: no steering in the air, as in the original.
  hero.x += hero.vx;
  hero.y += hero.vy;
  if (hero.state === "jump") {
    hero.z += hero.vz;
    hero.vz -= T.GRAVITY;
    if (hero.z <= 0) {
      hero.z = hero.vx = hero.vy = hero.vz = 0;
      setState(hero, "land");
    }
  }
  hero.x = clamp(
    hero.x,
    world.camX + T.HERO_MARGIN,
    world.camX + T.VIEW_W * T.SUB - T.HERO_MARGIN,
  );
  hero.y = clamp(hero.y, T.FLOOR_TOP, T.FLOOR_BOTTOM);
}

/**
 * The camera only moves forward: it keeps the leading hero `CAMERA_LEAD` from its left edge, but never past the
 * leftmost hero (who therefore holds it) and never past the stage's end. With no heroes it stays put.
 */
function advanceCamera(world: World): void {
  if (world.heroes.length === 0) return;
  let leader = -Infinity,
    leftmost = Infinity;
  for (const hero of world.heroes) {
    if (hero.x > leader) leader = hero.x;
    if (hero.x < leftmost) leftmost = hero.x;
  }
  const target = Math.min(
    leader - T.CAMERA_LEAD,
    leftmost - T.HERO_MARGIN,
    T.CAMERA_END,
  );
  if (target > world.camX) world.camX = target;
}
