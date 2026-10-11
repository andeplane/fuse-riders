import { planOf, waveSpawns } from "./stages.js";
import {
  BOSS,
  HERO_HP,
  ITEM_BLINK,
  ITEM_LIFE,
  MAX_POTS,
  SADDLE,
  SPELLS,
  SUB,
  enemyMaxHp,
  type EnemyKind,
  type HeroKind,
  type ItemKind,
  type MountKind,
  type SpellKind,
  type Tier,
} from "./tuning.js";
import { chosenLevel } from "./magic.js";
import {
  defeated,
  showsGo,
  stageCleared,
  type EnemyState,
  type FxKind,
  type HeroState,
  type MountState,
  type World,
} from "./world.js";

/**
 * What the renderer sees of the world: positions in whole pixels (`x` along the road, `y` the depth that is also
 * the feet's screen row, `z` height above the floor), so sprites land on the pixel grid. A figure's screen position
 * is `(x − camX, y − z)` and its shadow sits at `(x − camX, y)`. Each value is floored once on its own, so every
 * sprite shares the same whole-pixel camera offset as the backdrop and none shimmers against it.
 */
export type {
  EnemyKind,
  HeroKind,
  ItemKind,
  MountKind,
  SpellKind,
  Tier,
} from "./tuning.js";
export type { FxKind } from "./world.js";
/**
 * `attack1` and `attack2` are the slashes, `attack3` the finisher. `run` is the run a double tap starts and `dash`
 * the dash attack from it (a shoulder charge, Gorm's a headbutt). `jumpattack` stabs down from a jump, standing or
 * running (the blade is out from `STAB_STEPS` until it lands), `backattack` strikes behind the hero without turning
 * it (`BACK_STEPS`), `grab` holds an enemy for `GRAB_STEPS` and `throw` follows through for `THROW_STEPS`. `hurt`
 * reels, `knockdown` flies, `down` lies and `getup` rises; `dead` lies fallen until `respawn` drops the hero in from
 * the top of the screen, or it is `out`. `charge` holds Magic (the level chosen is `charge` in the view) and `cast`
 * stands casting its spell (`spells` in the world's view) until the spell is gone. `ride` sits a beast (`mounted`)
 * throughout: the beast's anim says what the pair does.
 */
export type HeroAnim = HeroState;
/**
 * `enter` is a wave's enemy walking in from the screen's edge (or back in to a locked screen): walk frames, as is
 * `walk`. `windup` telegraphs the mace for its tier's steps, `attack` swings it (it lands on the first step) and
 * `recover` follows. `held` waits in a hero's hands, and `thrown` flies behind it, then lands `down` (or `dead`).
 * A sack imp (kind `imp`) scurries in `walk`, `stumble`s from a kick (or from a heavy one flies in `knockdown`, lies
 * `down` and gets up), then runs in `flee`; it is never `dead`.
 *
 * An ogre (kind `ogre`, a `boss`) walks in, walks and stands as a ravager does; `windup` raises its hammer for its
 * mood's steps (`OGRE_STEPS` in `view-kit.ts`), `slam` brings it down (it lands on the first step, and the shockwave
 * runs on along the floor from `SLAM_REACH` at `QUAKE_SPEED` for `QUAKE_STEPS`), `sweep` swings it round (landing at
 * `sweepWindup`) and `recover` stands open; `stagger` reels from a heavy blow without being nudged, and it is knocked
 * down, lies, gets up and is `dead` as a ravager is. It never reels (`hurt`), nor is `held` or `thrown`.
 *
 * A lancer (kind `lancer`) has a ravager's anims but `attack`: `windup` draws back its spear for its tier's steps,
 * `thrust` holds it out (it lands on the first step, `SPEAR.reach` in front) and `recover` follows. `leap` jumps in
 * from the screen's edge or at a hero (rising, then falling, `LANCER_STEPS` in `view-kit.ts`), and `plunge` drives the
 * spear down where it lands, then stands over it. It walks back in to a locked screen in `enter`.
 *
 * A ravager riding a beast (`mounted`) is in `ride` throughout: the beast's anim says what the pair does.
 */
export type EnemyAnim = EnemyState;

/**
 * A beast's anims (`CLAWBEAK_STEPS` in `view-kit.ts` times them). Ridden: `enter` walks a wave's in, `idle` and `walk`,
 * `sweep` winds up its tail (`windup` steps), lashing it round on that `animStep` (`CLAWBEAK.reach` either side), then
 * recovers to `sweep` steps; `hop` is a hero's beast jumping (rising for `hopRise` steps, then falling, as a hero's
 * jump). Riderless: `flee` panics for `panic` steps (coming down first if thrown out of a hop), `wander` walks back and
 * forth (turning every `turn` steps) and `leave` walks off the screen.
 */
export type MountAnim = MountState;

export interface HeroView {
  id: number;
  seat: number;
  kind: HeroKind;
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
  anim: HeroAnim;
  /** Steps since `anim` began; the renderer divides it into sprite frames. */
  animStep: number;
  hp: number;
  maxHp: number;
  /** Lives left, this one included. */
  lives: number;
  /**
   * No mace lands on the hero: getting up, and for a while after dropping back in. Draw it blinking. A hero in `cast`
   * is safe too, but does not set this: the spell is its cue.
   */
  invulnerable: boolean;
  /** Magic pots held, and the most the hero's kind can hold. */
  pots: number;
  maxPots: number;
  /**
   * While charging magic (`charge`), the level chosen, from 1, which letting go casts once the charge is past a tap
   * (`MAGIC_TAP`; a tap casts every pot); 0 otherwise.
   */
  charge: number;
  /** Riding a beast (`ride`): its `z` is the saddle's, `CLAWBEAK.saddle` over the beast's. */
  mounted: boolean;
}

/**
 * A spell playing: its caster's id, which spell, its level and its age in steps. Its timing per kind and level is
 * `SPELL_STEPS` in `view-kit.ts`: every enemy stands frozen until `hit`, when the blow lands on the screen, and the
 * caster stands in `cast` until `steps`, when the spell is gone.
 */
export interface SpellView {
  hero: number;
  kind: SpellKind;
  level: number;
  age: number;
}

export interface EnemyView {
  id: number;
  kind: EnemyKind;
  /** The palette: 0 ash, 1 rust, 2 violet. */
  tier: Tier;
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
  /** `dead` lasts `DEAD_STEPS` for the blink before the enemy is gone; `getup` is invulnerable throughout. */
  anim: EnemyAnim;
  animStep: number;
  hp: number;
  maxHp: number;
  /** In hit-stop from a hit just taken, or an ogre's armour taking one: draw the damage flash. */
  flash: boolean;
  /** A stage boss (an ogre): its health shows in the world's `boss` bar. */
  boss: boolean;
  /** An ogre whose twin has fallen: it fights faster. */
  enraged: boolean;
  /** Riding a beast (`ride`), its `z` the saddle's, as a hero's. */
  mounted: boolean;
}

/** A beast, ridden or not. Its rider, a hero or an enemy, stands where it does, `CLAWBEAK.saddle` higher, over it. */
export interface MountView {
  id: number;
  kind: MountKind;
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
  anim: MountAnim;
  animStep: number;
  rider: { kind: "hero" | "enemy"; id: number } | null;
}

/**
 * The stage boss's health while its wave is fought, once the first of it has come: every boss of the wave together,
 * one still to come counting full and one fallen none, so the bar only ever drains. `kind` names it.
 */
export interface BossView {
  kind: EnemyKind;
  hp: number;
  maxHp: number;
}

/** A hit spark at its impact point, `age` steps old (under `FX_LIFE`). */
export interface FxView {
  kind: FxKind;
  x: number;
  y: number;
  z: number;
  age: number;
}

/** An item on the floor (`z` above it while it pops out), blinking in its last moments before it vanishes. */
export interface ItemView {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  z: number;
  blink: boolean;
}

export interface WorldView {
  step: number;
  camX: number;
  heroes: HeroView[];
  enemies: EnemyView[];
  fx: FxView[];
  /** In id order, which no hero or enemy shares. */
  items: ItemView[];
  /** The spells playing, in the order they were cast: at most one per hero. */
  spells: SpellView[];
  /** The beasts, in id order, which no other figure shares. */
  mounts: MountView[];
  /** The stage being fought, from 1: its road's length is `stageLengthPx(stage)` and its backdrop the stage's art. */
  stage: number;
  /**
   * Camp after stage `stage`: one screen of night clearing round a fire (its own backdrop), no wave, and sack imps
   * that spill meat (an item of kind `meat`) as well as pots.
   */
  camp: boolean;
  /** The wave begun latest, from 1 (0 before the first), of `waves` in the stage. */
  wave: number;
  waves: number;
  /** A wave is being fought and the screen holds still until it is cleared. */
  locked: boolean;
  /** Flash "GO →": a wave was just cleared and the road ahead is open. */
  go: boolean;
  /** The stage's last wave is cleared. */
  cleared: boolean;
  /** Every hero is out of lives. */
  defeated: boolean;
  /** The boss's health bar, while its wave is fought; null otherwise. */
  boss: BossView | null;
}

const whole = (value: number) => Math.floor(value / SUB);

function bossOf(world: World): BossView | null {
  const wave = planOf(world).waves[world.wave - 1],
    party = world.heroes.length;
  if (!world.locked || !wave || world.spawned === 0) return null;
  const spawns = waveSpawns(wave, party),
    bosses = spawns.filter((each) => BOSS[each.kind]);
  if (bosses.length === 0) return null;
  const full = (each: { kind: EnemyKind; tier: Tier }) =>
    BOSS[each.kind] ? enemyMaxHp(each.kind, each.tier, party) : 0;
  let hp = 0,
    maxHp = 0;
  spawns.forEach((each, index) => {
    maxHp += full(each);
    if (index >= world.spawned) hp += full(each);
  });
  for (const enemy of world.enemies) if (BOSS[enemy.kind]) hp += enemy.hp;
  return { kind: bosses[0]!.kind, hp, maxHp };
}

/** A figure's height in the view: a rider's in the saddle, over its beast's. */
const seated = (figure: { state: string; z: number }) =>
  whole(figure.z + (figure.state === "ride" ? SADDLE : 0));

export function toView(world: World): WorldView {
  const heroIds = new Set(world.heroes.map((hero) => hero.id));
  return {
    step: world.step,
    camX: whole(world.camX),
    heroes: world.heroes.map((hero) => ({
      id: hero.id,
      seat: hero.seat,
      kind: hero.kind,
      x: whole(hero.x),
      y: whole(hero.y),
      z: seated(hero),
      facing: hero.facing,
      anim: hero.state,
      animStep: hero.timer,
      hp: hero.hp,
      maxHp: HERO_HP[hero.kind],
      lives: hero.lives,
      // A hero that has never been (`invulnUntil` 0) is not, though step 0 is no later than that.
      invulnerable: hero.invulnUntil > 0 && world.step <= hero.invulnUntil,
      pots: hero.pots,
      maxPots: MAX_POTS[hero.kind],
      // The step shown is one more held than `timer` counts since the press.
      charge: hero.state === "charge" ? chosenLevel(hero, hero.timer + 1) : 0,
      mounted: hero.state === "ride",
    })),
    enemies: world.enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      tier: enemy.tier,
      x: whole(enemy.x),
      y: whole(enemy.y),
      z: seated(enemy),
      facing: enemy.facing,
      anim: enemy.state,
      animStep: enemy.timer,
      hp: enemy.hp,
      maxHp: enemyMaxHp(enemy.kind, enemy.tier, world.heroes.length),
      flash:
        world.step <= enemy.stopUntil ||
        (enemy.flashUntil > 0 && world.step <= enemy.flashUntil),
      boss: BOSS[enemy.kind],
      enraged: enemy.enraged,
      mounted: enemy.state === "ride",
    })),
    fx: world.fx.map((fx) => ({
      kind: fx.kind,
      x: whole(fx.x),
      y: whole(fx.y),
      z: whole(fx.z),
      age: world.step - fx.born,
    })),
    items: world.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      x: whole(item.x),
      y: whole(item.y),
      z: whole(item.z),
      blink: world.step - item.born >= ITEM_LIFE - ITEM_BLINK,
    })),
    spells: world.spells.map((spell) => ({
      hero: spell.hero,
      kind: SPELLS[world.heroes.find((each) => each.id === spell.hero)!.kind]
        .kind,
      level: spell.level,
      age: world.step - spell.born,
    })),
    mounts: world.mounts.map((mount) => ({
      id: mount.id,
      kind: mount.kind,
      x: whole(mount.x),
      y: whole(mount.y),
      z: whole(mount.z),
      facing: mount.facing,
      anim: mount.state,
      animStep: mount.timer,
      rider: mount.rider
        ? { kind: heroIds.has(mount.rider) ? "hero" : "enemy", id: mount.rider }
        : null,
    })),
    stage: world.stage,
    camp: world.camp,
    wave: world.wave,
    waves: planOf(world).waves.length,
    locked: world.locked,
    go: showsGo(world),
    cleared: stageCleared(world),
    defeated: defeated(world),
    boss: bossOf(world),
  };
}
