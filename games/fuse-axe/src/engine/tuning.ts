/**
 * The constants every layer agrees on. Distances are integer sub-units (`px(n)` is n pixels), velocities sub-units
 * per step and accelerations sub-units per step per step, so a replay folds to the same bits on every device; the
 * simulation runs `STEPS_PER_SECOND` steps a second.
 */
export const SUB = 256;

/**
 * A constant in pixels as sub-units; for module constants, not for per-step state. Halves round away from zero, so
 * `px(-n)` mirrors `px(n)` (a knockback to the left matches one to the right), and a result of zero is never `-0`.
 */
export const px = (pixels: number): number =>
  Math.sign(pixels) * Math.round(Math.abs(pixels) * SUB) + 0;

export const STEPS_PER_SECOND = 60;
/** Log ticks are 50 ms, so each folds three steps. */
export const STEPS_PER_TICK = 3;
/** The native screen in pixels, scaled up by whole numbers on the page. */
export const VIEW_W = 320;
export const VIEW_H = 180;
/** Seats per room, as in every Fuse game. */
export const CAPACITY = 5;

// ---- the stage ----
/** The floor band: a hero's feet stand between these depths, which are also screen rows in the lower half. */
export const FLOOR_TOP = px(104);
export const FLOOR_BOTTOM = px(172);
/** Stage 1, Ashen Village: four screens of road. Later stages bring their own lengths. */
export const STAGE_LENGTH = px(4 * VIEW_W);
/** The camera's left edge stops here, with the stage's end at the screen's right edge. */
export const CAMERA_END = STAGE_LENGTH - px(VIEW_W);
/** The camera keeps the leading hero this far from its left edge, unless the leftmost hero holds it back. */
export const CAMERA_LEAD = px(160);
/** The most the camera moves in a step: faster than any hero walks, so it catches up smoothly when a wave's lock lifts. */
export const CAMERA_SPEED = px(2);
/** How close a hero's centre comes to the screen's edges: half a body, so nobody walks off screen. */
export const HERO_MARGIN = px(14);

// ---- the heroes ----
export const HERO_KINDS = ["brakka", "rhea", "gorm"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];
/** Walking speed along the road (`x`) and in depth (`y`); depth is slower, as in the original. */
export const WALK: Readonly<
  Record<HeroKind, { readonly x: number; readonly y: number }>
> = {
  brakka: { x: px(1), y: px(0.6) },
  rhea: { x: px(1.25), y: px(0.75) },
  gorm: { x: px(0.8), y: px(0.5) },
};
/** 181/256 ≈ 1/√2: a diagonal scales both components so it is no faster than walking straight. */
export const DIAGONAL = 181;
/** A jump's launch speed and the pull back down: about 38 px high and 40 steps (0.67 s) in the air. */
export const JUMP_VZ = px(3.7);
export const GRAVITY = px(0.19);
/** Steps a landed hero shows the landing pose; it acts again on the step after. */
export const LAND_STEPS = 8;
/** Steps an Attack or Jump press stays usable, counting its own: one made while the hero is busy acts when it is free. */
export const BUFFER_STEPS = 6;

// ---- the combo ----
/**
 * One swing's frame data: steps of wind-up, of the blade's hit window and of recovery, the blade's reach in front of
 * the hero's centre, and the damage. A press in the window or the recovery chains the next swing as soon as the
 * window ends; otherwise the hero is back to idle after the recovery.
 */
export interface Swing {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly reach: number;
  readonly damage: number;
}
const swing = (
  startup: number,
  active: number,
  recovery: number,
  reach: number,
  damage: number,
): Swing => ({ startup, active, recovery, reach: px(reach), damage });
/** Two slashes and a heavy finisher that knocks down. Rhea is quick with long reach and light hits, Gorm the reverse. */
export const COMBO: Readonly<Record<HeroKind, readonly [Swing, Swing, Swing]>> =
  {
    brakka: [
      swing(6, 3, 10, 28, 6),
      swing(6, 3, 10, 28, 6),
      swing(9, 4, 20, 32, 12),
    ],
    rhea: [
      swing(4, 3, 8, 34, 4),
      swing(4, 3, 8, 34, 4),
      swing(7, 4, 16, 38, 9),
    ],
    gorm: [
      swing(8, 4, 13, 22, 9),
      swing(8, 4, 13, 22, 9),
      swing(12, 5, 24, 26, 16),
    ],
  };
/** A hit lands only within this many sub-units in depth: lining up on the road is the core skill. */
export const LANE = px(6);
/** How high the blade sweeps above the hero's feet. */
export const SWING_HEIGHT = px(40);
/** Steps attacker and target hold still on a hit, and longer on one that knocks down. */
export const HITSTOP = 4;
export const HEAVY_HITSTOP = 8;

// ---- the enemies ----
export const ENEMY_KINDS = ["ravager"] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];
/** A kind's hit points at its lowest tier with one hero; `enemyMaxHp` scales them. */
export const ENEMY_HP: Readonly<Record<EnemyKind, number>> = { ravager: 40 };
/** Tiers by palette (ash, rust, violet): each adds hit points now, and aggression once enemies fight back. */
export const TIERS = [0, 1, 2] as const;
export type Tier = (typeof TIERS)[number];
/** Each tier's hit points in quarters of the kind's base. */
export const TIER_HP: Readonly<Record<Tier, number>> = { 0: 4, 1: 5, 2: 6 };
/**
 * An enemy's full hit points: its kind's base by its tier, and a quarter more for each hero beyond the first (an
 * empty world counts one), in whole points. A party of five meets ravagers with twice the hit points.
 */
export function enemyMaxHp(
  kind: EnemyKind,
  tier: Tier,
  heroes: number,
): number {
  const party = Math.min(Math.max(heroes, 1), CAPACITY);
  return Math.trunc((ENEMY_HP[kind] * TIER_HP[tier] * (3 + party)) / 16);
}
/**
 * The most enemies a world holds at once, a defeated one that has not blinked out yet included. `spawnEnemy` refuses
 * the next one, so the checkpoint codec's bound on the list (and on the ones a swing has hit) is one no run can pass.
 */
export const ENEMY_MAX = 64;
/** An enemy's body: half its width either side of its centre, and its height above its feet. */
export const ENEMY_HALF_W = px(10);
export const ENEMY_HEIGHT = px(44);
/** A hurt enemy is nudged back at this speed, slowing by `HURT_FRICTION` a step, and reels for `HURT_STEPS`. */
export const HURT_PUSH = px(1.5);
export const HURT_FRICTION = px(0.25);
export const HURT_STEPS = 20;
/** A knockdown launches the enemy up and away; it falls under the heroes' gravity. */
export const KNOCK_VX = px(1.25);
export const KNOCK_VZ = px(2.5);
/** Steps an enemy lies down, then gets up (invulnerable throughout), and a defeated one blinks before it is gone. */
export const DOWN_STEPS = 45;
export const GETUP_STEPS = 20;
export const DEAD_STEPS = 60;

// ---- waves (the triggers themselves are in `stages.ts`) ----
/** A wave's enemy appears this far outside the screen's edge on its side, its whole body out of view... */
export const ENTER_OUT = px(16);
/** ...and walks in at this speed to `ENTER_INSET` inside that edge, or `ENTER_STAGGER` further per round of extras. */
export const ENTER_WALK = px(0.75);
export const ENTER_INSET = px(40);
export const ENTER_STAGGER = px(24);
/** Each round of a wave's extra spawns (one per hero beyond the first) comes this many steps after its original. */
export const EXTRA_DELAY = 30;
/** While the screen is locked, an enemy idle outside it walks back in to this far inside the nearer edge. */
export const RETURN_INSET = px(32);
/** Steps GO shows after a wave is cleared; it stays on longer while the camera has not moved on. */
export const GO_STEPS = 2 * STEPS_PER_SECOND;

// ---- effects ----
/** Steps a hit spark lives, and the most the world keeps at once (the oldest go first). */
export const FX_LIFE = 20;
export const FX_MAX = 32;
/** How high above the target's feet a spark appears: where the blade meets the body. */
export const SPARK_HEIGHT = px(28);
