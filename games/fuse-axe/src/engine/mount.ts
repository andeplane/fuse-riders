import { DOWN, LEFT, RIGHT, UP } from "./input.js";
import { clamp, div } from "./math.js";
import { FLOORED, exposed, wound } from "./ai.js";
import { conjure, conjures } from "./magic.js";
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
 * does, at its height (the view lifts the rider into the saddle, `SADDLE`), and its weapon is the beast's: the tail
 * sweep, wound up for `TAIL_WINDUP` steps, then landing on every foe within `TAIL_REACH` either side and `TAIL_LANE` in
 * depth, knocking it down.
 *
 * A wave's ravager may walk in riding one (`Spawn.mount`), and the beast fights for the pair: it goes for the rider's
 * hero (the nearest on the field otherwise, whatever the `ATTACKERS` going for it), walks to stand `TAIL_STAND` off it
 * in its lane, and sweeps once the hero, on its feet, is in the tail's reach, then stands open for `TAIL_COOL`. A blow
 * that knocks down knocks the rider off (`launch`); a lighter one the saddle takes: the rider flashes and holds still,
 * the beast with it, and a sweep still winding up is broken off (`flinch`). No enemy climbs back on.
 *
 * Riderless, a beast panics away from the blow that unseated its rider (`flee`), then wanders back and forth on screen,
 * and after `STRAY_STEPS` with nobody on it walks off the nearer edge of the screen and is gone.
 *
 * A hero standing or walking within `BOARD_X` of a riderless beast on the floor along the road, in its lane, climbs on
 * with Jump in place of jumping (`board`); two heroes boarding one on the same step leave it to the lower id, as heroes
 * move in id order. Riding, it walks at the beast's pace (it does not run); Attack sweeps the tail at the enemies around
 * (`step.ts` lands it, never on a hero), Jump hops the beast (no steering in the air, as a hero's jump), Down and Jump
 * climbs off, and Magic climbs off to charge or cast where it stands. Light blows the saddle takes, as an enemy's; one
 * that would knock the hero down, and any in a hop, throws it off (`wound`), and the beast panics and wanders until
 * someone else takes it. Bots leave beasts to the players.
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

/** Which way along the road the tail knocks a figure at `x`: away from the beast. */
export const away = (mount: Mount, x: number): 1 | -1 =>
  x === mount.x ? mount.facing : x > mount.x ? 1 : -1;

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

/** Holds `x` on screen as a hero is, `HERO_MARGIN` in from its edges. */
const heroOnScreen = (world: World, x: number): number =>
  clamp(
    x,
    world.camX + T.HERO_MARGIN,
    world.camX + T.VIEW_W * T.SUB - T.HERO_MARGIN,
  );

/** The rider stands where its beast does, at its height, facing its way. */
function carry(mount: Mount, rider: Hero | Enemy): void {
  rider.x = mount.x;
  rider.y = mount.y;
  rider.z = mount.z;
  rider.facing = mount.facing;
}

const fresh = (
  world: World,
  kind: T.MountKind,
  x: number,
  y: number,
  facing: 1 | -1,
): Mount => ({
  ...{ id: world.nextId++, kind, x, y, z: 0, vx: 0, vy: 0, vz: 0, facing },
  ...{ state: "wander", timer: 0, rider: 0 },
  ...{ goal: clamp(x, 0, planOf(world).length), coolUntil: 0 },
});

/**
 * A wave's ravager walking in rides a new beast of `kind` (the world's next id) to its goal, unless `MOUNT_MAX` are out.
 * A spawn of any other kind that names a beast walks in on foot: only a ravager has the state to ride (`ride`), and the
 * checkpoint refuses a world with another kind in it.
 */
export function saddle(world: World, rider: Enemy, kind: T.MountKind): void {
  if (rider.kind !== "ravager" || world.mounts.length >= T.MOUNT_MAX) return;
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

/**
 * A free hero's Jump beside a riderless beast on the floor (within `BOARD_X` along the road, in its lane): it climbs
 * on, the first such beast in id order, standing where the beast does (held to the screen as the hero is). Returns
 * whether it did, or the Jump is a jump.
 */
export function board(world: World, hero: Hero): boolean {
  const mount = world.mounts.find(
    (each) =>
      each.rider === 0 &&
      each.z === 0 &&
      Math.abs(each.x - hero.x) <= T.BOARD_X &&
      Math.abs(each.y - hero.y) <= T.LANE,
  );
  if (!mount) return false;
  mount.rider = hero.id;
  setState(mount, "idle");
  mount.x = heroOnScreen(world, mount.x);
  hero.vx = hero.vy = hero.jumpBuf = 0;
  setState(hero, "ride");
  carry(mount, hero);
  return true;
}

/** The walk the held directions ask of a hero's beast, as a hero's own walk; opposite directions cancel. */
function trot(mount: Mount, bits: number): void {
  const dx = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0),
    dy = (bits & DOWN ? 1 : 0) - (bits & UP ? 1 : 0),
    scale = dx !== 0 && dy !== 0 ? T.DIAGONAL : 256;
  mount.vx = dx * div(T.BEAST_WALK.x * scale, 256);
  mount.vy = dy * div(T.BEAST_WALK.y * scale, 256);
  if (dx !== 0) mount.facing = dx > 0 ? 1 : -1;
  setState(mount, mount.vx !== 0 || mount.vy !== 0 ? "walk" : "idle");
}

/**
 * A riding hero climbs off where its beast stands, which wanders off riderless: to charge or cast its Magic there, or
 * with Down and Jump dropping from the saddle.
 */
function alight(world: World, hero: Hero, mount: Mount, bits: number): void {
  mount.rider = mount.vx = mount.vy = 0;
  setState(mount, "wander");
  if (conjures(world, hero)) return conjure(world, hero, bits);
  setState(hero, "jump");
  hero.z = T.SADDLE;
  hero.vz = hero.jumpBuf = 0;
}

/**
 * A riding hero's step, its presses read and out of hit-stop: on the floor and not sweeping, Magic or Down and Jump
 * climbs off (`alight`), Attack sweeps the tail once `TAIL_COOL` has passed since the last, Jump hops, or the beast walks
 * as the directions ask; then it moves, a hop rising and falling under gravity, held to the screen and the floor band,
 * with the hero on it. Returns the beast on the step its tail lands, for `step.ts` to strike the enemies around.
 */
export function ride(
  world: World,
  hero: Hero,
  bits: number,
): Mount | undefined {
  const mount = mountOf(world, hero.id)!;
  mount.timer++;
  if (mount.state === "sweep") {
    if (mount.timer >= T.TAIL_STEPS) rest(world, mount);
  } else if (mount.state !== "hop") {
    if (conjures(world, hero) || (hero.jumpBuf > 0 && bits & DOWN)) {
      alight(world, hero, mount, bits);
      return undefined;
    }
    if (hero.attackBuf > 0 && world.step >= mount.coolUntil) {
      setState(mount, "sweep");
      mount.vx = mount.vy = hero.attackBuf = 0;
      hero.struck = [];
    } else if (hero.jumpBuf > 0) {
      setState(mount, "hop");
      mount.vz = T.JUMP_VZ;
      hero.jumpBuf = 0;
    } else trot(mount, bits);
  }
  mount.x = heroOnScreen(world, mount.x + mount.vx);
  mount.y = clamp(mount.y + mount.vy, T.FLOOR_TOP, T.FLOOR_BOTTOM);
  fall(mount);
  carry(mount, hero);
  return mount.state === "sweep" && mount.timer === T.TAIL_WINDUP
    ? mount
    : undefined;
}

/** A beast off the floor rises and falls under gravity, landing still: a hop stands. */
function fall(mount: Mount): void {
  if (mount.z === 0 && mount.state !== "hop") return;
  mount.z += mount.vz;
  mount.vz -= T.GRAVITY;
  if (mount.z > 0) return;
  mount.z = mount.vx = mount.vy = mount.vz = 0;
  if (mount.state === "hop") setState(mount, "idle");
}

/** A sweep over, or broken off: the beast stands, and sweeps again no sooner than `TAIL_COOL`. */
function rest(world: World, mount: Mount): void {
  setState(mount, "idle");
  mount.coolUntil = world.step + T.TAIL_COOL;
}

/**
 * The beasts no hero rides (a hero's moves with it, `ride`), after the enemies have moved (and, as they are, held while
 * a spell's blow is coming): an enemy's walks in or fights for its rider (`prowl`), holding still while its rider does
 * in hit-stop, and carries it; a riderless one panics, wanders or leaves (`roam`), and one that has left the screen is
 * gone.
 */
export function advanceMounts(world: World): void {
  for (const mount of world.mounts) {
    if (world.heroes.some((hero) => hero.id === mount.rider)) continue;
    const rider = world.enemies.find((each) => each.id === mount.rider);
    if (rider && world.step <= rider.stopUntil) continue;
    mount.timer++;
    if (!rider) roam(world, mount);
    else {
      prowl(world, mount, rider);
      carry(mount, rider);
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
 * An enemy's beast's step: walking in to its goal, it stands; sweeping, its tail lands on every hero exposed to it and
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

/**
 * An enemy's beast's tail lands on every hero exposed to it in its sweep and under `TAIL_HEIGHT`, knocked down away from
 * the beast: one riding is thrown off its own.
 */
function lash(world: World, mount: Mount): void {
  for (const hero of world.heroes)
    if (
      exposed(world, hero) &&
      hero.z < T.TAIL_HEIGHT &&
      swept(mount, hero.x, hero.y, T.HERO_HALF_W)
    )
      wound(world, hero, T.TAIL_DAMAGE, away(mount, hero.x), true);
}

/**
 * A riderless beast's step: one thrown out of a hop comes down; panicking, it runs the way it faces, then wanders,
 * turning every `WANDER_TURN` steps, on screen; after `STRAY_STEPS` of that it walks off the nearer edge.
 */
function roam(world: World, mount: Mount): void {
  fall(mount);
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
