import {
  BACK_ATTACK,
  CAMERA_END,
  COMBO,
  ENEMY_HALF_W,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  GRAVITY,
  JUMP_ATTACK,
  JUMP_VZ,
  HERO_KINDS,
  STAGE_LENGTH,
  SUB,
  RAVAGER,
  SPELLS,
  type HeroKind,
  type SpellKind,
  type Swing,
  type Tier,
} from "./tuning.js";

/** The engine constants the renderer may read, in whole pixels where they are distances. */
export {
  VIEW_W,
  VIEW_H,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  CAPACITY,
  HERO_KINDS,
  ENEMY_KINDS,
  ENEMY_HP,
  TIERS,
  LAND_STEPS,
  HURT_STEPS,
  DOWN_STEPS,
  GETUP_STEPS,
  DEAD_STEPS,
  FX_LIFE,
  HERO_HP,
  LIVES,
  HERO_HURT_STEPS,
  HERO_DOWN_STEPS,
  GETUP_GRACE,
  RESPAWN_DELAY,
  ATTACK_STEPS,
  RECOVER_STEPS,
  GRAB_STEPS,
  THROW_STEPS,
  MAGIC_TAP,
  CHARGE_STEPS,
  SPELL_KINDS,
} from "./tuning.js";
export { ENEMY_STATES, FX_KINDS, HERO_STATES, IMP_ONLY } from "./world.js";

/** The floor band's top and bottom screen rows. */
export const FLOOR_TOP_PX = FLOOR_TOP / SUB;
export const FLOOR_BOTTOM_PX = FLOOR_BOTTOM / SUB;
/** Stage 1's length and the furthest the camera's left edge goes. */
export const STAGE_LENGTH_PX = STAGE_LENGTH / SUB;
export const CAMERA_END_PX = CAMERA_END / SUB;
/** Half an enemy's width: a spell's blow lands only on those at least this far inside either edge of the screen. */
export const ENEMY_HALF_W_PX = ENEMY_HALF_W / SUB;

export interface SwingSteps {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
}
/** A hero's three swings, `attack1` to `attack3`. */
export type Swings = readonly [SwingSteps, SwingSteps, SwingSteps];
const timing = ({ startup, active, recovery }: Swing): SwingSteps => ({
  startup,
  active,
  recovery,
});
const steps = (kind: HeroKind): Swings => {
  const [first, second, third] = COMBO[kind];
  return [timing(first), timing(second), timing(third)];
};
/** Each hero's three swings (`attack1`–`attack3`) as steps of wind-up, blade out and recovery, to time the frames. */
export const SWING_STEPS: Readonly<Record<HeroKind, Swings>> = {
  brakka: steps("brakka"),
  rhea: steps("rhea"),
  gorm: steps("gorm"),
};

/** Each hero's back attack as steps of wind-up, blade out and recovery. */
export const BACK_STEPS: Readonly<Record<HeroKind, SwingSteps>> = {
  brakka: timing(BACK_ATTACK.brakka),
  rhea: timing(BACK_ATTACK.rhea),
  gorm: timing(BACK_ATTACK.gorm),
};
/** The steps each hero's jump attack winds up: its blade is out from this `animStep` until the hero lands. */
export const STAB_STEPS: Readonly<Record<HeroKind, number>> = {
  brakka: JUMP_ATTACK.brakka.startup,
  rhea: JUMP_ATTACK.rhea.startup,
  gorm: JUMP_ATTACK.gorm.startup,
};

/**
 * The steps a jump rises: it climbs on every `animStep` below this and falls from this one on. Step `n` of a jump
 * moves it by the launch speed less `n` pulls of gravity, so it climbs while that is above zero.
 */
export const JUMP_RISE_STEPS = Math.ceil(JUMP_VZ / GRAVITY);

/** A spell level's steps (from 1): enemies stand frozen until `hit`, when its blow lands, and it is gone at `steps`. */
export interface SpellSteps {
  readonly steps: number;
  readonly hit: number;
}
const spellSteps = (kind: HeroKind): readonly SpellSteps[] =>
  SPELLS[kind].levels.map(({ steps, hit }) => ({ steps, hit }));
/**
 * Each spell's timing by level, `SPELL_STEPS[kind][level - 1]`, against a `SpellView`'s `age`. Keyed by the spell the
 * way `SPELLS` says which hero casts it, so a change there cannot leave this table on the wrong hero.
 */
export const SPELL_STEPS = Object.fromEntries(
  HERO_KINDS.map((kind) => [SPELLS[kind].kind, spellSteps(kind)]),
) as Readonly<Record<SpellKind, readonly SpellSteps[]>>;

/** Each tier's wind-up in steps (ash, rust, violet): the mace lands on the step after the last. */
export const WINDUP_STEPS: Readonly<Record<Tier, number>> = {
  0: RAVAGER[0].windup,
  1: RAVAGER[1].windup,
  2: RAVAGER[2].windup,
};
