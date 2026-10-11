import { clamp, div } from "./math.js";
import {
  FLOORED,
  decide,
  exposed,
  fighter,
  rest,
  stride,
  walkTo,
  wound,
} from "./ai.js";
import { remount, steedOf } from "./mount.js";
import * as T from "./tuning.js";
import {
  face,
  nearestHero,
  present,
  setState,
  type Enemy,
  type Hero,
  type World,
} from "./world.js";

/**
 * How a lancer fights (design.md, "Enemies": a spear, longer reach, jumps in from the screen edge). It goes for a hero
 * as a ravager does (`decide`: the `ATTACKERS` going for a hero are counted over every kind, and with no place free it
 * hovers), but stands off near the edge of its spear's reach, `LANCE_ENGAGE` from the hero in its lane, backing away
 * from one closer than `LANCE_NEAR` unless the screen's edge stops it. Lined up, it winds up a telegraphed thrust
 * (facing fixed) at a hero on its feet (one lying, it waits for), and the spear lands on the thrust's first step on
 * every hero in a long thin strip in front (`SPEAR_REACH`, `SPEAR_LANE`); it holds the spear out, then stands open. It
 * never feints.
 *
 * It leaps: a wave's lancer jumps in from beyond the screen's edge to its place on screen, and one whose hero is
 * further than `LEAP_FAR` along the road leaps at it, to land `LEAP_LAND` in front of it in its lane. The leap is a
 * hero's jump, carrying no further along the road than the fastest run would; landing, it drives the spear down
 * (`plunge`), knocking down every hero just in front in the lane, and stands over it, open. In the air it is struck as
 * any enemy is once its whole body is on screen, and a blow there knocks it down, as one does a hero. Otherwise it is
 * hit, dazed, grabbed, thrown and spelled down as a ravager is.
 *
 * The lancer captain, Wyrmbone Pass's boss, fights on foot as a lancer does, with his own fighter (`CAPTAIN`) and a
 * harder plunge (`CAPTAIN_PLUNGE`); his armour takes blows as an ogre's does (`brace`: he staggers rather than reels),
 * and a thrown body or a grab does not budge him. Before he decides, a riderless drake within `REMOUNT_X` (`steedOf`)
 * draws him: he walks to it and, beside it, climbs back on (`remount`), once.
 */
export const isLancer = (enemy: Enemy): boolean =>
  enemy.kind === "lancer" || enemy.kind === "captain";

/** One step of a lancer that thinks (`thinks`), in place of a ravager's `act`. */
export function lancerAct(world: World, lancer: Enemy): void {
  const target = world.heroes.find((hero) => hero.id === lancer.target);
  if (lancer.target && !(target && present(target))) lancer.target = 0;
  if (lancer.state === "idle") {
    const towards = target ?? nearestHero(world, lancer);
    if (towards) face(lancer, towards.x);
    // A hero who walks up into its reach is met at once, as a ravager meets one.
    if (
      (world.step >= lancer.thinkAt ||
        (towards &&
          inReach(lancer, towards) &&
          !FLOORED.includes(towards.state))) &&
      !mountUp(world, lancer)
    )
      decide(world, lancer, walk);
  } else if (lancer.state === "walk") walk(world, lancer);
  else if (lancer.state === "stagger") {
    if (lancer.timer >= T.STAGGER_STEPS) rest(world, lancer);
  } else if (lancer.state === "windup") {
    if (lancer.timer >= fighter(lancer).windup) {
      setState(lancer, "thrust");
      strike(world, lancer);
    }
  } else if (lancer.state === "thrust") {
    if (lancer.timer >= T.THRUST_STEPS) setState(lancer, "recover");
  } else if (lancer.state === "plunge") {
    if (lancer.timer >= T.PLUNGE_STEPS) rest(world, lancer);
  } else if (lancer.timer >= T.LANCE_RECOVER) rest(world, lancer);
}

/** A hero within the lancer's thrusting distance along the road and in its lane. */
const inReach = (lancer: Enemy, hero: Hero): boolean =>
  Math.abs(hero.x - lancer.x) <= T.LANCE_ENGAGE + T.LANCE_SLACK &&
  Math.abs(hero.y - lancer.y) <= T.AI_LANE;

/**
 * In reach and no closer than `LANCE_NEAR`, or closer with the lancer where it was going (its goal is set back from the
 * hero, so it is there only when the screen's edge held the goal in).
 */
const lined = (lancer: Enemy, hero: Hero): boolean =>
  inReach(lancer, hero) &&
  (Math.abs(hero.x - lancer.x) >= T.LANCE_NEAR || lancer.x === lancer.goal);

/**
 * A captain going for his steed (`steedOf`), going for no hero: beside it, along the road and in its lane, he climbs on
 * (`remount`); otherwise he walks to it. Returns whether he went for one.
 */
function mountUp(world: World, captain: Enemy): boolean {
  const steed = captain.target ? undefined : steedOf(world, captain);
  if (!steed) return false;
  if (
    Math.abs(steed.x - captain.x) <= T.BOARD_X &&
    Math.abs(steed.y - captain.y) <= T.LANE
  ) {
    remount(world, captain, steed);
    return true;
  }
  walkTo(world, captain, steed.x, steed.y);
  face(captain, steed.x);
  const { walk } = fighter(captain);
  captain.x += clamp(captain.goal - captain.x, -walk.x, walk.x);
  captain.y += clamp(captain.goalY - captain.y, -walk.y, walk.y);
  return true;
}

/**
 * A walking step: a captain going for nobody goes for his steed if he has one (`mountUp`); a hero on its feet further
 * than `LEAP_FAR` along the road is leapt at; otherwise it walks as a ravager does (`stride`), to its side of its hero
 * `LANCE_ENGAGE` away, winding up once `lined` up.
 */
function walk(world: World, lancer: Enemy): void {
  if (mountUp(world, lancer)) return;
  const hero = world.heroes.find((each) => each.id === lancer.target);
  if (
    hero &&
    !FLOORED.includes(hero.state) &&
    Math.abs(hero.x - lancer.x) > T.LEAP_FAR
  )
    return leapAt(world, lancer, hero);
  stride(world, lancer, T.LANCE_ENGAGE, lined);
}

/** Leaps to land `LEAP_LAND` in front of `hero` on its near side, in its lane, on screen. */
function leapAt(world: World, lancer: Enemy, hero: Hero): void {
  const side = lancer.x < hero.x ? -1 : 1;
  walkTo(world, lancer, hero.x + side * T.LEAP_LAND, hero.y);
  face(lancer, hero.x);
  takeOff(lancer);
}

/**
 * Leaps for its goal (`goal`, `goalY`), facing as it does: up at a jump's speed, and along the road at what lands it
 * there after `LEAP_STEPS`, no faster than `LEAP_VX` (a goal further than that is landed short of).
 */
export function takeOff(lancer: Enemy): void {
  setState(lancer, "leap");
  lancer.vx = clamp(
    div(lancer.goal - lancer.x, T.LEAP_STEPS),
    -T.LEAP_VX,
    T.LEAP_VX,
  );
  lancer.vz = T.JUMP_VZ;
}

/**
 * A leap's step, after it has moved along the road: it rises and falls under gravity, steering in depth toward its
 * goal's at `LEAP_VY`, and as it lands drives the spear down (`plunge`).
 */
export function soar(world: World, lancer: Enemy): void {
  lancer.z += lancer.vz;
  lancer.vz -= T.GRAVITY;
  lancer.y += clamp(lancer.goalY - lancer.y, -T.LEAP_VY, T.LEAP_VY);
  if (lancer.z > 0) return;
  lancer.z = lancer.vx = lancer.vz = 0;
  setState(lancer, "plunge");
  strike(world, lancer, true);
}

/** The thrust's spear, or the plunge's (`knock`): it lands on every hero below the mace's sweep that its blow `hits`. */
function strike(world: World, lancer: Enemy, knock = false): void {
  const damage =
    knock && lancer.kind === "captain"
      ? T.CAPTAIN_PLUNGE.damage
      : fighter(lancer).damage;
  for (const hero of world.heroes)
    if (exposed(world, hero) && hero.z < T.MACE_HEIGHT && hits(lancer, hero))
      lancer.stopUntil = wound(world, hero, damage, lancer.facing, knock);
}

/** Where a leaping lancer comes down: the leap's speed carried on for the steps it has left, and its steer in depth. */
export function landing(lancer: Enemy): { x: number; y: number } {
  const left = Math.max(0, T.LEAP_STEPS - lancer.timer),
    steer = left * T.LEAP_VY;
  return {
    x: lancer.x + lancer.vx * left,
    y: lancer.y + clamp(lancer.goalY - lancer.y, -steer, steer),
  };
}

/**
 * Whether the lancer's blow overlaps `hero`'s body, `margin` to spare: the thrust's long thin strip in front, or while it
 * leaps (what a bot steps out of) the plunge's shorter one in front of where it comes down (`landing`).
 */
export function hits(lancer: Enemy, hero: Hero, margin = 0): boolean {
  const leaping = lancer.state === "leap",
    plunge = leaping || lancer.state === "plunge",
    hard = plunge && lancer.kind === "captain",
    reach = hard ? T.CAPTAIN_PLUNGE.reach : plunge ? T.PLUNGE_REACH : T.SPEAR_REACH, // prettier-ignore
    lane = hard ? T.CAPTAIN_PLUNGE.lane : plunge ? T.LANE : T.SPEAR_LANE,
    from = leaping ? landing(lancer) : lancer,
    ahead = (hero.x - from.x) * lancer.facing;
  return (
    ahead + T.HERO_HALF_W >= -margin &&
    ahead - T.HERO_HALF_W <= reach + margin &&
    Math.abs(hero.y - from.y) <= lane + margin
  );
}

/** The depth a lancer's blow coming next lands about: where its leap comes down, or where it stands. */
export const lancerLane = (lancer: Enemy): number =>
  lancer.state === "leap" ? landing(lancer).y : lancer.y;
