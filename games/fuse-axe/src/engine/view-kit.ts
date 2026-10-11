import {
  BACK_ATTACK,
  BEAST_HALF_W,
  CAMERA_END,
  COMBO,
  DASH,
  DRAKE_INHALE,
  ENEMY_BODY,
  FLAME_LANE,
  FLAME_LENGTH,
  FLAME_STEPS,
  LANCE_STEPS,
  LANCE_WINDUP,
  flameAt,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  GRAVITY,
  JUMP_ATTACK,
  JUMP_VZ,
  HERO_KINDS,
  LANCE_RECOVER,
  LANCER,
  LEAP_STEPS,
  OGRE,
  PANIC_STEPS,
  PLUNGE_REACH,
  PLUNGE_STEPS,
  SADDLE,
  SPEAR_REACH,
  TAIL_REACH,
  TAIL_STEPS,
  TAIL_WINDUP,
  THRUST_STEPS,
  WANDER_TURN,
  OGRE_RECOVER,
  QUAKE_SPEED,
  QUAKE_STEPS,
  SLAM_REACH,
  SLAM_STEPS,
  STAGE_LENGTH,
  STAGGER_STEPS,
  SUB,
  SWEEP_STEPS,
  SWEEP_WINDUP,
  RAVAGER,
  SPELLS,
  type EnemyKind,
  type HeroKind,
  type SpellKind,
  type Swing,
  type Tier,
} from "./tuning.js";
import { STAGES } from "./stages.js";

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
  MOUNT_KINDS,
} from "./tuning.js";
export {
  DRAKE_ONLY,
  ENEMY_STATES,
  FX_KINDS,
  HERO_STATES,
  IMP_ONLY,
  LANCER_ONLY,
  MOUNT_STATES,
  OGRE_ONLY,
} from "./world.js";

/** The floor band's top and bottom screen rows. */
export const FLOOR_TOP_PX = FLOOR_TOP / SUB;
export const FLOOR_BOTTOM_PX = FLOOR_BOTTOM / SUB;
/** Stage 1's length and the furthest the camera's left edge goes. */
export const STAGE_LENGTH_PX = STAGE_LENGTH / SUB;
export const CAMERA_END_PX = CAMERA_END / SUB;
/** How many stages the run has: `WorldView.stage` runs from 1 to this. */
export const STAGE_COUNT = STAGES.length;
/** A stage's plan, by number; a stage this build lacks (a newer one) has Stage 1's road. */
const roadOf = (stage: number) =>
  (Number.isInteger(stage) && STAGES[stage - 1]) || STAGES[0]!;
/** A stage's length and the furthest the camera's left edge goes on it, in pixels. */
export const stageLengthPx = (stage: number): number =>
  roadOf(stage).length / SUB;
export const cameraEndPx = (stage: number): number =>
  roadOf(stage).cameraEnd / SUB;
/**
 * Half an enemy's width, by kind (an ogre's body is bigger): a spell's blow lands only on those at least this far
 * inside either edge of the screen. A kind this build lacks (a newer one) has the ravager's.
 */
export const enemyHalfWPx = (kind: EnemyKind): number =>
  (Object.hasOwn(ENEMY_BODY, kind) ? ENEMY_BODY[kind] : ENEMY_BODY.ravager)
    .half / SUB;

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
/** A dash's steps: its blow is out on every `animStep` below `active`, then it stands for `recovery`. */
export interface DashSteps {
  readonly active: number;
  readonly recovery: number;
}
const dashSteps = (kind: HeroKind): DashSteps => ({
  active: DASH[kind].active,
  recovery: DASH[kind].recovery,
});
/** Each hero's dash attack as steps of its blow out and its recovery. */
export const DASH_STEPS: Readonly<Record<HeroKind, DashSteps>> = {
  brakka: dashSteps("brakka"),
  rhea: dashSteps("rhea"),
  gorm: dashSteps("gorm"),
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

/**
 * An ogre's timing in steps, to time its frames: the slam's wind-up calm and enraged (the hammer lands on the step
 * after the last), the slam's follow-through, the sweep's wind-up (it lands on that `animStep`) and length, the
 * recovery and the stagger.
 */
export const OGRE_STEPS = {
  windup: OGRE.calm.windup,
  rageWindup: OGRE.rage.windup,
  slam: SLAM_STEPS,
  sweepWindup: SWEEP_WINDUP,
  sweep: SWEEP_STEPS,
  recover: OGRE_RECOVER,
  stagger: STAGGER_STEPS,
} as const;
/**
 * The slam's shockwave in pixels: its front runs `QUAKE_SPEED` a step on from `SLAM_REACH` in front of the ogre, `n`
 * steps into the slam, for `1 ≤ n ≤ QUAKE_STEPS`.
 */
export const QUAKE = {
  reach: SLAM_REACH / SUB,
  speed: QUAKE_SPEED / SUB,
  steps: QUAKE_STEPS,
} as const;

/**
 * A lancer's timing in steps, to time its frames: the thrust's wind-up per tier (the spear lands on the step after the
 * last), the steps the spear stays out (`thrust`) and the lancer stands open after it (`recover`), the leap's steps
 * (`animStep` 0 takes off from the floor, it climbs on every step up to `leapApex` and falls after, landing on the step
 * that would be `leap`) and the steps it stands over the spear it drove down landing (`plunge`).
 */
export const LANCER_STEPS = {
  windup: {
    0: LANCER[0].windup,
    1: LANCER[1].windup,
    2: LANCER[2].windup,
  } satisfies Readonly<Record<Tier, number>>,
  thrust: THRUST_STEPS,
  recover: LANCE_RECOVER,
  leap: LEAP_STEPS,
  // Step `n` of the leap moves it by the launch speed less `n − 1` pulls of gravity.
  leapApex: 1 + Math.floor((JUMP_VZ - 1) / GRAVITY),
  plunge: PLUNGE_STEPS,
} as const;
/** In pixels: how far the thrust's spear reaches in front of the lancer's centre, and the landing strike's. */
export const SPEAR = {
  reach: SPEAR_REACH / SUB,
  plunge: PLUNGE_REACH / SUB,
} as const;

/**
 * A clawbeak's timing in steps, to time its frames (`MountAnim`): the tail sweep's wind-up (it lands on that
 * `animStep`) and length, the panic after losing a rider, the steps a wanderer walks before turning, and a hero's hop's
 * rise (it climbs on every `animStep` below `hopRise`, as a hero's jump).
 */
export const CLAWBEAK_STEPS = {
  windup: TAIL_WINDUP,
  sweep: TAIL_STEPS,
  panic: PANIC_STEPS,
  turn: WANDER_TURN,
  hopRise: JUMP_RISE_STEPS,
} as const;
/** In pixels: the saddle's height over the beast's feet, the tail's reach either side, and half the beast's width. */
export const CLAWBEAK = {
  saddle: SADDLE / SUB,
  reach: TAIL_REACH / SUB,
  half: BEAST_HALF_W / SUB,
} as const;

/**
 * An ember drake's timing in steps, to time its frames (`MountAnim`): the breath's inhale (the flame is out from that
 * `animStep`) and its whole length, the captain's saddle thrust's wind-up (it lands on that `animStep`) and length, and
 * as a clawbeak's, the panic, the wanderer's turn and a hop's rise.
 */
export const DRAKE_STEPS = {
  inhale: DRAKE_INHALE,
  breathe: DRAKE_INHALE + FLAME_STEPS,
  lanceWindup: LANCE_WINDUP,
  lance: LANCE_STEPS,
  panic: PANIC_STEPS,
  turn: WANDER_TURN,
  hopRise: JUMP_RISE_STEPS,
} as const;
/** In pixels: the flame's mouth in front of the drake's centre, its longest run from there, and its lane either side. */
export const FLAME = {
  mouth: BEAST_HALF_W / SUB,
  length: FLAME_LENGTH / SUB,
  lane: FLAME_LANE / SUB,
} as const;
/**
 * How far in front of a breathing drake's centre its flame's front is, in pixels, `animStep` steps into `breathe`: 0
 * while it inhales and once it is over; it runs out from the mouth, holds at its length and draws back. Never throws:
 * an odd step is rounded down to a whole one, and one that is not a number has no flame.
 */
export const flamePx = (animStep: number): number =>
  Number.isFinite(animStep) ? flameAt(Math.floor(animStep)) / SUB : 0;
