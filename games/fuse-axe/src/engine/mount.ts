import { DOWN, LEFT, RIGHT, UP } from "./input.js";
import { clamp, div } from "./math.js";
import { FLOORED, exposed, wound } from "./ai.js";
import { conjure, conjures } from "./magic.js";
import { roll } from "./rng.js";
import { planOf } from "./stages.js";
import * as T from "./tuning.js";
import {
  blowOf,
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
 * the beast with it, and a sweep still winding up is broken off (`flinch`). No enemy climbs back on but the captain.
 *
 * Riderless, a beast panics away from the blow that unseated its rider (`flee`), then wanders back and forth on screen,
 * and after `STRAY_STEPS` with nobody on it walks off the nearer edge of the screen and is gone.
 *
 * A hero standing or walking within `BOARD_X` of a riderless beast on the floor along the road, in its lane, climbs on
 * with Jump in place of jumping (`board`); two heroes boarding one on the same step leave it to the lower id, as heroes
 * move in id order. Riding, it walks at the beast's pace (it does not run); Attack strikes the beast's own blow at the
 * enemies (`BEAST_BLOW`; `step.ts` lands it, never on a hero), Jump hops the beast (carrying the walk it has that step, no steering in the
 * air, as a hero's jump), Down and Jump climbs off, and Magic climbs off to charge or cast where it stands. Light blows
 * the saddle takes, as an enemy's; one that would knock the hero down, and any in a hop, throws it off (`wound`), and
 * the beast panics and wanders until someone else takes it. Bots leave beasts to the players.
 *
 * An ember drake is ridden the same way, but its weapon is its breath (`breathe`): it inhales for `DRAKE_INHALE` steps,
 * then a stream of fire runs out along its facing in its lane (`flameAt`), burning and knocking down every foe it
 * reaches (heroes under an enemy's, enemies under a hero's). An enemy's breathes at its hero lined up in front within the
 * flame's length, walking to stand `DRAKE_STAND` off it otherwise. Wyrmbone Pass's boss, the lancer captain, rides one
 * in, now and then thrusting from the saddle at a hero within his spear's reach (`lance`) where the drake would
 * breathe; his saddle takes every blow that does not break his poise (`step.ts`), and knocked off, he climbs back on a
 * riderless drake once (`remount`).
 */

/** Every kind of enemy that rides a beast: a ravager, and the lancer captain. */
const RIDERS: readonly T.EnemyKind[] = ["ravager", "captain"];

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

/**
 * Whether the blow the beast's pair strikes reaches a body `half` wide at (`x`, `y`), `margin` to spare: the tail either
 * side (`swept`); the breath's flame in front, in its lane, as far as it has run (`flameAt`; its whole length if
 * `whole`); the captain's spear in front, in the blade's lane.
 */
export function reaches(
  mount: Mount,
  x: number,
  y: number,
  half: number,
  margin = 0,
  whole = false,
): boolean {
  if (mount.state === "sweep") return swept(mount, x, y, half, margin);
  const breath = mount.state === "breathe",
    ahead = (x - mount.x) * mount.facing,
    reach = !breath
      ? T.SPEAR_REACH
      : whole
        ? T.BEAST_HALF_W + T.FLAME_LENGTH
        : T.flameAt(mount.timer);
  return (
    (breath || mount.state === "lance") &&
    reach > 0 &&
    ahead + half >= -margin &&
    ahead - half <= reach + margin &&
    Math.abs(y - mount.y) <= (breath ? T.FLAME_LANE : T.LANE) + margin
  );
}

/** What each blow does to a foe it lands on: the damage, the height it reaches under, and whether it knocks down. */
export const HURTS: Readonly<
  Record<T.BeastBlow, { damage: number; height: number; knock: boolean }>
> = {
  sweep: { damage: T.TAIL_DAMAGE, height: T.TAIL_HEIGHT, knock: true },
  breathe: { damage: T.FLAME_DAMAGE, height: T.FLAME_HEIGHT, knock: true },
  lance: { damage: T.CAPTAIN.damage, height: T.MACE_HEIGHT, knock: false },
};

/** Which way along the road a beast's blow knocks a figure at `x`: the tail away from it, the flame and spear onward. */
export const away = (mount: Mount, x: number): 1 | -1 =>
  x === mount.x || mount.state !== "sweep"
    ? mount.facing
    : x > mount.x
      ? 1
      : -1;

/** Whether its blow lands on this step: the tail and the spear once, on their wind-up's last; the flame on each. */
export function striking(mount: Mount): boolean {
  const blow = blowOf(mount);
  return mount.state === "breathe"
    ? mount.timer >= blow!.windup
    : mount.timer === blow?.windup;
}

/**
 * Whether the beast's blow still to land would land on `hero` where it stands, `margin` to spare: the tail or the spear
 * winding up, or the breath while it lasts, the flame's whole length. What a bot steps out of.
 */
export function lashes(mount: Mount, hero: Hero, margin: number): boolean {
  const blow = blowOf(mount),
    end = mount.state === "breathe" ? blow?.steps : blow?.windup;
  return (
    mount.timer < (end ?? 0) &&
    reaches(mount, hero.x, hero.y, T.HERO_HALF_W, margin, true)
  );
}

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
 * A wave's ravager or captain walking in rides a new beast of `kind` (the world's next id) to its goal, unless
 * `MOUNT_MAX` are out. A spawn of any other kind that names a beast walks in on foot: only those two have the state to
 * ride (`ride`), and the checkpoint refuses a world with another kind in it.
 */
export function saddle(world: World, rider: Enemy, kind: T.MountKind): void {
  if (!RIDERS.includes(rider.kind) || world.mounts.length >= T.MOUNT_MAX)
    return;
  const mount = fresh(world, kind, rider.x, rider.y, rider.facing);
  mount.rider = rider.id;
  mount.state = "enter";
  mount.goal = rider.goal;
  world.mounts.push(mount);
  setState(rider, "ride");
}

/**
 * A new world with one more beast of `kind` at (`x`, `y`) in sub-units, held to the road and the floor band: riderless
 * and wandering, facing left, or with enemy `rider` (a ravager or captain on its feet) riding it, standing where it does and
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
    !(
      enemy &&
      RIDERS.includes(enemy.kind) &&
      ["idle", "walk"].includes(enemy.state)
    )
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
  hero.vx = hero.vy = hero.vz = hero.jumpBuf = 0;
}

/**
 * A riding hero's step, its presses read and out of hit-stop: on the floor and not striking, Magic or Down and Jump
 * climbs off (`alight`), Attack strikes the beast's blow (a clawbeak's tail, a drake's breath) once its cool-down has
 * passed since the last, Jump hops, or the beast walks as the directions ask; then it moves, a hop rising and falling
 * under gravity, held to the screen and the floor band, with the hero on it. Returns the beast on a step its blow lands
 * (`striking`), for `step.ts` to strike the enemies it reaches.
 */
export function ride(
  world: World,
  hero: Hero,
  bits: number,
): Mount | undefined {
  const mount = mountOf(world, hero.id)!,
    blow = blowOf(mount);
  mount.timer++;
  if (blow) {
    if (mount.timer >= blow.steps) rest(world, mount);
  } else if (mount.state !== "hop") {
    if (conjures(world, hero) || (hero.jumpBuf > 0 && bits & DOWN)) {
      alight(world, hero, mount, bits);
      return undefined;
    }
    if (hero.attackBuf > 0 && world.step >= mount.coolUntil) {
      setState(mount, T.BEAST_BLOW[mount.kind]);
      mount.vx = mount.vy = hero.attackBuf = 0;
      hero.struck = [];
    } else if (hero.jumpBuf > 0) {
      trot(mount, bits);
      setState(mount, "hop");
      mount.vz = T.JUMP_VZ;
      hero.jumpBuf = 0;
    } else trot(mount, bits);
  }
  mount.x = heroOnScreen(world, mount.x + mount.vx);
  mount.y = clamp(mount.y + mount.vy, T.FLOOR_TOP, T.FLOOR_BOTTOM);
  fall(mount);
  carry(mount, hero);
  return striking(mount) ? mount : undefined;
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

/**
 * A blow over, or a walk in: the beast stands, and strikes again no sooner than the blow's cool-down (after a walk in,
 * its own blow's).
 */
function rest(world: World, mount: Mount): void {
  const blow = blowOf(mount) ?? T.BEAST_BLOWS[T.BEAST_BLOW[mount.kind]];
  setState(mount, "idle");
  mount.coolUntil = world.step + blow.cool;
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
 * An enemy's beast's step: walking in to its goal, it stands; striking, its blow lands on every hero exposed to it
 * (`lash`) and the blow ends standing; otherwise, once open no longer, it strikes at its hero on its feet in reach
 * (`aim`), waits by one lying, or walks to stand off it in its lane (`TAIL_STAND`, a drake `DRAKE_STAND`).
 */
function prowl(world: World, mount: Mount, rider: Enemy): void {
  if (mount.state === "enter") {
    mount.x += clamp(mount.goal - mount.x, -T.ENTER_WALK, T.ENTER_WALK);
    if (mount.x === mount.goal) rest(world, mount);
    return;
  }
  const blow = blowOf(mount);
  if (blow) {
    if (striking(mount)) lash(world, mount);
    if (mount.timer >= blow.steps) rest(world, mount);
    return;
  }
  const hero =
    world.heroes.find((each) => each.id === rider.target && present(each)) ??
    nearestHero(world, rider);
  rider.target = hero?.id ?? 0;
  if (hero) face(mount, hero.x);
  if (!hero || world.step < mount.coolUntil) return setState(mount, "idle");
  const next = aim(world, mount, rider, hero);
  if (next)
    return setState(mount, FLOORED.includes(hero.state) ? "idle" : next);
  const stand = mount.kind === "drake" ? T.DRAKE_STAND : T.TAIL_STAND,
    side = mount.x < hero.x ? -1 : 1,
    x = onScreen(world, hero.x + side * stand);
  mount.x += clamp(x - mount.x, -T.BEAST_WALK.x, T.BEAST_WALK.x);
  mount.y += clamp(hero.y - mount.y, -T.BEAST_WALK.y, T.BEAST_WALK.y);
  setState(mount, "walk");
}

/**
 * The blow an enemy's beast strikes at its hero now, if any: a clawbeak's tail at one in its reach; at one lined up in
 * front (in `AI_LANE`) within the flame's length, a drake's breath, or now and then (`LANCE_CHANCE` in 256, drawn from
 * the world's stream) the captain's spear from its saddle at one within `SPEAR_REACH`.
 */
function aim(
  world: World,
  mount: Mount,
  rider: Enemy,
  hero: Hero,
): T.BeastBlow | undefined {
  if (mount.kind === "clawbeak")
    return swept(mount, hero.x, hero.y, T.HERO_HALF_W) ? "sweep" : undefined;
  const ahead = (hero.x - mount.x) * mount.facing - T.HERO_HALF_W;
  if (
    Math.abs(hero.y - mount.y) > T.AI_LANE ||
    ahead > T.BEAST_HALF_W + T.FLAME_LENGTH
  )
    return undefined;
  return rider.kind === "captain" &&
    ahead <= T.SPEAR_REACH &&
    !FLOORED.includes(hero.state) &&
    roll(world, 256) < T.LANCE_CHANCE
    ? "lance"
    : "breathe";
}

/**
 * An enemy's beast's blow lands on every hero exposed to it that it reaches (`reaches`) and under its height (`HURTS`):
 * the tail knocks each down away from the beast, the flame along its facing, and the spear thrusts that way. One riding
 * is thrown off its own by a blow that knocks down. The flame burns a hero once a breath, as one it knocks down is not
 * exposed again (flying, lying and getting up) before the breath is over.
 */
function lash(world: World, mount: Mount): void {
  const hurt = HURTS[mount.state as T.BeastBlow];
  for (const hero of world.heroes)
    if (
      exposed(world, hero) &&
      hero.z < hurt.height &&
      reaches(mount, hero.x, hero.y, T.HERO_HALF_W)
    )
      wound(world, hero, hurt.damage, away(mount, hero.x), hurt.knock);
}

/**
 * The riderless drake a lancer captain on foot who has yet to climb back on goes for: the first in id order on the floor,
 * not leaving, within `REMOUNT_X` of him along the road.
 */
export const steedOf = (world: World, captain: Enemy): Mount | undefined =>
  captain.kind !== "captain" || captain.remounted
    ? undefined
    : world.mounts.find(
        (each) =>
          each.kind === "drake" &&
          each.rider === 0 &&
          each.z === 0 &&
          each.state !== "leave" &&
          Math.abs(each.x - captain.x) <= T.REMOUNT_X,
      );

/** The captain beside his steed (`steedOf`) climbs back on, standing where it does: once a fight. */
export function remount(world: World, captain: Enemy, mount: Mount): void {
  mount.rider = captain.id;
  setState(mount, "idle");
  captain.remounted = true;
  captain.vx = captain.vz = captain.target = 0;
  setState(captain, "ride");
  carry(mount, captain);
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
