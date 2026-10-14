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
/** Stage 1, Ashen Village: four screens of road. Each stage has its own (`STAGES` in `stages.ts`, `planOf`). */
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
/** The kinds a hero can throw: not a boss, nor a sack imp, which is never dazed (nor a bone pile, never dazed either). */
export const THROWABLE: Readonly<Record<EnemyKind, boolean>> = {
  ravager: true,
  imp: false,
  ogre: false,
  lancer: true,
  captain: false,
  bonewalker: true,
  vorhal: false,
};

// ---- the enemies ----
/**
 * A sack imp (`imps.ts`) is no fighter: it crosses the screen with magic pots for the heroes to kick out of it. An
 * ogre (`ogre.ts`) is Stage 1's boss, one of the twins. A lancer (`lancer.ts`) fights with a spear and leaps in, and
 * the lancer captain, Wyrmbone Pass's boss, is one who rides an ember drake. A bonewalker (`bonewalker.ts`), the
 * Drowned Crypt's skeleton swordsman, claws up out of a grave and pulls itself together once from its bones. Vorhal
 * (`vorhal.ts`) is the final boss, in his keep.
 */
export const ENEMY_KINDS = [
  "ravager",
  "imp",
  "ogre",
  "lancer",
  "captain",
  "bonewalker",
  "vorhal",
] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];
/** The kinds that fight, which a wave is made of and holds the screen for. */
export type FoeKind = Exclude<EnemyKind, "imp">;
/** The bosses: no tier but a palette, super armour, and a cap on what a spell takes (`BOSS_SHARE`). */
export const BOSS: Readonly<Record<EnemyKind, boolean>> = {
  ravager: false,
  imp: false,
  ogre: true,
  lancer: false,
  captain: true,
  bonewalker: false,
  vorhal: true,
};
/** A kind's hit points at its lowest tier with one hero; `enemyMaxHp` scales them. An imp takes no damage. */
export const ENEMY_HP: Readonly<Record<EnemyKind, number>> = {
  ravager: 40,
  imp: 4,
  ogre: 150,
  lancer: 32,
  captain: 180,
  bonewalker: 32,
  vorhal: 260,
};
/** Tiers by palette (ash, rust, violet): each adds hit points, and aggression (`RAVAGER`). */
export const TIERS = [0, 1, 2] as const;
export type Tier = (typeof TIERS)[number];
/** Each tier's hit points in quarters of the kind's base. */
export const TIER_HP: Readonly<Record<Tier, number>> = { 0: 4, 1: 5, 2: 6 };
/**
 * An enemy's full hit points: its kind's base by its tier (a boss's tier is only its palette), and a quarter more for
 * each hero beyond the first (an empty world counts one), in whole points. A party of five meets ravagers with twice
 * the hit points.
 */
export function enemyMaxHp(
  kind: EnemyKind,
  tier: Tier,
  heroes: number,
): number {
  const party = Math.min(Math.max(heroes, 1), CAPACITY),
    quarters = BOSS[kind] ? TIER_HP[0] : TIER_HP[tier];
  return Math.trunc((ENEMY_HP[kind] * quarters * (3 + party)) / 16);
}
/**
 * The most enemies a world holds at once, a defeated one that has not blinked out yet included. `spawnEnemy` refuses
 * the next one, so the checkpoint codec's bound on the list (and on the ones a swing has hit) is one no run can pass.
 */
export const ENEMY_MAX = 64;
/** An enemy's body: half its width either side of its centre, and its height above its feet. */
export const ENEMY_HALF_W = px(10);
export const ENEMY_HEIGHT = px(44);
/** Each kind's body, half-width and height: an ogre is half as big again as a ravager. */
export const ENEMY_BODY: Readonly<
  Record<EnemyKind, { readonly half: number; readonly height: number }>
> = {
  ravager: { half: ENEMY_HALF_W, height: ENEMY_HEIGHT },
  imp: { half: ENEMY_HALF_W, height: ENEMY_HEIGHT },
  ogre: { half: px(15), height: px(66) },
  lancer: { half: ENEMY_HALF_W, height: ENEMY_HEIGHT },
  captain: { half: ENEMY_HALF_W, height: ENEMY_HEIGHT },
  bonewalker: { half: ENEMY_HALF_W, height: ENEMY_HEIGHT },
  vorhal: { half: px(14), height: px(64) },
};
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

// ---- how the Ogre twins fight (`ogre.ts`) ----
/**
 * An ogre calm and enraged (once its twin has fallen): its slam's wind-up, its pause, its slow walk and the slam's
 * damage. It never feints.
 */
export const OGRE: Readonly<Record<"calm" | "rage", Fighter>> = {
  calm: fighter(48, 30, 24, 0.45, 14, 0),
  rage: fighter(32, 16, 16, 0.6, 16, 0),
};
/** The fighter an enemy is: its tier's ravager, lancer or bonewalker, an ogre's mood, or the captain. */
export const fighterOf = (
  kind: EnemyKind,
  tier: Tier,
  enraged: boolean,
): Fighter =>
  kind === "ogre"
    ? OGRE[enraged ? "rage" : "calm"]
    : kind === "vorhal"
      ? VORHAL[enraged ? "rage" : "calm"]
      : kind === "captain"
        ? CAPTAIN
        : kind === "lancer"
          ? LANCER[tier]
          : kind === "bonewalker"
            ? BONEWALKER[tier]
            : RAVAGER[tier];
/** It walks to stand this far from its hero along the road, and winds up within `OGRE_SLACK` more and `OGRE_LANE` in depth. */
export const OGRE_ENGAGE = px(30);
export const OGRE_SLACK = px(10);
export const OGRE_LANE = px(3);
/** The slam lands on the attack's first step: this far in front, this wide either side in depth, and this high. */
export const SLAM_REACH = px(46);
export const SLAM_LANE = px(10);
export const SLAM_HEIGHT = px(48);
/** Steps the hammer stays down after it lands; the shockwave runs through the first `QUAKE_STEPS` of them. */
export const SLAM_STEPS = 28;
/**
 * The shockwave runs on along the floor from the slam's reach at `QUAKE_SPEED` a step, in the ogre's depth lane:
 * every hero on the floor (not one in the air) it passes takes `QUAKE_DAMAGE` and is knocked down.
 */
export const QUAKE_SPEED = px(2.5);
export const QUAKE_STEPS = 24;
export const QUAKE_DAMAGE = 8;
/**
 * A hero within `BEHIND` behind an ogre (in `SWEEP_LANE`) as it decides or walks draws the sweep: a round swing of the
 * hammer landing `SWEEP_WINDUP` steps in on every hero within `SWEEP_REACH` either side.
 */
export const BEHIND = px(32);
export const SWEEP_REACH = px(40);
export const SWEEP_LANE = px(8);
export const SWEEP_WINDUP = 16;
export const SWEEP_STEPS = 32;
export const SWEEP_DAMAGE = 10;
/** Steps an ogre stands open after a slam or a sweep, and staggers from a heavy blow. */
export const OGRE_RECOVER = 40;
export const STAGGER_STEPS = 18;
/** A heavy blow knocks an ogre down once it has taken a `POISE`th of its full hit points since it last fell. */
export const POISE = 4;
/** A spell takes at most `BOSS_SHARE` sixteenths of a boss's full hit points (`SHARE`), whatever its level. */
export const BOSS_SHARE = 2;

// ---- how lancers fight (`lancer.ts`) ----
/**
 * A lancer by tier (ash, rust, violet): lighter than a ravager of its palette (`ENEMY_HP`) and quicker on its feet,
 * though never faster than a hero walks, its spear's thrust wound up a little longer than the mace and lighter. It
 * never feints: it leaps instead.
 */
export const LANCER: Readonly<Record<Tier, Fighter>> = {
  0: fighter(28, 20, 28, 0.8, 5, 0),
  1: fighter(24, 14, 20, 0.9, 6, 0),
  2: fighter(20, 8, 14, 1, 7, 0),
};
/**
 * The spear lands on the thrust's first step: this far in front of the lancer's centre (about 1.6 maces), in a lane
 * thinner than a blade's, and as high as the mace sweeps.
 */
export const SPEAR_REACH = px(42);
export const SPEAR_LANE = px(4);
/** Steps the spear stays out after it lands, then steps the lancer stands open. */
export const THRUST_STEPS = 10;
export const LANCE_RECOVER = 24;
/**
 * It walks to stand `LANCE_ENGAGE` from its hero along the road, near the edge of its reach, and thrusts lined up within
 * `LANCE_SLACK` beyond it and `AI_LANE` in depth; a hero closer than `LANCE_NEAR` it backs away from first, unless the
 * screen's edge stops it.
 */
export const LANCE_ENGAGE = px(36);
export const LANCE_SLACK = px(6);
export const LANCE_NEAR = px(24);
/**
 * A hero further than `LEAP_FAR` along the road is leapt at, as a wave's lancer leaps in from the screen's edge: a
 * hero's jump (`JUMP_VZ` under `GRAVITY`, `LEAP_STEPS` in the air), carrying no more than the fastest run along the
 * road (`LEAP_VX`) and a walk in depth (`LEAP_VY`), to land `LEAP_LAND` in front of the hero.
 */
export const LEAP_FAR = px(80);
export const LEAP_VX = px(2.25);
export const LEAP_VY = px(0.75);
export const LEAP_LAND = px(24);
/** A jump's steps in the air: the step its height first comes back down to the floor. */
export const LEAP_STEPS = 1 + Math.ceil((2 * JUMP_VZ) / GRAVITY);
/**
 * Landing, it drives the spear down in front (`plunge`): every hero within `PLUNGE_REACH`, in the lane, is knocked down
 * with the thrust's damage. It stands over the spear for `PLUNGE_STEPS`, open.
 */
export const PLUNGE_REACH = px(28);
export const PLUNGE_STEPS = 24;

// ---- the lancer captain (`lancer.ts`), Wyrmbone Pass's boss ----
/**
 * A lancer quicker and harder than a violet one (his tier only his palette), with a boss's hit points, and on foot a
 * boss's armour and poise (an ogre's: `POISE`, `BOSS_SHARE`). On his ember drake he thrusts from the saddle at a hero
 * within `SPEAR_REACH` in front, `LANCE_CHANCE` times in 256 where the drake would breathe (`lance`: it lands
 * `LANCE_WINDUP` steps in, lasts `LANCE_STEPS`, then he is open for `LANCE_COOL`). His leap lands harder: the plunge
 * reaches `reach` in front and `lane` either side, with `damage`. A
 * heavy blow his armour takes staggers him for `STAGGER_STEPS`; on foot he climbs back on a riderless drake within
 * `REMOUNT_X` along the road, once.
 */
export const CAPTAIN: Fighter = fighter(22, 12, 14, 1, 9, 0);
export const LANCE_WINDUP = 24;
export const LANCE_STEPS = 36;
export const LANCE_COOL = 40;
export const LANCE_CHANCE = 96;
export const CAPTAIN_PLUNGE = { reach: px(40), lane: px(10), damage: 14 };
export const REMOUNT_X = px(200);

// ---- bonewalkers (`bonewalker.ts`), the Drowned Crypt's ----
/**
 * A bonewalker by tier (bone, rust, and the armoured violet knight): lighter than a ravager of its palette
 * (`ENEMY_HP`), its sword wound up faster; the knight walks slower and hits hardest, and never feints. It swings as a
 * ravager does (`act`), its sword reaching `BONE_REACH` in front.
 */
export const BONEWALKER: Readonly<Record<Tier, Fighter>> = {
  0: fighter(18, 20, 24, 0.7, 5, 16),
  1: fighter(15, 14, 20, 0.8, 6, 24),
  2: fighter(14, 12, 16, 0.7, 9, 0),
};
export const BONE_REACH: Readonly<Record<Tier, number>> = {
  0: px(28),
  1: px(28),
  2: px(38),
};
/**
 * One clawing up out of its grave rises for `RISE_STEPS`, invulnerable. The first time it falls with no hit points it
 * lies as a bone pile for `PILE_STEPS`, then pulls itself together over `REASSEMBLE_STEPS` (invulnerable, as one
 * getting up is) with half its full hit points; any blow on the pile shatters it for good.
 */
export const RISE_STEPS = 60;
export const PILE_STEPS = 150;
export const REASSEMBLE_STEPS = 30;

// ---- Vorhal (`vorhal.ts`), the final boss ----
/**
 * Vorhal as he starts and from half his hit points on (`enraged`, his second phase): his greatsword's wind-up, his
 * pause between moves, his walk and the first cut's damage. He never feints.
 */
export const VORHAL: Readonly<Record<"calm" | "rage", Fighter>> = {
  calm: fighter(34, 30, 20, 0.6, 8, 0),
  rage: fighter(24, 16, 12, 0.75, 10, 0),
};
/** He walks to stand `VORHAL_ENGAGE` from his hero, winding up within `VORHAL_SLACK` more and `VORHAL_LANE` in depth. */
export const VORHAL_ENGAGE = px(34);
export const VORHAL_SLACK = px(10);
export const VORHAL_LANE = px(3);
/** A walk after a hero who keeps away ends after `VORHAL_CHASE` steps, and he decides again. */
export const VORHAL_CHASE = 150;
/**
 * The greatsword's two cuts: each lands on its first step on every hero in front within `CUT_REACH`, `CUT_LANE` either
 * side in depth and under `CUT_HEIGHT`; the second follows `CUT_GAP` steps after the first, harder (`CUT2_DAMAGE` more),
 * and knocks down. It is held out `CUT_STEPS`, then he stands open for `VORHAL_RECOVER`.
 */
export const CUT_REACH = px(50);
export const CUT_LANE = px(10);
export const CUT_HEIGHT = px(40);
export const CUT_GAP = 14;
export const CUT_STEPS = 18;
export const CUT2_DAMAGE = 4;
export const VORHAL_RECOVER = 36;
/**
 * The fire spell: he raises his hand, and on `CAST_MARK` marks a sigil under each hero on its feet (the first up to the
 * count, round the party from a seat drawn at random: `SIGILS` and one more by chance, in his second phase `SIGILS + 1`
 * and one more), and any left on the floor at random; he stands casting until `CAST_STEPS`. A sigil glows for
 * `SIGIL_DELAY` steps, then a pillar of fire erupts from it and burns for `PILLAR_STEPS`: every hero on or over it
 * (within `PILLAR_HALF` along the road and `PILLAR_LANE` in depth) takes `PILLAR_DAMAGE` and is knocked down. He casts
 * only while no sigil is left.
 */
export const CAST_MARK = 20;
export const CAST_STEPS = 44;
export const SIGILS = 2;
export const SIGIL_MAX = 4;
export const SIGIL_DELAY = 54;
export const PILLAR_STEPS = 30;
export const SIGIL_LIFE = SIGIL_DELAY + PILLAR_STEPS;
export const PILLAR_HALF = px(9);
export const PILLAR_LANE = px(6);
export const PILLAR_DAMAGE = 10;
/**
 * The summons: he raises his sword, and on `SUMMON_AT` `SUMMONED` bonewalkers claw up out of the slabs on screen (none
 * where one is still rising), ash and in his second phase rust; he stands until `SUMMON_STEPS`. He summons only while
 * fewer than `SUMMON_CAP` bonewalkers stand.
 */
export const SUMMON_AT = 24;
export const SUMMON_STEPS = 48;
export const SUMMONED = 2;
export const SUMMON_CAP = 3;
/**
 * How he picks a move, in 256ths, calm and enraged: the fire spell, the summons, else the greatsword. With his back
 * within `CORNER_X` of the screen's edge and a hero within `CORNER_NEAR` in front, he leaps over to `VAULT_INSET` inside
 * the far edge instead, `VAULT_CHANCE` times in 256: a jump of `VAULT_VZ` under gravity, `VAULT_STEPS` in the air.
 */
export const VORHAL_MOVES = {
  calm: { cast: 60, summon: 36 },
  rage: { cast: 76, summon: 64 },
} as const;
export const CORNER_X = px(56);
export const CORNER_NEAR = px(72);
export const VAULT_CHANCE = 160;
export const VAULT_INSET = px(56);
export const VAULT_VZ = px(4.5);
export const VAULT_STEPS = 1 + Math.ceil((2 * VAULT_VZ) / GRAVITY);
/** At half his hit points he roars for `ROAR_STEPS`, nothing landing on him, and fights on enraged. */
export const ROAR_STEPS = 60;

// ---- mounts (`mount.ts`) ----
/** The beasts a hero or an enemy rides: a clawbeak, which sweeps its tail round it, and an ember drake, breathing fire. */
export const MOUNT_KINDS = ["clawbeak", "drake"] as const;
export type MountKind = (typeof MOUNT_KINDS)[number];
/** The most beasts a world holds at once: a wave's rider past it walks in on foot. */
export const MOUNT_MAX = 8;
/** The saddle's height over the beast's feet, where the view draws its rider; the rules stand the rider on its floor. */
export const SADDLE = px(14);
/** Half a beast's width either side of its centre, and its walk ridden by anyone: Rhea's pace, slower than any run. */
export const BEAST_HALF_W = px(14);
export const BEAST_WALK = { x: px(1.25), y: px(0.75) } as const;
/**
 * The tail sweep: wound up for `TAIL_WINDUP` steps, it lands on that step on every foe on the floor or low in the air
 * (under `TAIL_HEIGHT`) within `TAIL_REACH` of the beast either side and `TAIL_LANE` in depth, knocking it down with
 * `TAIL_DAMAGE`, and lasts `TAIL_STEPS`. The beast sweeps again no sooner than `TAIL_COOL` after one ends or is broken
 * off; an enemy's stands open that long.
 */
export const TAIL_WINDUP = 20;
export const TAIL_STEPS = 32;
export const TAIL_REACH = px(36);
export const TAIL_LANE = px(8);
export const TAIL_HEIGHT = px(32);
export const TAIL_DAMAGE = 10;
export const TAIL_COOL = 30;
/** An enemy's beast walks to stand this far from its hero along the road, in its lane: a clawbeak, and an ember drake. */
export const TAIL_STAND = px(24);
export const DRAKE_STAND = px(56);
/**
 * The ember drake's breath: it inhales for `DRAKE_INHALE` steps, then breathes a stream of fire along its facing for
 * `FLAME_STEPS`. The flame runs out from its mouth (`BEAST_HALF_W` in front of its centre) at `FLAME_SPEED` a step to
 * `FLAME_LENGTH`, holds, and draws back as the breath ends (`flameAt`). Every foe on the floor or low in the air (under
 * `FLAME_HEIGHT`) it reaches within `FLAME_LANE` in depth is burned for `FLAME_DAMAGE` and knocked down along the
 * drake's facing, once a breath; nothing blocks it. It breathes again no sooner than `DRAKE_COOL` after; an enemy's
 * stands open that long.
 */
export const DRAKE_INHALE = 32;
export const FLAME_STEPS = 48;
export const FLAME_SPEED = px(4);
export const FLAME_LENGTH = px(72);
export const FLAME_LANE = px(8);
export const FLAME_HEIGHT = px(28);
export const FLAME_DAMAGE = 10;
export const DRAKE_COOL = 60;
/** How far in front of a breathing drake's centre its flame reaches `timer` steps into the breath: 0 while it inhales. */
export function flameAt(timer: number): number {
  const t = timer - DRAKE_INHALE;
  if (!(t >= 0 && t < FLAME_STEPS)) return 0;
  return (
    BEAST_HALF_W +
    Math.min(FLAME_LENGTH, FLAME_SPEED * Math.min(t + 1, FLAME_STEPS - t))
  );
}
/** Every blow a beast's pair strikes, by its state: the step it lands on (a flame's first), its length, its cool-down. */
export const BEAST_BLOWS = {
  sweep: { windup: TAIL_WINDUP, steps: TAIL_STEPS, cool: TAIL_COOL },
  breathe: {
    windup: DRAKE_INHALE,
    steps: DRAKE_INHALE + FLAME_STEPS,
    cool: DRAKE_COOL,
  },
  lance: { windup: LANCE_WINDUP, steps: LANCE_STEPS, cool: LANCE_COOL },
} as const;
export type BeastBlow = keyof typeof BEAST_BLOWS;
/** The longest a beast cools after a blow. */
export const BEAST_COOL = Math.max(TAIL_COOL, DRAKE_COOL, LANCE_COOL);
/** Each kind's own blow, which a hero riding it strikes with Attack. */
export const BEAST_BLOW: Readonly<Record<MountKind, BeastBlow>> = {
  clawbeak: "sweep",
  drake: "breathe",
};
/** A hero standing this close to a riderless beast along the road, in its lane (`LANE`), climbs on with Jump. */
export const BOARD_X = px(24);
/**
 * A beast that loses its rider to a blow panics, running from it at `PANIC_RUN` for `PANIC_STEPS` (no shorter than a
 * hop, `LEAP_STEPS`, so one thrown out of a hop lands panicking); riderless it wanders at `WANDER`, turning every
 * `WANDER_TURN` steps, and after `STRAY_STEPS` with nobody on it leaves the screen.
 */
export const PANIC_RUN = px(2);
export const PANIC_STEPS = 40;
export const WANDER = px(0.5);
export const WANDER_TURN = 64;
export const STRAY_STEPS = 10 * 60;

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
/** Kinds of things lying on the floor: magic pots, and the meat a sack imp spills at camp. */
export const ITEM_KINDS = ["pot", "meat"] as const;
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
/** The hit points meat gives back, up to the hero's whole health: a quarter of Brakka's. */
export const MEAT_HEAL = 15;

// ---- camp between stages (`camp.ts`) ----
/** The longest camp lasts: 20 s. It ends sooner once its imps have gone and nothing is left lying on the floor. */
export const CAMP_STEPS = 20 * STEPS_PER_SECOND;

// ---- magic (`magic.ts`) ----
/**
 * Magic held for no more than this many steps from the start of the charge is a tap, which casts every pot held.
 * Held longer, the level chosen is 1 and rises by one every `CHARGE_STEPS` more, up to the pots held: let go to cast
 * it and keep the rest.
 */
export const MAGIC_TAP = 12;
export const CHARGE_STEPS = 20;
/** Each hero's spell: Brakka's storm, Rhea's fire and Gorm's earth. */
export const SPELL_KINDS = ["storm", "fire", "earth"] as const;
export type SpellKind = (typeof SPELL_KINDS)[number];
/**
 * One level of a spell: the steps the hero casts it (invulnerable throughout), the step of those its blow lands on
 * every fighting enemy on screen (they stand frozen until it does), and the blow, in sixteenths of each enemy's full
 * hit points (`SHARE`), so it reads the same at every tier and party size. Every level knocks down.
 */
export interface SpellLevel {
  readonly steps: number;
  readonly hit: number;
  readonly share: number;
}
export const SHARE = 16;
const spell = (steps: number, hit: number, share: number): SpellLevel => ({
  steps,
  hit,
  share,
});
/**
 * A hero's spell by level, one level for each pot it can hold (`MAX_POTS`): level 1 is a panic button that knocks
 * the screen down, the top level leaves a fresh wave a blow from gone. Gorm's is strongest at every level, Rhea's
 * has the most levels, and each lasts 1.5–2.5 s.
 */
export const SPELLS: Readonly<
  Record<
    HeroKind,
    { readonly kind: SpellKind; readonly levels: readonly SpellLevel[] }
  >
> = {
  brakka: {
    kind: "storm",
    levels: [
      spell(90, 48, 4),
      spell(102, 56, 7),
      spell(114, 64, 10),
      spell(132, 76, 13),
    ],
  },
  rhea: {
    kind: "fire",
    levels: [
      ...[spell(90, 48, 3), spell(98, 54, 5), spell(106, 60, 7)],
      ...[spell(114, 66, 9), spell(126, 74, 12), spell(150, 90, 15)],
    ],
  },
  gorm: {
    kind: "earth",
    levels: [spell(96, 54, 5), spell(114, 66, 9), spell(138, 84, 14)],
  },
};

// ---- effects ----
/** Steps a hit spark lives, and the most the world keeps at once (the oldest go first). */
export const FX_LIFE = 20;
export const FX_MAX = 32;
/** How high above the target's feet a spark appears: where the blade meets the body. */
export const SPARK_HEIGHT = px(28);
