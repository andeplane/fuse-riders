import { MAGIC } from "./input.js";
import { div } from "./math.js";
import { isImp } from "./imps.js";
import * as T from "./tuning.js";
import {
  inView,
  launch,
  setState,
  spark,
  type Enemy,
  type Hero,
  type Spell,
  type World,
} from "./world.js";

/**
 * Magic, as Golden Axe II had it (design.md, "Heroes"). A hero on its feet on the floor (standing, walking or
 * running) with a pot or more starts a charge on a Magic press, ahead of any Attack or Jump pressed with it; one
 * pressed while it was busy waits `BUFFER_STEPS`, as Attack does. Let go within `MAGIC_TAP` steps, the charge is a tap and casts every pot held; held longer, the
 * level chosen starts at 1 and rises by one every `CHARGE_STEPS`, up to the pots held, and letting go casts it and
 * keeps the rest. A press that waited and was let go before the hero came free is a tap too. A charging hero stands
 * still and can be hit, which ends the charge with nothing spent; nobody casts in the air, reeling or off its feet.
 *
 * A cast spends the level's pots and plays the hero's spell (`SPELLS`) for the level's steps, the hero standing in
 * `cast`, where no mace reaches it. Every enemy, sack imps too, stands frozen from the cast until the blow lands on the
 * spell's `hit` step. The blow lands on every fighting enemy whose whole body is on screen with hit points left, but
 * not on one in a hero's hands or flying from a throw: it takes the level's share of its full hit points and is
 * knocked down away from the caster. Sack imps are never struck: their sacks are kicked open, not blasted. No hero is
 * ever hurt. Spells play in the order they were cast, and heroes cast in id order, so two cast on one step land in
 * that order and the first's blow may leave nothing for the second's. The caster's tallies count the cast, and the
 * hit points and knockdowns its blow takes.
 */

/** The level a hero charging Magic for `held` steps has chosen, up to its pots. */
export const chosenLevel = (hero: Hero, held: number): number =>
  Math.min(
    hero.pots,
    1 + Math.floor(Math.max(0, held - T.MAGIC_TAP - 1) / T.CHARGE_STEPS),
  );

/** A Magic press is waiting, and the hero has a pot to spend on it. */
export const conjures = (hero: Hero): boolean =>
  hero.magicBuf > 0 && hero.pots > 0;

/** A free hero's Magic: still held, it starts the charge; already let go, it was a tap and casts every pot. */
export function conjure(world: World, hero: Hero, bits: number): void {
  hero.vx = hero.vy = hero.magicBuf = 0;
  if (bits & MAGIC) setState(hero, "charge");
  else cast(world, hero, hero.pots);
}

/**
 * A charge's step: the hero stands while Magic is held. Let go, it casts every pot from a tap, or else the level it
 * had chosen on the last step it held Magic (`timer` steps since the press, every one of them held).
 */
export function charge(world: World, hero: Hero, bits: number): void {
  hero.vx = hero.vy = 0;
  if (bits & MAGIC) return;
  cast(
    world,
    hero,
    hero.timer <= T.MAGIC_TAP ? hero.pots : chosenLevel(hero, hero.timer),
  );
}

function cast(world: World, hero: Hero, level: number): void {
  hero.pots -= level;
  hero.casts++;
  setState(hero, "cast");
  world.spells.push({ hero: hero.id, level, born: world.step });
}

const caster = (world: World, spell: Spell): Hero =>
  world.heroes.find((each) => each.id === spell.hero)!;
/** The spell's level as its caster's kind plays it. */
const played = (hero: Hero, spell: Spell): T.SpellLevel =>
  T.SPELLS[hero.kind].levels[spell.level - 1]!;

/** Some spell's blow has yet to land: every enemy stands frozen. */
export const spellbound = (world: World): boolean =>
  world.spells.some(
    (spell) =>
      world.step - spell.born < played(caster(world, spell), spell).hit,
  );

/** An enemy a spell's blow lands on. */
const blasted = (world: World, enemy: Enemy): boolean =>
  !isImp(enemy) &&
  enemy.hp > 0 &&
  enemy.state !== "held" &&
  enemy.state !== "thrown" &&
  inView(world, enemy);

/**
 * The spells' step, in the order they were cast, once the heroes have moved: a blow due lands, and a spell played
 * out is gone and leaves its hero standing.
 */
export function advanceSpells(world: World): void {
  world.spells = world.spells.filter((spell) => {
    const hero = caster(world, spell),
      { steps, hit, share } = played(hero, spell),
      age = world.step - spell.born;
    if (age === hit)
      for (const enemy of world.enemies)
        if (blasted(world, enemy)) blast(world, hero, enemy, share);
    if (age < steps) return true;
    setState(hero, "idle");
    return false;
  });
}

function blast(world: World, hero: Hero, enemy: Enemy, share: number): void {
  // A boss takes no more than its cap, whatever the level.
  const full = T.enemyMaxHp(enemy.kind, enemy.tier, world.heroes.length),
    cap = T.BOSS[enemy.kind] ? Math.min(share, T.BOSS_SHARE) : share,
    taken = Math.min(enemy.hp, div(full * cap, T.SHARE));
  enemy.hp -= taken;
  hero.damage += taken;
  hero.magicDamage += taken;
  hero.knockdowns++;
  launch(world, enemy, enemy.x < hero.x ? -1 : 1);
  spark(
    world,
    enemy.hp === 0 ? "ko" : "heavy",
    enemy.x,
    enemy.y,
    enemy.z + T.SPARK_HEIGHT,
  );
}
