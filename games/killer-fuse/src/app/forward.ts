import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import {
  cloneRound,
  packInput,
  stepRound,
  viewOf,
  type Input,
  type Round,
  type RoundView,
  type UnitView,
} from "../engine/index.js";
import { interpolateUnit, wrap } from "../render/interpolation.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded round is the latest the room knows; instead of
 * presenting it a tick late to blend towards it, the screen plays it forward on a copy, by the fraction of a log
 * tick the clock has run past it, on the inputs the fold itself would use as the log stands (this device's own are
 * in the log the moment they are made), and draws that. A press shows on the next animation frame instead of
 * 50–100 ms later, and what is drawn is what the fold will produce unless someone else's controls arrive first. The
 * copies are thrown away: nothing here reaches the room.
 *
 * Only motion is played forward. Everything that counts (who is dead, the eggs, the berries banked, the gates, the
 * piles, the clock, the winner) is the folded round's, so no kill, score or victory is shown on a guess. A unit the
 * forward run would kill, hatch, mount, feed to the snail or transform stops where it stood until the room folds it.
 */
export interface Source {
  /** The room's newest folded round: copied before any step. */
  world: Round;
  /** Per log tick ahead, its steps' inputs by slot; empty for a tick that runs no step. */
  ticks: readonly (readonly (readonly Input[])[])[];
}

/** One display frame for the renderer: `alpha` of the way from `previous` to `current`, a step apart or the same. */
export interface Picture {
  previous: RoundView;
  current: RoundView;
  alpha: number;
}

interface Stage {
  world: Round;
  view: RoundView;
  /** Per slot: the forward run changed what the unit is, so it is held where it last stood as the room knows it. */
  held: boolean[];
}

/** Whether the forward run still shows `ahead` as the unit the room has folded. */
const same = (folded: UnitView, ahead: UnitView): boolean =>
  folded.dead === ahead.dead &&
  folded.riding === ahead.riding &&
  folded.eaten === ahead.eaten &&
  folded.kind === ahead.kind;

/** The folded round's view with the motion of `world`, a copy played forward from `before`. */
function stage(base: RoundView, before: Stage, world: Round): Stage {
  const ahead = viewOf(world),
    held = [...before.held];
  const units = ahead.units.map((unit, slot) => {
    const folded = base.units[slot];
    if (!held[slot] && folded && same(folded, unit)) return unit;
    held[slot] = true;
    return before.view.units[slot] ?? unit;
  });
  const { snail } = base;
  return {
    world,
    held,
    view: {
      ...base,
      step: ahead.step,
      units,
      loose:
        ahead.loose.length === base.loose.length ? ahead.loose : base.loose,
      snail:
        ahead.snail.rider === snail.rider && ahead.snail.victim === snail.victim
          ? { ...snail, x: ahead.snail.x, facing: ahead.snail.facing }
          : snail,
    },
  };
}

/** How many engine steps `ahead` log ticks (fractional) come to, over ticks that run `counts` steps each. */
export const stepsAhead = (ahead: number, counts: readonly number[]): number =>
  counts.reduce(
    (sum, count, index) =>
      sum + Math.max(0, Math.min(1, ahead - index)) * count,
    0,
  );

/**
 * The forward run, remembered between frames: a step is run once per folded round, revision and set of inputs,
 * however many frames draw it (the bots plan inside the engine's step, the most expensive thing here). `key` names
 * the folded round: the runtime's frame revision, the game and its log tick.
 */
export function createForward(): (
  source: Source,
  key: string,
  ahead: number,
) => Picture {
  let known = "",
    stages: Stage[] = [],
    over = false;
  return (source, key, ahead) => {
    const plan = source.ticks.flat();
    const signature = `${key}|${plan
      .map((step) => step.map(packInput).join("."))
      .join("|")}`;
    if (signature !== known) {
      known = signature;
      over = false;
      const view = viewOf(source.world);
      stages = [
        { world: source.world, view, held: view.units.map(() => false) },
      ];
    }
    const base = stages[0]!.view;
    /** The stage `count` steps on, or undefined past the plan or past a step that would decide the game. */
    const reach = (count: number): Stage | undefined => {
      while (stages.length <= count && !over && stages.length <= plan.length) {
        const before = stages[stages.length - 1]!,
          world = stepRound(cloneRound(before.world), plan[stages.length - 1]!);
        // A victory is the room's to show: the run stops on the step before it.
        if (world.winner) over = true;
        else stages.push(stage(base, before, world));
      }
      return stages[count];
    };
    const steps = stepsAhead(
        Math.max(0, ahead),
        source.ticks.map((tick) => tick.length),
      ),
      whole = Math.floor(steps + 1e-9),
      part = steps - whole,
      from = reach(whole);
    if (!from) {
      const last = stages[stages.length - 1]!.view;
      return { previous: last, current: last, alpha: 1 };
    }
    const to = part > 0.001 ? reach(whole + 1) : undefined;
    return to
      ? { previous: from.view, current: to.view, alpha: part }
      : { previous: from.view, current: from.view, alpha: 1 };
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels (a respawn, the wrap) is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 48;

export interface Marks {
  /** The frame revision: a rollback replaced history. */
  revision: number;
  /** Tells one game from the next. */
  game: string;
  /** The newest folded log tick, each slot's mark for it, and its marks for the ticks ahead (`Ahead`). */
  tick: number;
  folded: readonly number[];
  next: readonly (readonly number[])[];
}

export interface Smoother {
  /** `picture` with corrections hidden, at wall time `nowMs`. `local` is this device's slot, or −1: never smoothed. */
  apply(picture: Picture, marks: Marks, nowMs: number, local: number): Picture;
}

/**
 * Hides what the forward run got wrong. The other units are drawn where the room's newest inputs put them; when a
 * rollback moves one, or a new tick shows its pilot did something else than the run was drawn on, the screen keeps
 * it where it was and lets the difference decay.
 */
export function createSmoother(
  smoother: CorrectionSmoother = createCorrectionSmoother({
    decayMs: DECAY_MS,
    teleport: TELEPORT,
  }),
): Smoother {
  let revision: number | undefined,
    tick = -1,
    game = "";
  /** What each tick ahead was last drawn on, by log tick. */
  const drawn = new Map<number, readonly number[]>();
  return {
    apply(picture, marks, nowMs, local) {
      if (marks.game !== game) {
        game = marks.game;
        drawn.clear();
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && marks.revision !== revision,
        stepped = marks.tick !== tick,
        expected = drawn.get(marks.tick);
      // A pilot the forward run had wrong is one whose entries for the tick just folded are not the ones drawn.
      const changed = (slot: number) =>
        stepped && expected?.[slot] !== marks.folded[slot];
      revision = marks.revision;
      tick = marks.tick;
      for (const at of drawn.keys()) if (at <= tick) drawn.delete(at);
      marks.next.forEach((slots, index) => drawn.set(tick + 1 + index, slots));
      const { previous, current, alpha } = picture;
      let moved = false;
      const shift = current.units.map((unit, slot) => {
        if (slot === local || unit.dead || unit.riding || unit.eaten)
          return undefined;
        const raw = interpolateUnit(previous.units[slot], unit, alpha),
          at = smoother.place(`unit:${slot}`, raw, rolled || changed(slot)),
          dx = at.x - raw.x,
          dy = at.y - raw.y;
        if (dx === 0 && dy === 0) return undefined;
        moved = true;
        return { dx, dy };
      });
      if (!moved) return picture;
      const shifted = (view: RoundView): RoundView => ({
        ...view,
        units: view.units.map((unit, slot) => {
          const by = shift[slot];
          return by
            ? { ...unit, x: wrap(unit.x + by.dx), y: unit.y + by.dy }
            : unit;
        }),
      });
      return previous === current
        ? ((view) => ({ previous: view, current: view, alpha }))(
            shifted(current),
          )
        : { previous: shifted(previous), current: shifted(current), alpha };
    },
  };
}
