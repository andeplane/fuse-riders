import {
  CAPACITY,
  ENEMY_BODY,
  FX_MAX,
  ENEMY_KINDS,
  ENEMY_MAX,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  HEAVY_HITSTOP,
  HERO_HP,
  HERO_KINDS,
  IMP_POTS,
  KNOCK_VX,
  KNOCK_VZ,
  LIVES,
  MAX_POTS,
  SADDLE,
  SUB,
  TAIL_COOL,
  TAIL_WINDUP,
  TIERS,
  VIEW_W,
  enemyMaxHp,
  fighterOf,
  px,
  type EnemyKind,
  type HeroKind,
  type ItemKind,
  type MountKind,
  type Tier,
} from "./tuning.js";
import { clamp } from "./math.js";
import { STAGES, planOf } from "./stages.js";

/**
 * One run's world: plain integer data, so the netcode can clone, hash and checkpoint it. Space is `x` along the
 * road, `y` depth on the floor band (larger is nearer the viewer) and `z` height above the floor, all in sub-units;
 * the camera's left edge is `camX`. Heroes are kept in id order, which is seat order; enemies follow in id order,
 * the order they spawned in, and items on the floor and beasts in theirs: one id sequence for them all.
 */
export const HERO_STATES = [
  "idle",
  "walk",
  "jump",
  "land",
  "attack1",
  "attack2",
  "attack3",
  "hurt",
  "knockdown",
  "down",
  "getup",
  "dead",
  "respawn",
  "out",
  "run",
  "dash",
  "jumpattack",
  "backattack",
  "grab",
  "throw",
  "charge",
  "cast",
  "ride",
] as const;
export type HeroState = (typeof HERO_STATES)[number];

export interface Hero {
  id: number;
  seat: number;
  kind: HeroKind;
  x: number;
  y: number;
  z: number;
  /** Velocity along the road and in depth: the walk or run this step, a dash's slide, or the momentum a jump keeps. */
  vx: number;
  vy: number;
  vz: number;
  facing: 1 | -1;
  state: HeroState;
  /** Steps since `state` began. */
  timer: number;
  /** The bits held on the previous step, which the next step derives presses from. */
  held: number;
  /** Steps an Attack or a Jump press stays usable for (0: none waiting). */
  attackBuf: number;
  jumpBuf: number;
  /** Hit-stop: the hero holds still on every step up to and including this one. */
  stopUntil: number;
  /** The enemies this swing has hit, in id order, so none is hit twice by one swing. Replaced, never mutated. */
  struck: number[];
  /** Tallies for the HUD: hit points taken from enemies, and enemies knocked down. */
  damage: number;
  knockdowns: number;
  /** Hit points left in this life, and lives left, this one included: a hero with none is `out`. */
  hp: number;
  lives: number;
  /** No mace lands on the hero up to and including this step: getting up, and after dropping back in. */
  invulnUntil: number;
  /** Hits taken in a row, each within `JUGGLE_WINDOW` of the one before; that window closes after `staggerUntil`. */
  stagger: number;
  staggerUntil: number;
  /**
   * The run's double tap (`RUN_TAP`, `RUN_GAP`): `tap` is the direction (`LEFT` or `RIGHT`, 0 for none) pressed last,
   * and `tapUntil` the last step that counts. While the direction is held it must be let go by then to be a tap;
   * once it is, a second press by then is the double tap.
   */
  tap: number;
  tapUntil: number;
  /** Steps a double tap stays usable (0: none waiting): a free hero starts its run toward `tap`. */
  runBuf: number;
  /** Enemies thrown: a count for a tally to show once one wants it. The stage's bank takes only damage and knockdowns. */
  throws: number;
  /**
   * Magic pots held, up to `MAX_POTS` for the hero's kind: picked up from the floor (`imps.ts`). A hero keeps them
   * through a lost life and a continue, as in the original; casting spends them.
   */
  pots: number;
  /** Steps a Magic press stays usable for (0: none waiting), as `attackBuf` does. */
  magicBuf: number;
  /** Tallies: spells cast, and the hit points they took (counted in `damage` too). */
  casts: number;
  magicDamage: number;
}

/**
 * An enemy's states. `ride` is a ravager's alone (`mount.ts`): it sits a beast's saddle, and no other kind mounts one
 * (`OGRE_STATES` and `LANCER_STATES` leave it out, as the checkpoint does for an imp).
 */
export const ENEMY_STATES = [
  "idle",
  "hurt",
  "knockdown",
  "down",
  "getup",
  "dead",
  "enter",
  "walk",
  "windup",
  "attack",
  "recover",
  "held",
  "thrown",
  "stumble",
  "flee",
  "slam",
  "sweep",
  "stagger",
  "thrust",
  "leap",
  "plunge",
  "ride",
] as const;
export type EnemyState = (typeof ENEMY_STATES)[number];
/**
 * A lancer's states (`lancer.ts`): a ravager's, but it `thrust`s its spear where a ravager swings (`attack`), and it
 * `leap`s in from the screen's edge or at a hero out of reach, driving the spear down as it lands (`plunge`). Those
 * three are the lancer's alone (`LANCER_ONLY`).
 */
export const LANCER_ONLY: readonly EnemyState[] = ["thrust", "leap", "plunge"];
/**
 * A sack imp's states (`imps.ts`): it scurries (`walk`), stumbles from a kick or flies, lies and gets up from a heavy
 * one, then flees. `stumble` and `flee` are the imp's alone (`IMP_ONLY`).
 */
export const IMP_STATES: readonly EnemyState[] = [
  "walk",
  "stumble",
  "knockdown",
  "down",
  "getup",
  "flee",
];
export const IMP_ONLY: readonly EnemyState[] = ["stumble", "flee"];
/**
 * An ogre's states (`ogre.ts`): it walks in, walks and stands; winds up its slam, slams, sweeps and recovers; staggers
 * from a heavy blow; and is knocked down, lies, gets up or falls for good. It never reels, nor is held or thrown.
 * `slam`, `sweep` and `stagger` are the ogre's alone (`OGRE_ONLY`).
 */
export const OGRE_STATES: readonly EnemyState[] = ENEMY_STATES.filter(
  (state) =>
    ![
      ...["hurt", "attack", "held", "thrown", "ride"],
      ...IMP_ONLY,
      ...LANCER_ONLY,
    ].includes(state),
);
export const OGRE_ONLY: readonly EnemyState[] = ["slam", "sweep", "stagger"];
export const LANCER_STATES: readonly EnemyState[] = ENEMY_STATES.filter(
  (state) => !["attack", "ride", ...IMP_ONLY, ...OGRE_ONLY].includes(state),
);

/**
 * A beast's states with a rider on it (`RIDDEN`: only an enemy's walks in, only a hero's hops), then riderless: it
 * panics (`flee`), wanders or leaves.
 */
export const MOUNT_STATES = [
  ...["enter", "idle", "walk", "sweep", "hop"],
  ...["flee", "wander", "leave"],
] as const;
export type MountState = (typeof MOUNT_STATES)[number];
export const RIDDEN: readonly MountState[] = MOUNT_STATES.slice(0, 5);

/**
 * A beast to ride (`mount.ts`). Its rider, a hero or an enemy in `ride`, stands where it does, at its height (the view
 * lifts the rider into the saddle), and moves with it. It takes no blow itself, and stands on the floor (`z` 0) but in
 * a hero's hop, or coming down from one its rider was thrown out of.
 */
export interface Mount {
  id: number;
  kind: MountKind;
  x: number;
  y: number;
  z: number;
  /** A hero's beast's walk this step, or the momentum its hop keeps (0 for any other), and a hop's rise and fall. */
  vx: number;
  vy: number;
  vz: number;
  facing: 1 | -1;
  state: MountState;
  /** Steps since `state` began. */
  timer: number;
  /** Who rides it: a hero's or an enemy's id, or 0 for nobody. */
  rider: number;
  /** The x a wave's beast walks in to. */
  goal: number;
  /** The beast sweeps its tail again no sooner than this step. */
  coolUntil: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  /** A nudge's, a knockdown's or a lancer's leap's speed along the road, and a knockdown's or a leap's rise and fall. */
  vx: number;
  vz: number;
  facing: 1 | -1;
  hp: number;
  state: EnemyState;
  /** Steps since `state` began. */
  timer: number;
  /** Hit-stop: the enemy holds still on every step up to and including this one. */
  stopUntil: number;
  tier: Tier;
  /**
   * The x an `enter`ing or a walking enemy walks to, or a leaping lancer lands on, on screen, and the depth a walking
   * or leaping one does.
   */
  goal: number;
  goalY: number;
  /** The id of the hero it is going for, or 0 while it hovers or has no one. */
  target: number;
  /** An idle enemy decides what to do next on this step. */
  thinkAt: number;
  /** The id of the hero holding it in a grab (`held`) or who threw it (`thrown`), and 0 otherwise. */
  holder: number;
  /** The magic pots left in a sack imp's sack, up to `IMP_POTS`; 0 for every other kind. */
  pots: number;
  /** An ogre's poise: hit points taken since it last fell (`POISE`); 0 for every other kind. */
  poise: number;
  /** An ogre flashes from a blow its armour takes, without holding still, up to and including this step; else 0. */
  flashUntil: number;
  /** An ogre whose twin has fallen fights faster (`OGRE.rage`); false for every other kind. */
  enraged: boolean;
}

/**
 * Something lying on the floor for a hero to walk over and pick up: a magic pot kicked out of an imp. It pops out of
 * the sack at height `z`, rising at `vz` and falling under gravity, and vanishes `ITEM_LIFE` steps after `born`.
 */
export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  z: number;
  vz: number;
  born: number;
}

export const FX_KINDS = ["hit", "heavy", "ko"] as const;
export type FxKind = (typeof FX_KINDS)[number];

/** A hit spark where a blade landed, born on step `born` and dropped `FX_LIFE` steps later. */
export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  z: number;
  born: number;
}

/**
 * A spell playing (`magic.ts`): the hero casting it, its level (the pots it spent) and the step it was cast. The
 * hero's kind says which spell it is (`SPELLS`), and the level how long it plays and when its blow lands.
 */
export interface Spell {
  hero: number;
  level: number;
  born: number;
}

export interface World {
  seed: number;
  /** Steps since the run began. */
  step: number;
  /** The mulberry32 state (`rng.ts`): every random draw advances it, so rollback replays the same draws. */
  rng: number;
  /** The next entity id. */
  nextId: number;
  camX: number;
  heroes: Hero[];
  enemies: Enemy[];
  /** Effects, oldest first, at most `FX_MAX`. */
  fx: Fx[];
  /** The stage's waves begun: the next trigger is `planOf(world).waves[wave]`, the latest begun `wave - 1`. */
  wave: number;
  /** The latest wave is being fought: the camera holds at its trigger until every spawn is in and none is left. */
  locked: boolean;
  /** The step the latest wave began, which its spawns' delays count from. */
  waveStep: number;
  /** How many of the latest wave's spawns (`waveSpawns`) have entered, in their order. */
  spawned: number;
  /** After a wave short of the last is cleared, GO shows through this step and while the camera has not moved on. */
  goUntil: number;
  /** Items on the floor, in id order, at most `ITEM_MAX`. */
  items: Item[];
  /** How many of the stage's imp cues (`planOf(world).imps`) have sent their imp. */
  impsSent: number;
  /** Spells playing, in the order they were cast (heroes in id order within a step): one per hero in `cast`. */
  spells: Spell[];
  /** The stage the world is, from 1: its road, waves and imps are `STAGES[stage - 1]` (`planOf`). */
  stage: number;
  /** The beasts, in id order (their ids from the one sequence too), at most `MOUNT_MAX`. */
  mounts: Mount[];
  /** Camp after stage `stage` (`camp.ts`): one screen, no waves, only sack imps, and its own plan (`CAMP`). */
  camp: boolean;
}

/**
 * What a hero brings from the stage or the camp before: the lives it has left (at least one), its magic pots and its
 * hit points (at least one).
 */
export interface Carry {
  lives: number;
  pots: number;
  hp: number;
}

export interface HeroEntry {
  seat: number;
  kind: HeroKind;
  /** From a cleared stage; a hero setting out on a run has every life and no pots. */
  carry?: Carry;
}

/**
 * The stage flow's policy for a hero going on to camp and from camp to the next stage (design.md, "Stage flow"): it
 * keeps the lives it has, and one that went out comes back with one, and it keeps its magic pots and its health, as in
 * the original, so camp's meat is worth kicking for. One fallen (no hit points left) comes back at full health, as a
 * hero dropping back in does.
 */
export const carryOf = (hero: Hero): Carry => ({
  lives: Math.max(hero.lives, 1),
  pots: hero.pots,
  hp: hero.hp > 0 ? hero.hp : HERO_HP[hero.kind],
});

/** Where each seat's hero starts, in pixels: spread across the left of the screen and the depth of the floor. */
export const SPAWNS: readonly (readonly [number, number])[] = [
  [64, 138],
  [48, 116],
  [48, 160],
  [32, 127],
  [32, 149],
];
/** Where each seat's hero sits at camp, in pixels: round the fire in the middle of the clearing. */
export const CAMP_SPAWNS: readonly (readonly [number, number])[] = [
  [128, 136],
  [196, 136],
  [112, 158],
  [212, 158],
  [160, 166],
];

const whole = (value: number, low: number, high: number) =>
  Number.isInteger(value) && value >= low && value <= high;

/**
 * Stage `stage` (1 if not given) setting out, or with `camp` the camp after it, its heroes at their seats' spawns
 * (`SPAWNS`, at camp `CAMP_SPAWNS`), each with every life, full health and no pots or with what it carries from the
 * stage or camp before. Throws on a bad or repeated seat, an unknown kind, a stage `STAGES` lacks or a carry the
 * checkpoint would refuse (no life or hit point, more than the kind's health, or more pots than it holds).
 */
export function createWorld(options: {
  seed: number;
  heroes: readonly HeroEntry[];
  stage?: number;
  camp?: boolean;
}): World {
  const camp = options.camp ?? false;
  const stage = options.stage ?? 1;
  if (!whole(stage, 1, STAGES.length))
    throw new RangeError(`fuse-axe: no stage ${stage}`);
  const entries = [...options.heroes].sort((a, b) => a.seat - b.seat);
  entries.forEach((entry, index) => {
    if (
      !whole(entry.seat, 0, CAPACITY - 1) ||
      entries[index - 1]?.seat === entry.seat
    )
      throw new RangeError(`fuse-axe: bad or repeated seat ${entry.seat}`);
    if (!HERO_KINDS.includes(entry.kind))
      throw new RangeError(`fuse-axe: unknown hero kind ${entry.kind}`);
    const carry = entry.carry;
    if (
      carry &&
      (!whole(carry.lives, 1, LIVES) ||
        !whole(carry.pots, 0, MAX_POTS[entry.kind]) ||
        !whole(carry.hp, 1, HERO_HP[entry.kind]))
    )
      throw new RangeError(
        `fuse-axe: a ${entry.kind} carrying ${carry.lives} lives, ${carry.pots} pots and ${carry.hp} hp`,
      );
  });
  const heroes = entries.map((entry, index): Hero => {
    const [x, y] = (camp ? CAMP_SPAWNS : SPAWNS)[entry.seat]!;
    return {
      id: index + 1,
      seat: entry.seat,
      kind: entry.kind,
      x: px(x),
      y: px(y),
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      facing: 1,
      state: "idle",
      timer: 0,
      held: 0,
      attackBuf: 0,
      jumpBuf: 0,
      stopUntil: 0,
      struck: [],
      damage: 0,
      knockdowns: 0,
      hp: entry.carry?.hp ?? HERO_HP[entry.kind],
      lives: entry.carry?.lives ?? LIVES,
      invulnUntil: 0,
      stagger: 0,
      staggerUntil: 0,
      tap: 0,
      tapUntil: 0,
      runBuf: 0,
      throws: 0,
      pots: entry.carry?.pots ?? 0,
      magicBuf: 0,
      casts: 0,
      magicDamage: 0,
    };
  });
  return {
    seed: options.seed >>> 0,
    step: 0,
    rng: (options.seed ^ 0x5bd1e995) >>> 0,
    nextId: heroes.length + 1,
    camX: 0,
    heroes,
    enemies: [],
    fx: [],
    wave: 0,
    locked: false,
    waveStep: 0,
    spawned: 0,
    goUntil: 0,
    items: [],
    impsSent: 0,
    spells: [],
    stage,
    mounts: [],
    camp,
  };
}

/**
 * The stage is won: its last wave has been fought to the end. The stage flow takes the party on from here. A camp
 * has no waves and is never won (`campOver` ends it).
 */
export const stageCleared = (world: World): boolean =>
  !world.camp && world.wave === planOf(world).waves.length && !world.locked;

/** GO flashes after a wave short of the last is cleared, for `GO_STEPS` and while the camera has not moved on. */
export function showsGo(world: World): boolean {
  const { waves } = planOf(world);
  return (
    !world.locked &&
    world.wave > 0 &&
    world.wave < waves.length &&
    (world.step <= world.goUntil || world.camX === waves[world.wave - 1]!.at)
  );
}

/** Whether an enemy's whole body is on screen. */
export const inView = (world: World, enemy: Enemy): boolean =>
  enemy.x >= world.camX + ENEMY_BODY[enemy.kind].half &&
  enemy.x <= world.camX + VIEW_W * SUB - ENEMY_BODY[enemy.kind].half;

/**
 * A new enemy at full hit points for its tier and the party, with the world's next id, facing `facing`: a sack imp
 * scurrying that way with a full sack (`IMP_POTS`). The caller adds it to the world's enemies (which keeps them in id
 * order) and checks `ENEMY_MAX`.
 */
export function newEnemy(
  world: World,
  kind: EnemyKind,
  tier: Tier,
  x: number,
  y: number,
  facing: 1 | -1,
): Enemy {
  const imp = kind === "imp";
  return {
    id: world.nextId++,
    kind,
    x,
    y,
    z: 0,
    vx: 0,
    vz: 0,
    facing,
    hp: enemyMaxHp(kind, tier, world.heroes.length),
    state: imp ? "walk" : "idle",
    timer: 0,
    stopUntil: 0,
    tier,
    // On the road, as every goal is: one appearing beyond the stage's end has its own set as it walks in.
    goal: clamp(x, 0, planOf(world).length),
    goalY: y,
    target: 0,
    thinkAt: world.step + fighterOf(kind, tier, false).think,
    holder: 0,
    pots: imp ? IMP_POTS : 0,
    poise: 0,
    flashUntil: 0,
    enraged: false,
  };
}

/** A hero on the field, whom enemies go for: not lying fallen, dropping back in or out. */
export const present = (hero: Hero): boolean =>
  hero.state !== "dead" && hero.state !== "respawn" && hero.state !== "out";

/**
 * Every hero is out of lives: the run is lost, unless the party continues. The last to fall lies `RESPAWN_DELAY`
 * steps before it is out, so the run is lost a beat after the fall rather than at it.
 */
export const defeated = (world: World): boolean =>
  world.heroes.length > 0 && world.heroes.every((hero) => hero.state === "out");

/** How far apart two figures are, along the road plus in depth. */
export const distance = (a: Enemy | Hero, b: Enemy | Hero): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The hero on the field nearest an enemy (the first in id order on a tie), if any is. */
export function nearestHero(world: World, enemy: Enemy): Hero | undefined {
  let nearest: Hero | undefined;
  for (const hero of world.heroes)
    if (
      present(hero) &&
      (!nearest || distance(hero, enemy) < distance(nearest, enemy))
    )
      nearest = hero;
  return nearest;
}

/** Turns an enemy (or a beast) toward `x`; one straight above or below it in depth keeps its facing. */
export function face(enemy: Enemy | Mount, x: number): void {
  if (x !== enemy.x) enemy.facing = x > enemy.x ? 1 : -1;
}

/** Turns an enemy toward the nearest hero on the field. */
export function faceNearest(world: World, enemy: Enemy): void {
  const nearest = nearestHero(world, enemy);
  if (nearest) face(enemy, nearest.x);
}

/** Puts a figure in `state` from its first step; staying in the state it is in changes nothing. */
export function setState<S extends string>(
  entity: { state: S; timer: number },
  state: S,
): void {
  if (entity.state === state) return;
  entity.state = state;
  entity.timer = 0;
}

/** A hit spark born now at the impact point; the world keeps only the newest `FX_MAX`. */
export function spark(
  world: World,
  kind: FxKind,
  x: number,
  y: number,
  z: number,
): void {
  world.fx.push({ kind, x, y, z, born: world.step });
  if (world.fx.length > FX_MAX) world.fx.shift();
}

/** The beast the hero or enemy `id` rides, if it rides one. */
export const mountOf = (world: World, id: number): Mount | undefined =>
  world.mounts.find((each) => each.rider === id);

/**
 * A rider knocked off its beast by a blow going the way `dir` points: it falls from the saddle (the caller sends it
 * flying, `launch` an enemy and `wound` a hero), and the beast, riderless, panics away from the blow (`mount.ts`).
 */
export function unseat(world: World, rider: Hero | Enemy, dir: 1 | -1): void {
  const mount = mountOf(world, rider.id)!;
  mount.rider = mount.vx = mount.vy = 0;
  mount.facing = dir;
  setState(mount, "flee");
  rider.z = mount.z + SADDLE;
}

/** A blow the saddle takes (its rider stays on): the beast's tail still winding up is broken off. */
export function flinch(world: World, rider: Hero | Enemy): void {
  const mount = mountOf(world, rider.id)!;
  if (mount.state !== "sweep" || mount.timer >= TAIL_WINDUP) return;
  setState(mount, "idle");
  mount.coolUntil = world.step + TAIL_COOL;
}

/**
 * Knocks an enemy down, launched up and away the way `dir` points along the road (facing back at the blow), going for
 * nobody and held still for the heavy hit-stop. A rider is knocked off its beast (`unseat`): the one way an enemy
 * leaves the saddle. An ogre's poise is whole again.
 */
export function launch(world: World, enemy: Enemy, dir: 1 | -1): void {
  if (enemy.state === "ride") unseat(world, enemy, dir);
  enemy.state = "knockdown";
  enemy.poise = 0;
  enemy.timer = enemy.target = 0;
  enemy.facing = dir > 0 ? -1 : 1;
  enemy.vx = dir * KNOCK_VX;
  enemy.vz = KNOCK_VZ;
  enemy.stopUntil = world.step + HEAVY_HITSTOP;
}

/**
 * A new world with one more enemy of `tier` standing at (`x`, `y`) in sub-units, held to the road and the floor
 * band, facing the nearest hero. It takes the world's next id, so enemies stay in id order; the world passed in is
 * left untouched. Like `createWorld` it throws on an unknown kind or tier or a position that is not whole, which
 * would otherwise leave NaN in the enemy's hit points or position, on a sack imp above the lowest tier (the codec
 * refuses one), and on a world that already holds `ENEMY_MAX`:
 * the checkpoint codec refuses a bigger one, so a room that grew it could never be restored.
 */
export function spawnEnemy(
  world: World,
  kind: EnemyKind,
  x: number,
  y: number,
  tier: Tier = 0,
): World {
  if (!ENEMY_KINDS.includes(kind) || !TIERS.includes(tier))
    throw new RangeError(`fuse-axe: unknown enemy ${kind} of tier ${tier}`);
  if (kind === "imp" && tier !== 0)
    throw new RangeError(`fuse-axe: a sack imp of tier ${tier}`);
  if (!Number.isInteger(x) || !Number.isInteger(y))
    throw new RangeError(`fuse-axe: enemy position ${x},${y} is not whole`);
  if (world.enemies.length >= ENEMY_MAX)
    throw new RangeError(`fuse-axe: already ${ENEMY_MAX} enemies`);
  const next = { ...world };
  const enemy = newEnemy(
    next,
    kind,
    tier,
    clamp(x, 0, planOf(world).length),
    clamp(y, FLOOR_TOP, FLOOR_BOTTOM),
    -1,
  );
  faceNearest(next, enemy);
  next.enemies = [...world.enemies, enemy];
  return next;
}
