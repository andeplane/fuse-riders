import { TICK_MS } from "fuse-netcode";
import type { HeroAnim, HeroKind, WorldView } from "../../engine/view.js";
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
};
const heroCue = (anim: HeroAnim, kind: HeroKind): Cue | undefined =>
  SWINGS.includes(anim) ? `swing-${kind}` : HERO_CUES[anim];

interface Figure {
  anim: string;
  animStep: number;
  hp: number;
  pots: number;
}
interface Spark {
  kind: string;
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
 * marks (a figure's anim and when it began, a spark, a wave, a stage) and one already heard is not heard twice.
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
    if (world && this.world) this.worldCues(this.world, world, run, cues);
    else {
      // A stage starts from what it shows: nothing in its first frame is news, its sparks included.
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
      if (frame.stage === "running") this.first(`go:${run}`, "go", cues);
      if (
        frame.stage === "between" ||
        (frame.stage === "over" && frame.outcome === "victory")
      )
        this.first(`clear:${run}`, "fanfare", cues);
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
        this.began(key, hero, was, step) && heroCue(hero.anim, hero.kind);
      if (cue) cues.add(cue);
      // A blow that knocks the hero down sounds as the fall; any other is a grunt. A rollback shows the same blow
      // again, leaving the same hit points; a second blow within `ECHO_STEPS` leaves fewer, so it is heard too.
      if (
        hero.hp < was.hp &&
        hero.anim !== "knockdown" &&
        this.fresh(`${key}:hp${hero.hp}`, step)
      )
        cues.add("hurt");
      // A pot picked up off the floor; one drunk for magic takes one away.
      const pots = hero.pots;
      if (pots > was.pots && this.fresh(`${key}:pot${pots}`, step))
        cues.add("pot");
    }
    for (const enemy of world.enemies) {
      const key = `e${enemy.id}`,
        was = this.figures.get(key);
      if (was && enemy.anim === "windup" && this.began(key, enemy, was, step))
        cues.add("windup");
    }
    this.sparkCues(world, cues);
    const wave = `${run}:${world.wave}`;
    if (world.locked && !before.locked)
      this.first(`locked:${wave}`, "locked", cues);
    if (!world.locked && before.locked && !world.cleared)
      this.first(`cleared:${wave}`, "cleared", cues);
    if (world.go && !before.go) this.first(`go:${wave}`, "go", cues);
  }

  /**
   * Whether a figure's anim began since the frame before (it changed, or started over), as news: not long ago, and
   * not the same anim begun within `ECHO_STEPS` of when it was last heard to, which a rollback shows again.
   */
  private began(
    key: string,
    figure: { anim: string; animStep: number },
    was: Figure,
    step: number,
  ): boolean {
    return (
      (figure.anim !== was.anim || figure.animStep < was.animStep) &&
      figure.animStep <= FRESH_STEPS &&
      this.fresh(`${key}:${figure.anim}`, step - figure.animStep)
    );
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
    for (const hero of world.heroes)
      this.figures.set(`h${hero.id}`, {
        anim: hero.anim,
        animStep: hero.animStep,
        hp: hero.hp,
        pots: hero.pots,
      });
    for (const enemy of world.enemies)
      this.figures.set(`e${enemy.id}`, {
        anim: enemy.anim,
        animStep: enemy.animStep,
        hp: enemy.hp,
        pots: 0,
      });
  }
}
