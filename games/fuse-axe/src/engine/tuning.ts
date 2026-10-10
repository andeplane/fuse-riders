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
/**
 * The most the camera moves in a step: faster than any hero walks, runs or dashes, so it keeps up with the leader and
 * catches up smoothly when a wave's lock lifts.
 */
export const CAMERA_SPEED = px(3);
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
/**
 * Steps an Attack or Jump press, or a run's double tap, stays usable, counting its own: one made while the hero is
 * busy acts when it is free.
 */
export const BUFFER_STEPS = 6;
/**
 * The run's double tap: Left or Right let go within `RUN_TAP` steps of its press (longer is a walk, not a tap) and
 * pressed again within `RUN_GAP` steps of letting go. Opposite directions never make one.
 */
export const RUN_TAP = 15;
export const RUN_GAP = 12;
/**
 * Running speed along the road, about twice the walk; in depth a run steers at the walk's pace. It lasts while its
 * direction is held and the other is not, and a jump from it keeps its speed, so it carries further.
 */
export const RUN: Readonly<Record<HeroKind, number>> = {
  brakka: px(1.875),
  rhea: px(2.25),
  gorm: px(1.5),
};

// ---- the heroes' health ----
/** A hero's hit points for each life: Gorm is the toughest, Rhea the frailest. */
export const HERO_HP: Readonly<Record<HeroKind, number>> = {
  brakka: 60,
  rhea: 48,
  gorm: 72,
};
/** Lives a hero sets out with. One who falls with none left is out. */
export const LIVES = 3;
/** Half a hero's width either side of its centre, where a mace lands. */
export const HERO_HALF_W = px(10);
/** Steps a hit hero reels, nudged back as an enemy is. */
export const HERO_HURT_STEPS = 16;
/** Juggle protection: the third hit within `JUGGLE_WINDOW` steps of the one before knocks the hero down. */
export const JUGGLE_HITS = 3;
export const JUGGLE_WINDOW = 90;
/** A hit that leaves a hero with a quarter of its hit points or fewer knocks it down. */
export const LOW_HP_SHARE = 4;
/** Steps a knocked-down hero lies. It gets up in `GETUP_STEPS`, invulnerable then and for `GETUP_GRACE` more. */
export const HERO_DOWN_STEPS = 40;
export const GETUP_GRACE = 30;
/** Steps a fallen hero lies before it drops back in from the top of the screen, if it has a life left. */
export const RESPAWN_DELAY = 90;
/** Steps a hero who dropped back in blinks invulnerable after it lands. */
export const RESPAWN_INVULN = 120;

// ---- the combo ----
/** What a hero's hit lands: its reach in front of the hero's centre, and the damage. */
export interface Blow {
  readonly reach: number;
  readonly damage: number;
}
/**
 * One swing's frame data: steps of wind-up, of the blade's hit window and of recovery, and its blow. A press in the
 * window or the recovery chains the next swing as soon as the window ends; otherwise the hero is back to idle after
 * the recovery.
 */
export interface Swing extends Blow {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
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
/**
 * The dash attack, Attack during a run: from the press it slides `speed` a step along the road for the `active` steps
 * its blow lands in, then stands for `recovery` steps. It knocks down whatever it hits, each enemy once.
 */
export interface Dash extends Blow {
  readonly active: number;
  readonly recovery: number;
  readonly speed: number;
}
const dash = (
  active: number,
  recovery: number,
  speed: number,
  reach: number,
  damage: number,
): Dash => ({ active, recovery, speed: px(speed), reach: px(reach), damage });
/** Brakka and Rhea charge with a shoulder, Rhea further and lighter; Gorm headbutts, shortest and hardest. */
export const DASH: Readonly<Record<HeroKind, Dash>> = {
  brakka: dash(10, 16, 2.5, 20, 10),
  rhea: dash(10, 12, 2.75, 22, 8),
  gorm: dash(8, 20, 2.25, 18, 14),
};
/** A hit lands only within this many sub-units in depth: lining up on the road is the core skill. */
export const LANE = px(6);
/** How high the blade sweeps above the hero's feet. */
export const SWING_HEIGHT = px(40);
/** Steps attacker and target hold still on a hit, and longer on one that knocks down. */
export const HITSTOP = 4;
export const HEAVY_HITSTOP = 8;

// ---- the back attack, the jump attack and the throw ----
/**
 * Attack and Jump pressed on the floor within this many steps of each other are the back attack. One log tick, so
 * two buttons pressed together land in it even when the log carries them in neighbouring ticks; shorter than every
 * first slash's wind-up, so a slash it turns into the back attack never had its blade out.
 */
export const BACK_WINDOW = STEPS_PER_TICK;
/** The back attack: a quick blow behind the hero, its facing kept, that knocks down. */
export const BACK_ATTACK: Readonly<Record<HeroKind, Swing>> = {
  brakka: swing(4, 3, 16, 28, 8),
  rhea: swing(3, 3, 14, 32, 6),
  gorm: swing(5, 4, 18, 24, 11),
};
/** The jump attack's downward stab: steps before the blade is out (it stays out until the hero lands), and its blow. */
export interface Stab extends Blow {
  readonly startup: number;
}
const stab = (startup: number, reach: number, damage: number): Stab => ({
  startup,
  reach: px(reach),
  damage,
});
export const JUMP_ATTACK: Readonly<Record<HeroKind, Stab>> = {
  brakka: stab(3, 26, 10),
  rhea: stab(2, 30, 8),
  gorm: stab(4, 22, 13),
};
/** How far below the hero's feet the stab reaches, besides the swing's sweep up from them. */
export const STAB_BELOW = px(16);
/** A dazed (`hurt`) enemy this close in front of the hero's centre, in the lane, can be grabbed. */
export const GRAB_REACH = px(24);
/** A grabbed enemy is held this far in front of the hero for `GRAB_STEPS`; the throw's follow-through lasts `THROW_STEPS`. */
export const GRAB_HOLD = px(14);
export const GRAB_STEPS = 12;
export const THROW_STEPS = 16;
/** The body leaves from this high over the hero's shoulder, flying behind it at `THROW_VX` and rising at `THROW_VZ`. */
export const THROW_LIFT = px(24);
export const THROW_VX = px(2.5);
export const THROW_VZ = px(2);
/** Damage the thrown body takes as it lands, and each enemy it knocks down on the way. */
export const THROW_DAMAGE = 12;
export const BODY_DAMAGE = 6;
/** The kinds a hero can throw; a boss will not be, nor a sack imp, which is never dazed. */
export const THROWABLE: Readonly<Record<EnemyKind, boolean>> = {
  ravager: true,
  imp: false,
};

// ---- the enemies ----
/** A sack imp (`imps.ts`) is no fighter: it crosses the screen with magic pots for the heroes to kick out of it. */
export const ENEMY_KINDS = ["ravager", "imp"] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];
/** The kinds that fight, which a wave is made of and holds the screen for. */
export type FoeKind = Exclude<EnemyKind, "imp">;
/** A kind's hit points at its lowest tier with one hero; `enemyMaxHp` scales them. An imp takes no damage. */
export const ENEMY_HP: Readonly<Record<EnemyKind, number>> = {
  ravager: 40,
  imp: 4,
};
/** Tiers by palette (ash, rust, violet): each adds hit points, and aggression (`RAVAGER`). */
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

// ---- how ravagers fight (`ai.ts`) ----
/** At most this many enemies go for one hero at once; the rest hover at a distance until a place comes free. */
export const ATTACKERS = 2;
/**
 * A tier's fight: steps of the telegraphed wind-up, the steps an idle enemy waits before it next decides (plus a
 * random part under `jitter`), its walk along the road and in depth, the mace's damage, and the chance in 256 that
 * a wind-up is a feint that backs off instead.
 */
export interface Fighter {
  readonly windup: number;
  readonly think: number;
  readonly jitter: number;
  readonly walk: { readonly x: number; readonly y: number };
  readonly damage: number;
  readonly feint: number;
}
const fighter = (
  windup: number,
  think: number,
  jitter: number,
  walk: number,
  damage: number,
  feint: number,
): Fighter => ({
  windup,
  think,
  jitter,
  walk: { x: px(walk), y: px((walk * 2) / 3) },
  damage,
  feint,
});
/**
 * Ash, rust and violet: each winds up faster, decides sooner, walks faster (in depth two thirds as fast) and hits
 * harder than the one before, and feints more often.
 */
export const RAVAGER: Readonly<Record<Tier, Fighter>> = {
  0: fighter(24, 24, 32, 0.6, 6, 24),
  1: fighter(20, 16, 24, 0.7, 7, 36),
  2: fighter(16, 8, 16, 0.8, 8, 48),
};
/** Steps the mace swings through after it lands (on the swing's first step), then steps of recovery. */
export const ATTACK_STEPS = 8;
export const RECOVER_STEPS = 16;
/** The mace reaches this far in front of the enemy's centre, in the depth lane, and sweeps this high. */
export const MACE_REACH = px(26);
export const MACE_HEIGHT = px(36);
/** An attacker heads for this far from its target along the road, and winds up once within `ENGAGE_SLACK` more and `AI_LANE` in depth. */
export const ENGAGE_X = px(24);
export const ENGAGE_SLACK = px(6);
export const AI_LANE = px(2);
/** An attacker crossing to a hero's far side walks round it this far out of its lane. */
export const DODGE = px(16);
/** One with no place to attack hovers this far from the nearest hero along the road, plus up to `HOVER_SPREAD`. */
export const HOVER_X = px(64);
export const HOVER_SPREAD = px(32);
/** A feint breaks off the wind-up on this step and backs off this far, facing the hero. */
export const FEINT_AT = 8;
export const BACKSTEP = px(24);

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

// ---- sack imps, floor items and magic pots (`imps.ts`) ----
/** The most magic pots each hero carries: Rhea holds the most, Gorm the fewest. */
export const MAX_POTS: Readonly<Record<HeroKind, number>> = {
  brakka: 4,
  rhea: 6,
  gorm: 3,
};
/** The most pots one imp carries in its sack. */
export const IMP_POTS = 3;
/**
 * An imp scurries along the road at `IMP_WALK`, zig-zagging in depth at `IMP_ZIG_Y` and turning every `IMP_ZIG`
 * steps; kicked, it stumbles for `IMP_STUMBLE_STEPS` (or flies, then lies `IMP_DOWN_STEPS` and gets up), then flees
 * at `IMP_FLEE`, faster than any hero walks.
 */
export const IMP_WALK = px(0.9);
export const IMP_ZIG_Y = px(0.25);
export const IMP_ZIG = 24;
export const IMP_STUMBLE_STEPS = 16;
export const IMP_DOWN_STEPS = 24;
export const IMP_FLEE = px(1.6);
/** How high above an imp's feet a kick's spark appears: it is half a ravager's height. */
export const IMP_SPARK = px(14);
/** Kinds of things lying on the floor: magic pots now, meat at camp later. */
export const ITEM_KINDS = ["pot"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
/** The most items the world holds at once: a new one past it takes the place of the oldest. */
export const ITEM_MAX = 16;
/** A dropped pot leaves the sack this high, popping up at `POT_POP` and falling under gravity. */
export const POT_LIFT = px(12);
export const POT_POP = px(1.5);
/** Steps an item lies before it vanishes, blinking through the last `ITEM_BLINK` of them. */
export const ITEM_LIFE = 10 * STEPS_PER_SECOND;
export const ITEM_BLINK = 2 * STEPS_PER_SECOND;
/** A hero on its feet picks an item up when its feet are this close to it along the road and in depth. */
export const PICKUP_X = px(10);
export const PICKUP_Y = px(5);

// ---- effects ----
/** Steps a hit spark lives, and the most the world keeps at once (the oldest go first). */
export const FX_LIFE = 20;
export const FX_MAX = 32;
/** How high above the target's feet a spark appears: where the blade meets the body. */
export const SPARK_HEIGHT = px(28);
