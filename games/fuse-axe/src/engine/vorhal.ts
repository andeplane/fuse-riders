import { clamp, div } from "./math.js";
import { FLOORED, exposed, fighter, rest, walkTo, wound } from "./ai.js";
import { isBonewalker, rise } from "./bonewalker.js";
import { roll } from "./rng.js";
import { planOf, type Grave } from "./stages.js";
import * as T from "./tuning.js";
import {
  face,
  faceNearest,
  nearestHero,
  newEnemy,
  present,
  setState,
  spark,
  type Enemy,
  type Hero,
  type Sigil,
  type World,
} from "./world.js";

/**
 * How Vorhal fights (design.md, "Enemies": the final boss, a horned dark knight with a greatsword, a fire spell and
 * summoned bonewalkers). Each time he decides (his pause and a random part, as an ogre's), he picks a move by a draw
 * from the world's stream (`VORHAL_MOVES`): the fire spell, while none of its sigils is left (`mark`); the summons,
 * while fewer than `SUMMON_CAP` bonewalkers stand and a slab on screen is free (`summon`); else the greatsword, walking
 * to stand `VORHAL_ENGAGE` from the nearest hero and, lined up with it on its feet, winding up two cuts (facing fixed)
 * that land on every hero in front in a wide lane, the second knocking down (`cut`), after which he stands open. Unlike
 * an ogre he keeps his pause, so every move leaves an opening. With his back to the screen's edge and a hero close in
 * front (`cornered`), he may leap over to the far side instead (`vault`).
 *
 * At half his hit points, once on his feet, he roars (`ROAR_STEPS`, nothing landing on him: no blade, beast or spell)
 * and fights on enraged, his second phase: he winds up and decides faster, marks one sigil more and summons more often,
 * rust bonewalkers. His armour is a boss's (`brace` and `breaks` in `ogre.ts`, `BOSS_SHARE` of a spell), nobody throws
 * him and a thrown body does not topple him. When he falls, his bonewalkers crumble and his sigils go out (`vanquish`).
 */
export const isVorhal = (enemy: Enemy): boolean => enemy.kind === "vorhal";

const fullHp = (world: World, enemy: Enemy): number =>
  T.enemyMaxHp(enemy.kind, enemy.tier, world.heroes.length);

/** One step of Vorhal thinking (`thinks`), in place of a ravager's `act`. */
export function vorhalAct(world: World, vorhal: Enemy): void {
  const target = world.heroes.find((hero) => hero.id === vorhal.target);
  if (vorhal.target && !(target && present(target))) vorhal.target = 0;
  if (!vorhal.enraged && 2 * vorhal.hp <= fullHp(world, vorhal)) {
    vorhal.enraged = true;
    vorhal.target = 0;
    return setState(vorhal, "roar");
  }
  const { windup, damage } = fighter(vorhal);
  const after = (steps: number) => vorhal.timer >= steps;
  switch (vorhal.state) {
    case "idle": {
      if (world.step >= vorhal.thinkAt) return decide(world, vorhal);
      const towards = target ?? nearestHero(world, vorhal);
      if (towards) face(vorhal, towards.x);
      return;
    }
    case "walk":
      return stride(world, vorhal);
    case "windup":
      if (after(windup)) cut(world, vorhal, "cut1", damage, false);
      return;
    case "cut1":
      if (after(T.CUT_GAP))
        cut(world, vorhal, "cut2", damage + T.CUT2_DAMAGE, true);
      return;
    case "cut2":
      if (after(T.CUT_STEPS)) setState(vorhal, "recover");
      return;
    case "cast":
      if (vorhal.timer === T.CAST_MARK) mark(world, vorhal);
      else if (after(T.CAST_STEPS)) rest(world, vorhal);
      return;
    case "summon":
      if (vorhal.timer === T.SUMMON_AT) summon(world, vorhal);
      else if (after(T.SUMMON_STEPS)) rest(world, vorhal);
      return;
    case "roar":
      if (after(T.ROAR_STEPS)) rest(world, vorhal);
      return;
    case "stagger":
      if (after(T.STAGGER_STEPS)) rest(world, vorhal);
      return;
    default:
      if (after(T.VORHAL_RECOVER)) rest(world, vorhal);
  }
}

/** A hero in front of him within his stand-off along the road, and in his lane. */
const lined = (vorhal: Enemy, hero: Hero): boolean => {
  const ahead = (hero.x - vorhal.x) * vorhal.facing;
  return (
    ahead >= 0 &&
    ahead <= T.VORHAL_ENGAGE + T.VORHAL_SLACK &&
    Math.abs(hero.y - vorhal.y) <= T.VORHAL_LANE
  );
};

/**
 * Leaps when cornered, or picks a move (`VORHAL_MOVES`), or with no hero on the field stands. A draw in the spell's
 * range while its sigils are still lit (the decision after a cast always is) falls through to the summons test, so
 * the summons then come `cast + summon` in 256 and not `summon`, as the cast's range goes to them, not the greatsword.
 */
function decide(world: World, vorhal: Enemy): void {
  const pick = nearestHero(world, vorhal);
  if (!pick) return rest(world, vorhal);
  face(vorhal, pick.x);
  if (cornered(world, vorhal) && roll(world, 256) < T.VAULT_CHANCE)
    return vault(world, vorhal);
  const odds = T.VORHAL_MOVES[vorhal.enraged ? "rage" : "calm"],
    draw = roll(world, 256);
  if (draw < odds.cast && world.sigils.length === 0)
    return setState(vorhal, "cast");
  if (draw < odds.cast + odds.summon && summons(world))
    return setState(vorhal, "summon");
  vorhal.target = pick.id;
  setState(vorhal, "walk");
  stride(world, vorhal);
}

/**
 * A walking step: he heads for his side of his hero, `VORHAL_ENGAGE` away and in its lane, and winds up once lined up
 * with it on its feet (lying, he waits). A hero he has chased for `VORHAL_CHASE` steps he gives up on, to decide again.
 */
function stride(world: World, vorhal: Enemy): void {
  const hero = world.heroes.find((each) => each.id === vorhal.target);
  if (!hero || vorhal.timer > T.VORHAL_CHASE) return rest(world, vorhal);
  const side = vorhal.x < hero.x ? -1 : 1;
  walkTo(world, vorhal, hero.x + side * T.VORHAL_ENGAGE, hero.y);
  face(vorhal, hero.x);
  if (lined(vorhal, hero))
    return FLOORED.includes(hero.state)
      ? rest(world, vorhal)
      : setState(vorhal, "windup");
  const { walk } = fighter(vorhal);
  vorhal.x += clamp(vorhal.goal - vorhal.x, -walk.x, walk.x);
  vorhal.y += clamp(vorhal.goalY - vorhal.y, -walk.y, walk.y);
}

/** Whether a cut lands on `hero`'s body, `margin` to spare: in front of him within `CUT_REACH`, in `CUT_LANE`. */
export function slashes(vorhal: Enemy, hero: Hero, margin = 0): boolean {
  const ahead = (hero.x - vorhal.x) * vorhal.facing;
  return (
    ahead + T.HERO_HALF_W >= -margin &&
    ahead - T.HERO_HALF_W <= T.CUT_REACH + margin &&
    Math.abs(hero.y - vorhal.y) <= T.CUT_LANE + margin
  );
}

/** A cut (`state`) lands on its first step on every hero it `slashes` under `CUT_HEIGHT`, once a cut. */
function cut(
  world: World,
  vorhal: Enemy,
  state: "cut1" | "cut2",
  damage: number,
  knock: boolean,
): void {
  setState(vorhal, state);
  for (const hero of world.heroes)
    if (exposed(world, hero) && hero.z < T.CUT_HEIGHT && slashes(vorhal, hero))
      vorhal.stopUntil = wound(world, hero, damage, vorhal.facing, knock);
}

/** Whether the greatsword's cut coming next would land on `hero` where it stands, `margin` to spare: what a bot dodges. */
export const threatensCut = (
  vorhal: Enemy,
  hero: Hero,
  margin: number,
): boolean =>
  (vorhal.state === "windup" || vorhal.state === "cut1") &&
  hero.z < T.CUT_HEIGHT &&
  slashes(vorhal, hero, margin);

/** With his back within `CORNER_X` of the screen's edge, a hero on its feet within `CORNER_NEAR` in front of him. */
function cornered(world: World, vorhal: Enemy): boolean {
  const fromLeft = vorhal.x - world.camX,
    fromRight = world.camX + T.VIEW_W * T.SUB - vorhal.x,
    inward = fromLeft < fromRight ? 1 : -1;
  return (
    Math.min(fromLeft, fromRight) <= T.CORNER_X &&
    world.heroes.some((hero) => {
      const ahead = (hero.x - vorhal.x) * inward;
      return (
        present(hero) &&
        !FLOORED.includes(hero.state) &&
        ahead >= 0 &&
        ahead <= T.CORNER_NEAR
      );
    })
  );
}

/** He leaps for `VAULT_INSET` inside the far edge of the screen, in his lane: up at `VAULT_VZ`, over `VAULT_STEPS`. */
function vault(world: World, vorhal: Enemy): void {
  const left = 2 * (vorhal.x - world.camX) < T.VIEW_W * T.SUB;
  vorhal.goal = clamp(
    left
      ? world.camX + T.VIEW_W * T.SUB - T.VAULT_INSET
      : world.camX + T.VAULT_INSET,
    0,
    planOf(world).length,
  );
  vorhal.goalY = vorhal.y;
  vorhal.target = 0;
  face(vorhal, vorhal.goal);
  setState(vorhal, "leap");
  vorhal.vx = div(vorhal.goal - vorhal.x, T.VAULT_STEPS);
  vorhal.vz = T.VAULT_VZ;
}

/** A leap's step, after he has moved along the road: he rises and falls under gravity, and lands facing the party. */
export function vaultStep(world: World, vorhal: Enemy): void {
  vorhal.z += vorhal.vz;
  vorhal.vz -= T.GRAVITY;
  if (vorhal.z > 0) return;
  vorhal.z = vorhal.vx = vorhal.vz = 0;
  faceNearest(world, vorhal);
  rest(world, vorhal);
}

/**
 * The fire spell's mark: a sigil under each hero on its feet, up to the count (`SIGILS`, one more enraged, and one more
 * by chance), going round the heroes in id order from one drawn at random (or the first seats would take every pillar
 * of a big party), and the rest on the floor on screen at random. Each is on the road and in the floor band.
 */
function mark(world: World, vorhal: Enemy): void {
  const count = Math.min(
    T.SIGIL_MAX,
    T.SIGILS + (vorhal.enraged ? 1 : 0) + roll(world, 2),
  );
  const at = (x: number, y: number): Sigil => ({ x, y, timer: 0 }),
    party = world.heroes.length,
    from = roll(world, party);
  for (let k = 0; k < party; k++) {
    const hero = world.heroes[(from + k) % party]!;
    if (
      world.sigils.length < count &&
      present(hero) &&
      !FLOORED.includes(hero.state)
    )
      world.sigils.push(at(hero.x, hero.y));
  }
  const edge = T.px(24);
  while (world.sigils.length < count)
    world.sigils.push(
      at(
        world.camX + edge + roll(world, T.VIEW_W * T.SUB - 2 * edge),
        T.FLOOR_TOP + roll(world, T.FLOOR_BOTTOM - T.FLOOR_TOP),
      ),
    );
}

/** Whether a pillar of fire rising from `sigil` reaches `hero`'s body, `margin` to spare. */
export const pillars = (sigil: Sigil, hero: Hero, margin = 0): boolean =>
  Math.abs(hero.x - sigil.x) - T.HERO_HALF_W <= T.PILLAR_HALF + margin &&
  Math.abs(hero.y - sigil.y) <= T.PILLAR_LANE + margin;

/**
 * The sigils' step: each ages, its pillar burning every hero it reaches from `SIGIL_DELAY` on (each is knocked down,
 * so burned once), and one past `SIGIL_LIFE` is gone. A spell's freeze holds them with the enemies.
 */
export function advanceSigils(world: World): void {
  world.sigils = world.sigils.filter((sigil) => {
    sigil.timer++;
    if (sigil.timer >= T.SIGIL_LIFE) return false;
    if (sigil.timer >= T.SIGIL_DELAY)
      for (const hero of world.heroes)
        if (exposed(world, hero) && pillars(sigil, hero))
          wound(world, hero, T.PILLAR_DAMAGE, hero.x < sigil.x ? -1 : 1, true);
    return true;
  });
}

/** Bonewalkers standing (a bone pile too, which pulls itself together). */
const standing = (world: World): number =>
  world.enemies.filter(
    (each) => isBonewalker(each) && (each.hp > 0 || each.state === "pile"),
  ).length;

/** The stage's slabs on screen, a body in from its edges, that no bonewalker is clawing out of. */
function freeSlabs(world: World): Grave[] {
  const view = T.VIEW_W * T.SUB;
  return (planOf(world).graves ?? []).filter(
    (slab) =>
      slab.x >= world.camX + T.ENEMY_HALF_W &&
      slab.x <= world.camX + view - T.ENEMY_HALF_W &&
      !world.enemies.some(
        (each) =>
          each.state === "rise" && each.x === slab.x && each.y === slab.y,
      ),
  );
}

/** Whether he may summon: fewer than `SUMMON_CAP` bonewalkers stand, a slab is free and the world has room. */
export const summons = (world: World): boolean =>
  standing(world) < T.SUMMON_CAP &&
  freeSlabs(world).length > 0 &&
  world.enemies.length < T.ENEMY_MAX;

/**
 * The summons: `SUMMONED` bonewalkers (ash, enraged rust) claw up out of free slabs in turn from one drawn at random,
 * while the world has room for them (`ENEMY_MAX`).
 */
function summon(world: World, vorhal: Enemy): void {
  const free = freeSlabs(world);
  if (free.length === 0) return;
  const from = roll(world, free.length);
  for (let k = 0; k < Math.min(T.SUMMONED, free.length); k++) {
    if (world.enemies.length >= T.ENEMY_MAX) return;
    const slab = free[(from + k) % free.length]!;
    const bone = newEnemy(
      world,
      "bonewalker",
      vorhal.enraged ? 1 : 0,
      slab.x,
      slab.y,
      1,
    );
    rise(world, bone, slab);
    world.enemies.push(bone);
  }
}

/**
 * Once Vorhal has no hit points left his sigils go out, and every bonewalker on its feet or in pieces crumbles for
 * good (not one in a hero's hands or flying from a throw, which crumbles as it lands).
 */
export function vanquish(world: World): void {
  if (!world.enemies.some((each) => isVorhal(each) && each.hp === 0)) return;
  world.sigils = [];
  for (const each of world.enemies)
    if (
      isBonewalker(each) &&
      !["dead", "held", "thrown"].includes(each.state)
    ) {
      each.hp = each.target = each.z = each.vx = each.vz = 0;
      setState(each, "dead");
      spark(world, "ko", each.x, each.y, T.SPARK_HEIGHT / 4);
    }
}
