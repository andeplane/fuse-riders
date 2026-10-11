import { clamp } from "./math.js";
import { FLOORED, exposed, wound } from "./ai.js";
import { planOf } from "./stages.js";
import * as T from "./tuning.js";
import {
  face,
  mountOf,
  nearestHero,
  present,
  setState,
  type Enemy,
  type Hero,
  type Mount,
  type World,
} from "./world.js";

/**
 * Beasts to ride (design.md, "Enemies": enemies ride beasts in later stages; knock a rider off and anyone can climb on).
 * A clawbeak takes no blow: blades, thrown bodies and spells land on its rider, never on it. Its rider stands where it
 * does, on its floor (the view lifts the rider into the saddle, `SADDLE`), and its weapon is the beast's: the tail
 * sweep, wound up for `TAIL_WINDUP` steps, then landing on every hero within `TAIL_REACH` either side and `TAIL_LANE` in
 * depth, knocking it down.
 *
 * A wave's ravager may walk in riding one (`Spawn.mount`), and the beast fights for the pair: it goes for the rider's
 * hero (the nearest on the field otherwise, whatever the `ATTACKERS` going for it), walks to stand `TAIL_STAND` off it
 * in its lane, and sweeps once the hero, on its feet, is in the tail's reach, then stands open for `TAIL_COOL`. A blow
 * that knocks down knocks the rider off (`launch`); a lighter one the saddle takes: the rider flashes and holds still,
 * the beast with it, and a sweep still winding up is broken off (`flinch`). No enemy climbs back on.
 *
 * Riderless, a beast panics away from the blow that unseated its rider (`flee`), then wanders back and forth on screen,
 * and after `STRAY_STEPS` with nobody on it walks off the nearer edge of the screen and is gone. Heroes climbing on it
 * come next.
 */

/** Whether the tail reaches a body `half` wide at (`x`, `y`), `margin` to spare: either side of the beast, in its lane. */
export const swept = (
  mount: Mount,
  x: number,
  y: number,
  half: number,
  margin = 0,
): boolean =>
  Math.abs(x - mount.x) - half <= T.TAIL_REACH + margin &&
  Math.abs(y - mount.y) <= T.TAIL_LANE + margin;

/** Whether the tail still winding up would land on `hero` where it stands, `margin` to spare: what a bot steps out of. */
export const lashes = (mount: Mount, hero: Hero, margin: number): boolean =>
  mount.state === "sweep" &&
  mount.timer < T.TAIL_WINDUP &&
  swept(mount, hero.x, hero.y, T.HERO_HALF_W, margin);

/** Holds `x` on screen, half a beast in from its edges. */
const onScreen = (world: World, x: number): number =>
  clamp(
    x,
    world.camX + T.BEAST_HALF_W,
    world.camX + T.VIEW_W * T.SUB - T.BEAST_HALF_W,
  );

const fresh = (
  world: World,
  kind: T.MountKind,
  x: number,
  y: number,
  facing: 1 | -1,
): Mount => ({
  ...{ id: world.nextId++, kind, x, y, z: 0, facing, state: "wander" },
  ...{ timer: 0, rider: 0, goal: clamp(x, 0, planOf(world).length) },
  coolUntil: 0,
});

/** A wave's enemy walking in rides a new beast of `kind` (the world's next id) to its goal, unless `MOUNT_MAX` are out. */
export function saddle(world: World, rider: Enemy, kind: T.MountKind): void {
  if (world.mounts.length >= T.MOUNT_MAX) return;
  const mount = fresh(world, kind, rider.x, rider.y, rider.facing);
  mount.rider = rider.id;
  mount.state = "enter";
  mount.goal = rider.goal;
  world.mounts.push(mount);
  setState(rider, "ride");
}

/**
 * A new world with one more beast of `kind` at (`x`, `y`) in sub-units, held to the road and the floor band: riderless
 * and wandering, facing left, or with enemy `rider` (a ravager on its feet) riding it, standing where it does and
 * facing its way. It takes the world's next id; the world passed in is left untouched. Throws on an unknown kind, a
 * position that is not whole, an enemy that cannot ride and a world already holding `MOUNT_MAX`.
 */
export function spawnMount(
  world: World,
  x: number,
  y: number,
  rider = 0,
  kind: T.MountKind = "clawbeak",
): World {
  const enemy = world.enemies.find((each) => each.id === rider);
  if (!T.MOUNT_KINDS.includes(kind))
    throw new RangeError(`fuse-axe: unknown mount ${kind}`);
  if (!Number.isInteger(x) || !Number.isInteger(y))
    throw new RangeError(`fuse-axe: mount position ${x},${y} is not whole`);
  if (world.mounts.length >= T.MOUNT_MAX)
    throw new RangeError(`fuse-axe: already ${T.MOUNT_MAX} mounts`);
  if (
    rider &&
    !(enemy?.kind === "ravager" && ["idle", "walk"].includes(enemy.state))
  )
    throw new RangeError(`fuse-axe: enemy ${rider} cannot ride`);
  const next = { ...world };
  const at = {
    x: clamp(x, 0, planOf(world).length),
    y: clamp(y, T.FLOOR_TOP, T.FLOOR_BOTTOM),
  };
  const mount = fresh(next, kind, at.x, at.y, enemy?.facing ?? -1);
  next.mounts = [...world.mounts, mount];
  if (!enemy) return next;
  mount.rider = rider;
  mount.state = "idle";
  next.enemies = world.enemies.map((each) =>
    each === enemy
      ? { ...each, ...at, z: 0, vx: 0, vz: 0, state: "ride", timer: 0 }
      : each,
  );
  return next;
}

/** A sweep over, or broken off: the beast stands, and sweeps again no sooner than `TAIL_COOL`. */
function rest(world: World, mount: Mount): void {
  setState(mount, "idle");
  mount.coolUntil = world.step + T.TAIL_COOL;
}

/** A blow the saddle takes (its rider stays on): the beast's tail still winding up is broken off. */
export function flinch(world: World, rider: Enemy): void {
  const mount = mountOf(world, rider.id)!;
  if (mount.state === "sweep" && mount.timer < T.TAIL_WINDUP)
    rest(world, mount);
}

/**
 * The beasts' step, after the enemies have moved (and, as they are, held while a spell's blow is coming): one with a
 * rider walks in or fights for it (`prowl`), holding still while its rider does in hit-stop, and carries it; a riderless
 * one panics, wanders or leaves (`roam`), and one that has left the screen is gone.
 */
export function advanceMounts(world: World): void {
  for (const mount of world.mounts) {
    const rider = world.enemies.find((each) => each.id === mount.rider);
    if (rider && world.step <= rider.stopUntil) continue;
    mount.timer++;
    if (!rider) roam(world, mount);
    else {
      prowl(world, mount, rider);
      rider.x = mount.x;
      rider.y = mount.y;
      rider.facing = mount.facing;
    }
  }
  world.mounts = world.mounts.filter(
    (each) =>
      each.state !== "leave" ||
      (each.x >= world.camX - T.ENTER_OUT - T.BEAST_HALF_W &&
        each.x <= world.camX + T.VIEW_W * T.SUB + T.ENTER_OUT + T.BEAST_HALF_W),
  );
}

/**
 * A ridden beast's step: walking in to its goal, it stands; sweeping, its tail lands on every hero exposed to it and
 * low enough, knocking each down away from it, and the sweep ends standing; otherwise, once open no longer, it sweeps
 * at its hero on its feet in the tail's reach, waits by one lying, or walks to stand `TAIL_STAND` off it in its lane.
 */
function prowl(world: World, mount: Mount, rider: Enemy): void {
  if (mount.state === "enter") {
    mount.x += clamp(mount.goal - mount.x, -T.ENTER_WALK, T.ENTER_WALK);
    if (mount.x === mount.goal) rest(world, mount);
    return;
  }
  if (mount.state === "sweep") {
    if (mount.timer === T.TAIL_WINDUP) lash(world, mount);
    if (mount.timer >= T.TAIL_STEPS) rest(world, mount);
    return;
  }
  const hero =
    world.heroes.find((each) => each.id === rider.target && present(each)) ??
    nearestHero(world, rider);
  rider.target = hero?.id ?? 0;
  if (hero) face(mount, hero.x);
  if (!hero || world.step < mount.coolUntil) return setState(mount, "idle");
  if (swept(mount, hero.x, hero.y, T.HERO_HALF_W))
    return setState(mount, FLOORED.includes(hero.state) ? "idle" : "sweep");
  const side = mount.x < hero.x ? -1 : 1,
    x = onScreen(world, hero.x + side * T.TAIL_STAND);
  mount.x += clamp(x - mount.x, -T.BEAST_WALK.x, T.BEAST_WALK.x);
  mount.y += clamp(hero.y - mount.y, -T.BEAST_WALK.y, T.BEAST_WALK.y);
  setState(mount, "walk");
}

/** The tail lands on every hero exposed to it in its sweep and under `TAIL_HEIGHT`, knocked down away from the beast. */
function lash(world: World, mount: Mount): void {
  for (const hero of world.heroes)
    if (
      exposed(world, hero) &&
      hero.z < T.TAIL_HEIGHT &&
      swept(mount, hero.x, hero.y, T.HERO_HALF_W)
    ) {
      const dir = hero.x === mount.x ? mount.facing : hero.x > mount.x ? 1 : -1;
      wound(world, hero, T.TAIL_DAMAGE, dir, true);
    }
}

/**
 * A riderless beast's step: panicking, it runs the way it faces, then wanders, turning every `WANDER_TURN` steps, on
 * screen; after `STRAY_STEPS` of that it walks off the nearer edge.
 */
function roam(world: World, mount: Mount): void {
  if (mount.state === "flee") {
    mount.x += mount.facing * T.PANIC_RUN;
    if (mount.timer >= T.PANIC_STEPS) setState(mount, "wander");
  } else if (mount.state === "wander") {
    if (mount.timer % T.WANDER_TURN === 0)
      mount.facing = mount.facing > 0 ? -1 : 1;
    mount.x += mount.facing * T.WANDER;
    if (mount.timer >= T.STRAY_STEPS) {
      setState(mount, "leave");
      mount.facing = 2 * (mount.x - world.camX) < T.VIEW_W * T.SUB ? -1 : 1;
    }
  } else mount.x += mount.facing * T.BEAST_WALK.x;
  if (mount.state !== "leave") mount.x = onScreen(world, mount.x);
}
