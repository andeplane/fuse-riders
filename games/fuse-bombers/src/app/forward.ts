import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import { step, type RoundState, type RoundView } from "../engine/index.js";
import { blendRound } from "./online-source.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded round is the latest the room knows; instead of
 * presenting it a tick late to blend towards it, the screen plays it forward on a copy, by the fraction of a log
 * tick the clock has run past it, on the bits the fold itself would use as the log stands (this device's own are in
 * the log the moment they are made), and draws that. A press shows on the next animation frame instead of
 * 50–100 ms later, and what is drawn is what the fold will produce unless someone else's controls arrive first. The
 * copy is thrown away: nothing here reaches the room.
 *
 * Only motion is played forward: where the gunships, the ghosts and the rockets are, how the launchers stand and
 * reload, and the clock the gates and crates move by. Everything that counts (hull and shield, who is alive, the
 * terrain, the gates and crates there are, the phase and the result) is the folded round's, so no hit, crater or
 * round end is shown on a guess. A gunship or rocket the forward run would destroy stops where it was until the room
 * folds it; a rocket the run fires is drawn at once.
 */
export interface Source {
  /** The room's newest folded round: copied before any step. */
  world: RoundState;
  /** Per log tick ahead, its steps' input bits by gunship; empty for a tick that runs no step. */
  ticks: readonly (readonly (readonly number[])[])[];
}

type Castle = RoundView["castles"][number];
type Ghost = RoundView["ghosts"][number];
type Rocket = RoundView["rockets"][number];

/** A gunship as the room folded it, flying and aiming as the forward run has it. */
const flown = (folded: Castle, ahead: Castle): Castle => ({
  ...folded,
  x: ahead.x,
  y: ahead.y,
  vx: ahead.vx,
  vy: ahead.vy,
  thrust: ahead.thrust,
  angle: ahead.angle,
  reloadTicks: ahead.reloadTicks,
  reloadTotalTicks: ahead.reloadTotalTicks,
  volleyLeft: ahead.volleyLeft,
  volleyAngle: ahead.volleyAngle,
  volleyMega: ahead.volleyMega,
  volleyCooldown: ahead.volleyCooldown,
});

/**
 * The folded round `base` with the motion of `world`, a copy played forward; `before` is the stage a step earlier,
 * where whatever the run has since destroyed is left standing.
 */
function stage(
  base: RoundView,
  before: RoundView,
  world: RoundState,
): RoundView {
  const ghosts = new Map(world.ghosts.map((ghost) => [ghost.owner, ghost]));
  const rockets = new Map(world.rockets.map((rocket) => [rocket.id, rocket]));
  const earlier = new Map(before.rockets.map((rocket) => [rocket.id, rocket]));
  const folded = new Set(base.rockets.map((rocket) => rocket.id));
  return {
    ...base,
    tick: world.tick,
    castles: base.castles.map((castle) => {
      const ahead = world.castles[castle.id];
      return castle.alive && ahead?.alive
        ? flown(castle, ahead)
        : (before.castles[castle.id] ?? castle);
    }),
    ghosts: base.ghosts.map((ghost): Ghost => {
      const ahead = ghosts.get(ghost.owner);
      return ahead ? { ...ahead } : ghost;
    }),
    rockets: [
      // A rocket the room has folded stays until the room folds its end, where the run last had it.
      ...base.rockets.map(
        (rocket): Rocket =>
          rockets.get(rocket.id) ?? earlier.get(rocket.id) ?? rocket,
      ),
      ...world.rockets.filter((rocket) => !folded.has(rocket.id)),
    ].map((rocket) => ({ ...rocket })),
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
 * The forward run, remembered between frames: the round is copied (terrain and all) and a step is run once per
 * folded round, revision and set of inputs, however many frames draw it (the bots plan inside the engine's step).
 * `key` names the folded round: the runtime's frame revision, the round and its log tick. `base` is the frame the
 * room published for it, which nothing changes.
 */
export function createForward(): (
  source: Source,
  base: RoundView,
  key: string,
  ahead: number,
) => RoundView {
  let known = "",
    tip: RoundState | undefined,
    stages: RoundView[] = [],
    over = false;
  return (source, base, key, ahead) => {
    const plan = source.ticks.flat();
    const signature = `${key}|${plan.map((bits) => bits.join(".")).join("|")}`;
    if (signature !== known) {
      known = signature;
      over = false;
      tip = undefined;
      stages = [base];
    }
    /** The stage `count` steps on, or undefined past the plan or past a step that would decide the round. */
    const reach = (count: number): RoundView | undefined => {
      while (stages.length <= count && !over && stages.length <= plan.length) {
        tip ??= structuredClone(source.world);
        const decided = tip.result !== null;
        step(tip, plan[stages.length - 1]!);
        // The end of the round is the room's to show: the run stops on the step before it.
        if (tip.result && !decided) over = true;
        else stages.push(stage(stages[0]!, stages[stages.length - 1]!, tip));
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
    if (!from) return stages[stages.length - 1]!;
    const to = part > 0.001 ? reach(whole + 1) : undefined;
    return to ? blendRound(from, to, part) : from;
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 240;

export interface Marks {
  /** The frame revision: a rollback replaced history. */
  revision: number;
  /** Tells one round from the next. */
  game: string;
  /** The newest folded log tick, each gunship's mark for it, and its marks for the ticks ahead (`Ahead`). */
  tick: number;
  folded: readonly number[];
  next: readonly (readonly number[])[];
}

export interface Smoother {
  /** `view` with corrections hidden, at wall time `nowMs`. `local` is this device's gunship, or −1: never smoothed. */
  apply(view: RoundView, marks: Marks, nowMs: number, local: number): RoundView;
}

/**
 * Hides what the forward run got wrong. The other gunships and ghosts are drawn where the room's newest inputs put
 * them; when a rollback moves one, or a new tick shows its pilot did something else than the run was drawn on, the
 * screen keeps it where it was and lets the difference decay.
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
    apply(view, marks, nowMs, local) {
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
      const absorb = (ship: number) =>
        rolled || (stepped && expected?.[ship] !== marks.folded[ship]);
      revision = marks.revision;
      tick = marks.tick;
      for (const at of drawn.keys()) if (at <= tick) drawn.delete(at);
      marks.next.forEach((ships, index) => drawn.set(tick + 1 + index, ships));
      let moved = false;
      const place = <T extends { x: number; y: number }>(
        name: string,
        ship: number,
        body: T,
      ): T => {
        if (ship === local) return body;
        const at = smoother.place(name, body, absorb(ship));
        if (at.x === body.x && at.y === body.y) return body;
        moved = true;
        return { ...body, x: at.x, y: at.y };
      };
      const castles = view.castles.map((castle) =>
          castle.alive ? place(`ship:${castle.id}`, castle.id, castle) : castle,
        ),
        ghosts = view.ghosts.map((ghost) =>
          place(`ghost:${ghost.owner}`, ghost.owner, ghost),
        );
      return moved ? { ...view, castles, ghosts } : view;
    },
  };
}
