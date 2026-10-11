import { clamp } from "./math.js";
import { planOf, type Side } from "./stages.js";
import * as T from "./tuning.js";
import {
  inView,
  newEnemy,
  setState,
  spark,
  type Enemy,
  type EnemyState,
  type Hero,
  type HeroState,
  type World,
} from "./world.js";

/**
 * Sack imps and the magic pots they drop. An imp is no fighter: it never attacks, holds no wave's screen and thinks
 * nothing (`ai.ts` never runs it). Sent by the stage's cues (`planOf(world).imps`) as the camera reaches them, it
 * appears just outside the screen's edge and scurries across the floor, zig-zagging in depth. Every hero blow that
 * lands on it (and a thrown body) kicks one pot out of its sack onto the floor: it stumbles, or from a blow that
 * knocks down it flies, lies and gets up, then flees away from the blow, faster. Stumbling, flying, lying, getting up
 * or with an empty sack it cannot be kicked; it leaves the world once it is more than `ENTER_OUT` outside the screen.
 * A kick counts for nothing in a hero's tallies.
 *
 * A pot pops out of the sack and lands, then lies `ITEM_LIFE` steps, blinking at the end. A hero on its feet on the
 * floor, not reeling, knocked down, lying or getting up, picks up a landed pot it walks over while it holds fewer
 * than its kind's `MAX_POTS`; items go in id order, each to the first such hero in id order, so two heroes on one
 * pot on the same step leave it to the lower id.
 */
export const isImp = (enemy: Enemy): boolean => enemy.kind === "imp";

/** An imp a blow lands on: scurrying or fleeing with a pot left, its whole body on screen. */
export const kickable = (world: World, imp: Enemy): boolean =>
  (imp.state === "walk" || imp.state === "flee") &&
  imp.pots > 0 &&
  inView(world, imp);

/** A pot pops out of the sack at (`x`, `y`) on the road; the oldest item makes way past `ITEM_MAX`. */
function drop(world: World, x: number, y: number): void {
  world.items.push({
    id: world.nextId++,
    kind: "pot",
    x: clamp(x, 0, planOf(world).length),
    y,
    z: T.POT_LIFT,
    vz: T.POT_POP,
    born: world.step,
  });
  if (world.items.length > T.ITEM_MAX) world.items.shift();
}

/**
 * A blow lands on an imp from direction `dir` (along the road, +1 from the left): one pot drops, and the imp turns
 * to the blow and stumbles back, or from a `heavy` one flies; both hold still for the hit-stop.
 */
export function kick(
  world: World,
  imp: Enemy,
  dir: 1 | -1,
  heavy: boolean,
): void {
  imp.pots--;
  drop(world, imp.x, imp.y);
  imp.facing = dir > 0 ? -1 : 1;
  imp.state = heavy ? "knockdown" : "stumble";
  imp.timer = 0;
  imp.vx = dir * (heavy ? T.KNOCK_VX : T.HURT_PUSH);
  imp.vz = heavy ? T.KNOCK_VZ : 0;
  imp.stopUntil = world.step + (heavy ? T.HEAVY_HITSTOP : T.HITSTOP);
  spark(
    world,
    heavy ? "heavy" : "hit",
    imp.x - dir * T.ENEMY_HALF_W,
    imp.y,
    imp.z + T.IMP_SPARK,
  );
}

/** How long each of an imp's timed states lasts, and what follows it. */
const AFTER: Partial<Record<EnemyState, readonly [number, EnemyState]>> = {
  stumble: [T.IMP_STUMBLE_STEPS, "flee"],
  down: [T.IMP_DOWN_STEPS, "getup"],
  getup: [T.GETUP_STEPS, "flee"],
};

/**
 * An imp's step once `step.ts` has moved it by its own speed and flown or slowed it: its timed state runs out, a
 * kicked one turning to flee away from the blow it faces; a scurrying one zig-zags on its way and a fleeing one runs.
 */
export function scurry(imp: Enemy): void {
  const after = AFTER[imp.state];
  if (after && imp.timer >= after[0]) {
    if (after[1] === "flee") imp.facing = imp.facing > 0 ? -1 : 1;
    setState(imp, after[1]);
  }
  if (imp.state === "walk") {
    imp.x += imp.facing * T.IMP_WALK;
    imp.y += (Math.floor(imp.timer / T.IMP_ZIG) % 2 ? -1 : 1) * T.IMP_ZIG_Y;
  } else if (imp.state === "flee") imp.x += imp.facing * T.IMP_FLEE;
  imp.y = clamp(imp.y, T.FLOOR_TOP, T.FLOOR_BOTTOM);
}

/** An imp that has left: more than `ENTER_OUT` outside the screen on either side. */
export const gone = (world: World, enemy: Enemy): boolean =>
  isImp(enemy) &&
  (enemy.x < world.camX - T.ENTER_OUT ||
    enemy.x > world.camX + T.VIEW_W * T.SUB + T.ENTER_OUT);

/** An imp appears `ENTER_OUT` outside the screen's edge on `side`, at depth `y`, and scurries in with `pots`. */
function enter(world: World, side: Side, y: number, pots: number): void {
  const left = side === "left",
    x = left
      ? world.camX - T.ENTER_OUT
      : world.camX + T.VIEW_W * T.SUB + T.ENTER_OUT;
  const imp = newEnemy(world, "imp", 0, x, y, left ? 1 : -1);
  imp.pots = pots;
  world.enemies.push(imp);
}

/**
 * A new world with an imp sent in from `side` at depth `y` (held to the floor band) with `pots` in its sack, as a
 * cue sends one; the world passed in is left untouched. It throws on a sack the checkpoint would refuse, and on a
 * world already holding `ENEMY_MAX`.
 */
export function sendImp(
  world: World,
  side: Side,
  y: number,
  pots: number = T.IMP_POTS,
): World {
  if (!Number.isInteger(pots) || pots < 1 || pots > T.IMP_POTS)
    throw new RangeError(`fuse-axe: an imp with ${pots} pots`);
  if (world.enemies.length >= T.ENEMY_MAX)
    throw new RangeError(`fuse-axe: already ${T.ENEMY_MAX} enemies`);
  const next = { ...world, enemies: [...world.enemies] };
  enter(next, side, clamp(Math.trunc(y), T.FLOOR_TOP, T.FLOOR_BOTTOM), pots);
  return next;
}

/** Every cue the camera has reached sends its imp, in order; the next waits while the world holds `ENEMY_MAX`. */
export function advanceImps(world: World): void {
  const { imps } = planOf(world);
  for (
    let cue = imps[world.impsSent];
    cue && cue.at <= world.camX && world.enemies.length < T.ENEMY_MAX;
    cue = imps[++world.impsSent]
  )
    enter(world, cue.side, cue.y, cue.pots);
}

/** The states a hero cannot pick anything up in: reeling, knocked down, lying, getting up, fallen or away. */
const BUSY: readonly HeroState[] = [
  "hurt",
  "knockdown",
  "down",
  "getup",
  "dead",
  "respawn",
  "out",
];
const picks = (hero: Hero, item: World["items"][number]): boolean =>
  hero.z === 0 &&
  !BUSY.includes(hero.state) &&
  hero.pots < T.MAX_POTS[hero.kind] &&
  Math.abs(hero.x - item.x) <= T.PICKUP_X &&
  Math.abs(hero.y - item.y) <= T.PICKUP_Y;

/** The items' step: the old vanish, a popping one rises or falls and lands, and a landed one may be picked up. */
export function advanceItems(world: World): void {
  world.items = world.items.filter((item) => {
    if (world.step - item.born >= T.ITEM_LIFE) return false;
    if (item.z > 0) {
      item.z += item.vz;
      item.vz -= T.GRAVITY;
      if (item.z <= 0) item.z = item.vz = 0;
      return true;
    }
    const hero = world.heroes.find((each) => picks(each, item));
    if (hero) hero.pots++;
    return !hero;
  });
}
