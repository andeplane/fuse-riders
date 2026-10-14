import { TICK_MS } from "fuse-netcode";
import {
  CLAWBEAK_STEPS,
  DRAKE_STEPS,
  OGRE_STEPS,
  SIGIL,
  SPELL_STEPS,
} from "../../engine/view-kit.js";
import type {
  EnemyAnim,
  EnemyView,
  FxKind,
  HeroAnim,
  HeroKind,
  MountAnim,
  SpellKind,
  WorldView,
} from "../../engine/view.js";
import type { View } from "../../online/game.js";
import type { Cue } from "./sounds.js";

/** What the tracker reads of a frame. */
export type Heard = Pick<
  View,
  "stage" | "matchId" | "round" | "logTick" | "countdown" | "outcome"
> & { world: WorldView | null };

/**
 * Simulation steps within which the same moment, corrected and shown again, is the same moment: shorter than any
 * repeat of one move (Rhea's quickest slash takes 15 steps before another can begin).
 */
export const ECHO_STEPS = 12;
/** A moment already this many steps old when first seen is history (a page just opened, a tab back), not news. */
export const FRESH_STEPS = 12;
/** Pixels a corrected spark may land from the spark it replaces. */
const NEAR = 16;
const TICKS_PER_SECOND = 1000 / TICK_MS;

const SLASHES: readonly HeroAnim[] = ["attack1", "attack2", "attack3"];
const SWINGS: readonly HeroAnim[] = [...SLASHES, "jumpattack", "backattack"];
const HERO_CUES: Partial<Record<HeroAnim, Cue>> = {
  jump: "jump",
  land: "land",
  dash: "dash",
  throw: "throw",
  knockdown: "knocked",
  respawn: "respawn",
  // Climbing on a beast, into its saddle.
  ride: "board",
};
/** A hero's anim begun: a swing, a moment, or a jump that drops from the saddle (`was` the anim before). */
const heroCue = (
  anim: HeroAnim,
  kind: HeroKind,
  was: string,
): Cue | undefined =>
  SWINGS.includes(anim)
    ? `swing-${kind}`
    : was === "ride" && anim === "jump"
      ? "dismount"
      : HERO_CUES[anim];
/** The charge's chime per level, from 1: Rhea's six pots have one each. */
export const CHARGE_TICKS = [
  ...["charge1", "charge2", "charge3"],
  ...["charge4", "charge5", "charge6"],
] as const satisfies readonly Cue[];
/** Each spell's blow, landing on its `hit` step. */
const SPELL_BLOWS: Readonly<Record<SpellKind, Cue>> = {
  storm: "thunder",
  fire: "blaze",
  earth: "tremor",
};
/**
 * An enemy's anim begun. The mace's, the spear's and the greatsword's wind-ups are one creak, as is an ogre's hammer
 * drawn back for its sweep (which lands later: `ENEMY_BLOWS`).
 */
const ENEMY_CUES: Partial<Record<EnemyAnim, Cue>> = {
  windup: "windup",
  sweep: "windup",
  thrust: "thrust",
  leap: "leap",
  plunge: "plunge",
  slam: "slam",
  rise: "rise",
  pile: "collapse",
  reassemble: "reassemble",
  cut1: "cut",
  cut2: "cut",
  cast: "hex",
  summon: "summon",
  roar: "roar",
};
/** An enemy's anim begun (`was` the anim before, if it was shown): a blow on a bone pile shatters it; Vorhal falls. */
const enemyCue = (
  enemy: EnemyView,
  was: string | undefined,
): Cue | undefined =>
  enemy.anim !== "dead"
    ? ENEMY_CUES[enemy.anim]
    : was === "pile"
      ? "shatter"
      : enemy.kind === "vorhal"
        ? "vorhal-falls"
        : undefined;
/**
 * A beast's anim begun, whoever rides it (its rider never leaves `ride`): a tail or the captain's saddle thrust
 * winding up is the wind-up, a drake breathing draws breath first, and a hero's beast hops.
 */
const MOUNT_CUES: Partial<Record<MountAnim, Cue>> = {
  sweep: "windup",
  breathe: "inhale",
  lance: "windup",
  hop: "hop",
};
/** A blow landing partway through an anim: the anim, the `animStep` it lands on, and its cue. */
type Blow = readonly [anim: string, at: number, cue: Cue];
const ENEMY_BLOWS: readonly Blow[] = [
  ["sweep", OGRE_STEPS.sweepWindup, "heave"],
];
const MOUNT_BLOWS: readonly Blow[] = [
  ["sweep", CLAWBEAK_STEPS.windup, "lash"],
  ["breathe", DRAKE_STEPS.inhale, "flame"],
  ["lance", DRAKE_STEPS.lanceWindup, "thrust"],
];
/** Camp's fire spits on these steps of every `CRACKLE_CYCLE`: unevenly, a quarter of a second or more apart. */
export const CRACKLES = [0, 14, 33, 47, 70],
  CRACKLE_CYCLE = 90;
/** The stages after the first open on a horn of their own rather than GO's. */
const STAGE_STINGS: Readonly<Record<number, Cue>> = {
  2: "stage2",
  3: "stage3",
  4: "stage4",
};

interface Figure {
  anim: string;
  animStep: number;
  hp: number;
  pots: number;
  charge: number;
  enraged: boolean;
}
interface Spark {
  kind: FxKind;
  born: number;
  x: number;
  y: number;
}
const sparksOf = (world: WorldView): Spark[] =>
  world.fx.map(({ kind, x, y, age }) => ({
    ...{ kind, x, y },
    born: world.step - age,
  }));

/**
 * What the speakers hear of the game, found by diffing the frames the page is shown, never by the simulation: a
 * swing is a hero whose anim became a slash, a thud a spark the frame before did not have. Frames arrive twenty
 * times a second and a rollback can correct a moment away and then show it again, so each cue is tied to what it
 * marks (a figure's anim and when it began, a spark, a spell, a wave, a stage) and one already heard is not heard
 * twice; nor is one the page first shows already under way.
 */
export class CueTracker {
  private run = "";
  private stage: Heard["stage"] | undefined;
  private figures = new Map<string, Figure>();
  /** Each moment heard, by key, and the step it began. */
  private heard = new Map<string, number>();
  private sparks: Spark[] = [];
  private world: WorldView | null = null;
  /** Moments that happen once in the run (a wave locking, a stage's fanfare), by key. */
  private once = new Set<string>();

  /** The cues `frame` brings since the frame before, each at most once. */
  next(frame: Heard): Cue[] {
    const cues = new Set<Cue>(),
      run = `${frame.matchId}:${frame.round}`;
    if (run !== this.run) {
      // A stage or a rematch has its one-off moments to itself, and the set never holds more than one run's.
      this.run = run;
      this.once.clear();
      this.world = null;
    }
    this.stageCues(frame, run, cues);
    const world = frame.world;
    if (world && this.world && this.world.camp === world.camp)
      this.worldCues(this.world, world, run, cues);
    else {
      // A stage (or camp) starts from what it shows: nothing in its first frame is news, its sparks included.
      this.figures.clear();
      this.heard.clear();
      this.sparks = world ? sparksOf(world) : [];
    }
    this.world = world;
    if (world) this.remember(world);
    return [...cues];
  }

  private stageCues(frame: Heard, run: string, cues: Set<Cue>): void {
    const was = this.stage;
    this.stage = frame.stage;
    if (was !== undefined && was !== frame.stage) {
      // A run's round is the stage it plays.
      if (frame.stage === "running")
        this.first(`go:${run}`, STAGE_STINGS[frame.round] ?? "go", cues);
      if (frame.stage === "between")
        this.first(`clear:${run}`, "fanfare", cues);
      if (frame.stage === "over" && frame.outcome === "victory")
        this.first(`won:${run}`, "victory", cues);
      if (frame.stage === "over" && frame.outcome === "defeat")
        this.first(`over:${run}`, "gameover", cues);
    }
    // The continue countdown ticks each whole second; a stage has one countdown at most.
    if (frame.stage === "running" && frame.countdown > 0)
      this.first(
        `tick:${run}:${Math.ceil(frame.countdown / TICKS_PER_SECOND)}`,
        "tick",
        cues,
      );
  }

  private worldCues(
    before: WorldView,
    world: WorldView,
    run: string,
    cues: Set<Cue>,
  ): void {
    const step = world.step;
    for (const hero of world.heroes) {
      const key = `h${hero.id}`,
        was = this.figures.get(key);
      if (!was) continue;
      const cue =
        this.began(key, hero, was, step) &&
        heroCue(hero.anim, hero.kind, was.anim);
      if (cue) cues.add(cue);
      // A blow that knocks the hero down sounds as the fall; any other is a grunt. A rollback shows the same blow
      // again, leaving the same hit points; a second blow within `ECHO_STEPS` leaves fewer, so it is heard too.
      if (
        hero.hp < was.hp &&
        hero.anim !== "knockdown" &&
        this.fresh(`${key}:hp${hero.hp}`, step)
      )
        cues.add("hurt");
      // Each level a Magic charge reaches chimes (`charge` is 0 but in one), the charge's start marking the moment.
      const level = Math.min(hero.charge, CHARGE_TICKS.length);
      if (
        level > was.charge &&
        this.fresh(`${key}:charge${level}`, step - hero.animStep)
      )
        cues.add(CHARGE_TICKS[level - 1]!);
      // A pot picked up off the floor (one drunk for magic takes one away), or meat eaten at camp.
      const pots = hero.pots;
      if (pots > was.pots && this.fresh(`${key}:pot${pots}`, step))
        cues.add("pot");
      if (
        world.camp &&
        hero.hp > was.hp &&
        this.fresh(`${key}:meat${hero.hp}`, step)
      )
        cues.add("munch");
    }
    for (const enemy of world.enemies) {
      const key = `e${enemy.id}`,
        was = this.figures.get(key);
      // One that first shows this frame (a bonewalker clawing up, a lancer leaping in) begins its anim now.
      const cue =
        this.began(key, enemy, was, step) && enemyCue(enemy, was?.anim);
      if (cue) cues.add(cue);
      this.landed(key, enemy, was, step, ENEMY_BLOWS, cues);
      // An ogre whose twin has fallen bellows, once.
      if (enemy.kind === "ogre" && enemy.enraged && was && !was.enraged)
        this.first(`enraged:${run}:${enemy.id}`, "enrage", cues);
    }
    for (const mount of world.mounts) {
      const key = `m${mount.id}`,
        was = this.figures.get(key);
      const cue = this.began(key, mount, was, step) && MOUNT_CUES[mount.anim];
      if (cue) cues.add(cue);
      this.landed(key, mount, was, step, MOUNT_BLOWS, cues);
    }
    this.sparkCues(world, cues);
    this.spellCues(before, world, cues);
    this.sigilCues(before, world, cues);
    const wave = `${run}:${world.wave}`;
    if (world.locked && !before.locked)
      this.first(`locked:${wave}`, "locked", cues);
    if (!world.locked && before.locked && !world.cleared)
      this.first(`cleared:${wave}`, "cleared", cues);
    if (world.go && !before.go) this.first(`go:${wave}`, "go", cues);
    if (world.boss && !before.boss) this.first(`boss:${wave}`, "boss", cues);
    if (world.camp) this.crackle(before.step, step, cues);
  }

  /**
   * Whether a figure's anim began since the frame before (it changed, started over, or the figure first shows), as
   * news: not long ago, and not the same anim begun within `ECHO_STEPS` of when it was last heard to, which a
   * rollback shows again.
   */
  private began(
    key: string,
    figure: { anim: string; animStep: number },
    was: Figure | undefined,
    step: number,
  ): boolean {
    return (
      (!was || figure.anim !== was.anim || figure.animStep < was.animStep) &&
      figure.animStep <= FRESH_STEPS &&
      this.fresh(`${key}:${figure.anim}`, step - figure.animStep)
    );
  }

  /**
   * The blows that landed since the frame before partway through a figure's anim (a tail lashing round, a flame
   * catching): the frame before showed the anim still to land, it landed not long ago, and none was heard within
   * `ECHO_STEPS` of when it landed. An anim first shown past its blow (a rollback's correction) is silent.
   */
  private landed(
    key: string,
    figure: { anim: string; animStep: number },
    was: Figure | undefined,
    step: number,
    blows: readonly Blow[],
    cues: Set<Cue>,
  ): void {
    for (const [anim, at, cue] of blows)
      if (
        figure.anim === anim &&
        was?.anim === anim &&
        was.animStep < at &&
        figure.animStep >= at &&
        figure.animStep - at <= FRESH_STEPS &&
        this.fresh(`${key}:${anim}@${at}`, step - figure.animStep + at)
      )
        cues.add(cue);
  }

  /**
   * A spell is its hero's (each hero has one at most) and the step it was cast. Cast, it sounds its kind; its blow
   * lands on its level's `hit` step, heard only if the frame before showed it still to come.
   */
  private spellCues(before: WorldView, world: WorldView, cues: Set<Cue>) {
    for (const spell of world.spells) {
      const key = `s${spell.hero}`,
        born = world.step - spell.age,
        was = before.spells.find((each) => each.hero === spell.hero),
        hit = SPELL_STEPS[spell.kind][spell.level - 1]?.hit ?? Infinity;
      if (
        (!was || before.step - was.age !== born) &&
        spell.age <= FRESH_STEPS &&
        this.fresh(key, born)
      )
        cues.add(`cast-${spell.kind}`);
      if (
        was &&
        was.age < hit &&
        spell.age >= hit &&
        spell.age - hit <= FRESH_STEPS &&
        this.fresh(`${key}:hit`, born + hit)
      )
        cues.add(SPELL_BLOWS[spell.kind]);
    }
  }

  /**
   * Vorhal's sigils, marked together, glint as they appear; their pillars erupt `SIGIL.delay` steps on, heard if the
   * frame before showed them still glowing. A sigil is the step it was marked (a rollback's correction may move it).
   */
  private sigilCues(before: WorldView, world: WorldView, cues: Set<Cue>) {
    const marked = before.sigils.map((each) => ({
      born: before.step - each.age,
      glowing: each.age < SIGIL.delay,
    }));
    for (const sigil of world.sigils) {
      const born = world.step - sigil.age;
      if (
        !marked.some((each) => each.born === born) &&
        sigil.age <= FRESH_STEPS &&
        this.fresh("sigil", born)
      )
        cues.add("sigil");
      if (
        marked.some(
          (each) => each.glowing && Math.abs(each.born - born) < ECHO_STEPS,
        ) &&
        sigil.age >= SIGIL.delay &&
        sigil.age - SIGIL.delay <= FRESH_STEPS &&
        this.fresh("pillar", born + SIGIL.delay)
      )
        cues.add("pillar");
    }
  }

  /** Camp's fire, on each of `CRACKLES` stepped past since the frame before and not heard already. */
  private crackle(from: number, to: number, cues: Set<Cue>): void {
    for (let at = Math.max(from + 1, to - FRESH_STEPS); at <= to; at++)
      if (
        CRACKLES.includes(at % CRACKLE_CYCLE) &&
        this.fresh(`crackle${at}`, at)
      )
        cues.add("crackle");
  }

  /**
   * Sparks are not ids: a spark is its kind, the step it was born and where. One the frame before heard is old; a new
   * one near a heard spark the frame no longer shows, born about when it was, is that spark corrected, so silent.
   */
  private sparkCues(world: WorldView, cues: Set<Cue>): void {
    const step = world.step,
      shown = sparksOf(world);
    const same = (a: Spark, b: Spark) =>
      a.kind === b.kind && a.born === b.born && a.x === b.x && a.y === b.y;
    for (const spark of shown) {
      if (this.sparks.some((heard) => same(heard, spark))) continue;
      const echo = this.sparks.some(
        (heard) =>
          heard.kind === spark.kind &&
          Math.abs(heard.born - spark.born) < ECHO_STEPS &&
          Math.abs(heard.x - spark.x) + Math.abs(heard.y - spark.y) <= NEAR &&
          !shown.some((other) => same(other, heard)),
      );
      this.sparks.push(spark);
      if (!echo && step - spark.born <= FRESH_STEPS) cues.add(spark.kind);
    }
    this.sparks = this.sparks.filter(
      (spark) => step - spark.born <= 2 * FRESH_STEPS + ECHO_STEPS,
    );
  }

  /** Whether the moment `key`, begun at step `at`, is not one heard within `ECHO_STEPS`; it is heard from now. */
  private fresh(key: string, at: number): boolean {
    const was = this.heard.get(key);
    if (was !== undefined && Math.abs(at - was) < ECHO_STEPS) return false;
    this.heard.set(key, at);
    return true;
  }

  private first(key: string, cue: Cue, cues: Set<Cue>): void {
    if (this.once.has(key)) return;
    this.once.add(key);
    cues.add(cue);
  }

  private remember(world: WorldView): void {
    const figure = (
      key: string,
      { anim, animStep }: { anim: string; animStep: number },
      extra: Partial<Figure> = {},
    ) =>
      this.figures.set(key, {
        ...{ anim, animStep, hp: 0, pots: 0, charge: 0, enraged: false },
        ...extra,
      });
    for (const hero of world.heroes)
      figure(`h${hero.id}`, hero, {
        hp: hero.hp,
        pots: hero.pots,
        charge: hero.charge,
      });
    for (const enemy of world.enemies)
      figure(`e${enemy.id}`, enemy, { hp: enemy.hp, enraged: enemy.enraged });
    for (const mount of world.mounts) figure(`m${mount.id}`, mount);
  }
}
