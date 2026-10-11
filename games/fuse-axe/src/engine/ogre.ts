import { clamp } from "./math.js";
import { FLOORED, exposed, fighter, rest, walkTo, wound } from "./ai.js";
import * as T from "./tuning.js";
import {
  face,
  present,
  setState,
  type Enemy,
  type Hero,
  type World,
} from "./world.js";

/**
 * How an ogre fights (design.md, "Enemies": the Ogre twins, Stage 1's boss). It is slow and goes for the nearest hero
 * in the fight (one its twin is on counts further), walking to stand `OGRE_ENGAGE` from it; lined up, it winds up a
 * long, telegraphed overhead slam (facing fixed) at a hero on its feet (one lying, it waits for), and the hammer lands
 * on its first step on every hero in a wide area
 * in front, then sends a shockwave on along the floor in its depth lane, which a hero steps out of or jumps. A hero
 * close behind it as it decides or walks draws a round sweep of the hammer instead. Every blow of its knocks down, and
 * after each it stands open for `OGRE_RECOVER` steps. Once its twin has fallen it is enraged (`enrage`): it winds up,
 * decides and walks faster.
 *
 * Its super armour (`brace`): a blade's blow takes its hit points and flashes it, but neither nudges nor holds it; a
 * heavy one (the finisher, the dash, the back attack, the jump attack) staggers it briefly while it stands or walks,
 * though not once it has begun a blow or while it recovers. Only a heavy blow once it has taken a `POISE`th of its full
 * hit points since it last fell knocks it down (`breaks`), or the blow that leaves it none, or a spell. It cannot be
 * grabbed (`THROWABLE`), a thrown body does not knock it over, and a spell takes no more than `BOSS_SHARE` of it.
 */
export const isOgre = (enemy: Enemy): boolean => enemy.kind === "ogre";

/** One step of an ogre that thinks (`thinks`), in place of a ravager's `act`. */
export function ogreAct(world: World, ogre: Enemy): void {
  const target = world.heroes.find((hero) => hero.id === ogre.target);
  if (ogre.target && !(target && present(target))) ogre.target = 0;
  if (ogre.state === "idle") {
    const towards = target ?? nearest(world, ogre);
    // A hero who walks up into its lane in front is met at once, as a ravager meets one.
    if (
      world.step >= ogre.thinkAt ||
      (towards && lined(ogre, towards) && !FLOORED.includes(towards.state))
    )
      decide(world, ogre);
    else if (towards) face(ogre, towards.x);
  } else if (ogre.state === "walk") stride(world, ogre);
  else if (ogre.state === "windup") {
    if (ogre.timer >= fighter(ogre).windup) {
      setState(ogre, "slam");
      slam(world, ogre);
    }
  } else if (ogre.state === "slam") {
    quake(world, ogre);
    if (ogre.timer >= T.SLAM_STEPS) setState(ogre, "recover");
  } else if (ogre.state === "sweep") {
    if (ogre.timer === T.SWEEP_WINDUP) sweep(world, ogre);
    if (ogre.timer >= T.SWEEP_STEPS) setState(ogre, "recover");
  } else if (ogre.state === "stagger") {
    if (ogre.timer >= T.STAGGER_STEPS) decide(world, ogre);
  } else if (ogre.timer >= T.OGRE_RECOVER) rest(world, ogre);
}

/** The hero in the fight nearest the ogre, one another living ogre goes for counting `HOVER_X` further. */
function nearest(world: World, ogre: Enemy): Hero | undefined {
  let best: Hero | undefined,
    score = Infinity;
  for (const hero of world.heroes) {
    if (!present(hero)) continue;
    const taken = world.enemies.some(
      (other) =>
        other !== ogre &&
        isOgre(other) &&
        other.hp > 0 &&
        other.target === hero.id,
    );
    const each =
      Math.abs(hero.x - ogre.x) +
      Math.abs(hero.y - ogre.y) +
      (taken ? T.HOVER_X : 0);
    if (each < score) {
      best = hero;
      score = each;
    }
  }
  return best;
}

/** A hero in front of the ogre within its stand-off along the road, and in its lane. */
const lined = (ogre: Enemy, hero: Hero): boolean => {
  const ahead = (hero.x - ogre.x) * ogre.facing;
  return (
    ahead >= 0 &&
    ahead <= T.OGRE_ENGAGE + T.OGRE_SLACK &&
    Math.abs(hero.y - ogre.y) <= T.OGRE_LANE
  );
};

/** A hero on its feet close behind the ogre, in reach of its sweep. */
const behind = (ogre: Enemy, hero: Hero): boolean => {
  const back = (ogre.x - hero.x) * ogre.facing;
  return (
    present(hero) &&
    !FLOORED.includes(hero.state) &&
    back > 0 &&
    back - T.HERO_HALF_W <= T.BEHIND &&
    Math.abs(hero.y - ogre.y) <= T.SWEEP_LANE
  );
};

/** Sweeps at a hero behind it, or goes for the nearest hero (`nearest`), or with none stands. */
function decide(world: World, ogre: Enemy): void {
  if (world.heroes.some((hero) => behind(ogre, hero)))
    return setState(ogre, "sweep");
  const pick = nearest(world, ogre);
  if (!pick) return rest(world, ogre);
  ogre.target = pick.id;
  setState(ogre, "walk");
  stride(world, ogre);
}

/**
 * A walking step: a hero behind draws the sweep; otherwise it heads for its own side of its hero, `OGRE_ENGAGE` away
 * and in its lane, at its mood's walk, and winds up once lined up with the hero on its feet (lying, it waits).
 */
function stride(world: World, ogre: Enemy): void {
  if (world.heroes.some((hero) => behind(ogre, hero)))
    return setState(ogre, "sweep");
  const hero = world.heroes.find((each) => each.id === ogre.target);
  if (!hero) return rest(world, ogre);
  const side = ogre.x < hero.x ? -1 : 1;
  walkTo(world, ogre, hero.x + side * T.OGRE_ENGAGE, hero.y);
  face(ogre, hero.x);
  if (lined(ogre, hero))
    return FLOORED.includes(hero.state)
      ? rest(world, ogre)
      : setState(ogre, "windup");
  const { walk } = fighter(ogre);
  ogre.x += clamp(ogre.goal - ogre.x, -walk.x, walk.x);
  ogre.y += clamp(ogre.goalY - ogre.y, -walk.y, walk.y);
}

/** The hammer lands on every hero it reaches in front, within `SLAM_LANE` either side in depth and below it. */
function slam(world: World, ogre: Enemy): void {
  const { damage } = fighter(ogre);
  for (const hero of world.heroes) {
    const ahead = (hero.x - ogre.x) * ogre.facing;
    if (
      exposed(world, hero) &&
      ahead + T.HERO_HALF_W >= 0 &&
      ahead - T.HERO_HALF_W <= T.SLAM_REACH &&
      Math.abs(hero.y - ogre.y) <= T.SLAM_LANE &&
      hero.z < T.SLAM_HEIGHT
    )
      ogre.stopUntil = wound(world, hero, damage, ogre.facing, true);
  }
}

/** How far in front of a slamming ogre its shockwave has run, `timer` steps into the slam. */
export const quakeAt = (timer: number): number =>
  T.SLAM_REACH + T.QUAKE_SPEED * timer;
/** The shockwave runs while the slam is under `QUAKE_STEPS` old, and the slam's first step is the hammer's. */
export const quaking = (ogre: Enemy): boolean =>
  ogre.state === "slam" && ogre.timer >= 1 && ogre.timer <= T.QUAKE_STEPS;

/** The shockwave's step: it knocks down every hero on the floor it passes over in the ogre's lane. */
function quake(world: World, ogre: Enemy): void {
  if (!quaking(ogre)) return;
  const from = quakeAt(ogre.timer - 1),
    to = quakeAt(ogre.timer);
  for (const hero of world.heroes) {
    const ahead = (hero.x - ogre.x) * ogre.facing;
    if (
      exposed(world, hero) &&
      hero.z === 0 &&
      ahead + T.HERO_HALF_W >= from &&
      ahead - T.HERO_HALF_W <= to &&
      Math.abs(hero.y - ogre.y) <= T.LANE
    )
      wound(world, hero, T.QUAKE_DAMAGE, ogre.facing, true);
  }
}

/** The sweep lands on every hero within `SWEEP_REACH` either side and `SWEEP_LANE` in depth, knocked away from it. */
function sweep(world: World, ogre: Enemy): void {
  for (const hero of world.heroes) {
    const dx = hero.x - ogre.x;
    if (
      exposed(world, hero) &&
      Math.abs(dx) - T.HERO_HALF_W <= T.SWEEP_REACH &&
      Math.abs(hero.y - ogre.y) <= T.SWEEP_LANE &&
      hero.z < T.SLAM_HEIGHT
    ) {
      const dir = dx === 0 ? ogre.facing : dx > 0 ? 1 : -1;
      ogre.stopUntil = wound(world, hero, T.SWEEP_DAMAGE, dir, true);
    }
  }
}

/**
 * Whether the ogre's blow coming next would land on `hero` where it stands, `margin` to spare: the slam it winds up
 * (the hammer, or its shockwave), the shockwave still to pass the hero, or the sweep it winds up. What a bot dodges.
 */
export function threatens(ogre: Enemy, hero: Hero, margin: number): boolean {
  const ahead = (hero.x - ogre.x) * ogre.facing,
    dy = Math.abs(hero.y - ogre.y),
    end = quakeAt(T.QUAKE_STEPS);
  if (ogre.state === "windup")
    return (
      ahead + T.HERO_HALF_W >= -margin &&
      ((dy <= T.SLAM_LANE + margin &&
        ahead - T.HERO_HALF_W <= T.SLAM_REACH + margin) ||
        (dy <= T.LANE + margin && ahead - T.HERO_HALF_W <= end))
    );
  if (ogre.state === "slam")
    return (
      ogre.timer < T.QUAKE_STEPS &&
      dy <= T.LANE + margin &&
      ahead + T.HERO_HALF_W >= quakeAt(ogre.timer) - margin &&
      ahead - T.HERO_HALF_W <= end
    );
  return (
    ogre.state === "sweep" &&
    ogre.timer < T.SWEEP_WINDUP &&
    Math.abs(hero.x - ogre.x) - T.HERO_HALF_W <= T.SWEEP_REACH + margin &&
    dy <= T.SWEEP_LANE + margin
  );
}

/** The depth either side of the ogre its blow coming next lands in: what a bot steps out of. */
export const threatLane = (ogre: Enemy): number =>
  ogre.state === "windup"
    ? T.SLAM_LANE
    : ogre.state === "sweep"
      ? T.SWEEP_LANE
      : T.LANE;

/** Whether a heavy blow (or any) taking `taken` knocks the ogre down: it leaves none, or breaks its poise. */
export const breaks = (
  world: World,
  ogre: Enemy,
  taken: number,
  heavy: boolean,
): boolean =>
  ogre.hp === taken ||
  (heavy &&
    (ogre.poise + taken) * T.POISE >=
      T.enemyMaxHp(ogre.kind, ogre.tier, world.heroes.length));

/**
 * A blow the ogre's armour takes (`breaks` said it stands), its hit points already taken: it counts toward its poise
 * and flashes it, and a heavy one staggers it while it stands or walks, facing the blow and holding still for the
 * hit-stop.
 */
export function brace(
  world: World,
  ogre: Enemy,
  taken: number,
  heavy: boolean,
  dir: 1 | -1,
): void {
  ogre.poise += taken;
  ogre.flashUntil = world.step + T.HITSTOP;
  if (!heavy || (ogre.state !== "idle" && ogre.state !== "walk")) return;
  setState(ogre, "stagger");
  ogre.facing = dir > 0 ? -1 : 1;
  ogre.stopUntil = world.step + T.HITSTOP;
}

/** Once an ogre falls (its hit points gone), every ogre left is enraged, for good: its twin has fallen. */
export function enrage(world: World): void {
  if (world.enemies.some((each) => isOgre(each) && each.hp === 0))
    for (const each of world.enemies)
      if (isOgre(each) && each.hp > 0) each.enraged = true;
}
