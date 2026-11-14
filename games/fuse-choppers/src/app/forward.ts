import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import {
  INPUT_MASK,
  STEPS_PER_TICK,
  copyWorld,
  roundDone,
  stepWorld,
  toView,
  type Chopper,
  type World,
  type WorldView,
} from "../engine/index.js";
import { stepsPerTick, type Room } from "../online/game.js";
import { blend } from "../render/interpolate.js";
import { effectKey } from "../render/scene.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded world is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * log tick the clock has run past it, with the bits each pilot holds (this device's own live, logged or not), and
 * draws that. A press shows on the next animation frame instead of 50–100 ms later, and what is drawn is what the
 * fold will produce unless another pilot's controls change first. The copy is thrown away: nothing here reaches the
 * room.
 *
 * The forward run never crosses an outcome: a crash, an escape, the end of the countdown and the end of the round
 * are shown when the room has folded them, never on a guess.
 */
export interface ForwardInputs {
  /** What `chopper` is taken to hold for the steps being played: a human's last logged bits, a bot's answer, 0 when away. */
  held(world: World, chopper: Chopper): number;
  /** Steps the log tick that starts at `world` runs: three, or more while only bots are left flying. */
  steps(world: World): number;
}

interface Run {
  /** The copy after the whole steps taken. */
  copy: World;
  taken: number;
  /** The copy one step further, when the clock is `part` of the way into that step. */
  next?: World;
  part: number;
  /** The last step taken decided something: a crash, an escape, a new phase. */
  crossed: boolean;
}

/** Whether `now` shows an outcome `world` does not: a phase, a winner, a chopper down or out, the round's end. */
const decided = (world: World, now: World): boolean =>
  now.phase !== world.phase ||
  now.winner !== world.winner ||
  roundDone(now) ||
  now.choppers.some((chopper, index) => {
    const was = world.choppers[index];
    return !was || was.alive !== chopper.alive || was.exited !== chopper.exited;
  });

/** Runs `ahead` log ticks (fractional) of `world` on a copy, at most `limit` whole steps. */
function run(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
  limit: number,
): Run {
  const copy = copyWorld(world);
  let taken = 0;
  for (let left = ahead; left > 0; left -= 1) {
    const steps = Math.min(1, left) * inputs.steps(copy),
      whole = Math.floor(steps);
    let held = new Map<string, number>();
    // As the fold does: everyone is asked at the tick's start, and again every three steps of a fast tick.
    const ask = () => {
      held = new Map(
        copy.choppers.map((chopper) => [
          chopper.id,
          inputs.held(copy, chopper) & INPUT_MASK,
        ]),
      );
    };
    for (let i = 0; i < whole; i++) {
      if (taken >= limit) return { copy, taken, part: 0, crossed: false };
      if (i % STEPS_PER_TICK === 0) ask();
      stepWorld(copy, held);
      taken++;
      if (decided(world, copy)) return { copy, taken, part: 0, crossed: true };
    }
    const part = steps - whole;
    if (left <= 1 && part > 0.001 && taken < limit) {
      if (whole % STEPS_PER_TICK === 0) ask();
      const next = copyWorld(copy);
      stepWorld(next, held);
      if (!decided(world, next))
        return { copy, taken, next, part, crossed: false };
    }
  }
  return { copy, taken, part: 0, crossed: false };
}

/** The newest world played forward `ahead` log ticks (0–2, fractional), as a view to draw. */
export function forward(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
): WorldView {
  let result = run(world, Math.max(0, ahead), inputs, Infinity);
  // A step that decided something is not shown: play again up to the step before it.
  if (result.crossed)
    result = run(world, Math.max(0, ahead), inputs, result.taken - 1);
  const view = toView(result.copy);
  return result.next ? blend(view, toView(result.next), result.part) : view;
}

export type BotInput = (world: World, chopper: Chopper) => number;

/**
 * The bits the forward run plays for each chopper: a bot answers as the fold would, a seated human holds what it
 * last logged, and this device's own pilot holds what its player holds right now.
 */
export function forwardInputs(
  room: Room,
  me: string,
  live: number,
  bot: BotInput,
): ForwardInputs {
  return {
    held(world, chopper) {
      const seat = room.seats.get(chopper.id);
      if (seat?.bot) return bot(world, chopper);
      if (!seat?.connected) return 0;
      if (chopper.id === me) return live;
      return room.held[chopper.id] ?? 0;
    },
    steps: (world) => stepsPerTick({ ...room, world }),
  };
}

/**
 * The bot's answer for a world is the same every frame until the next tick is folded or a rollback replaces it, and
 * planning it is the most expensive thing the forward run does: ask it once per chopper, step and frame revision.
 */
export function memoBot(bot: BotInput): (revision: number) => BotInput {
  const cache = new Map<string, number>();
  return (revision) => (world, chopper) => {
    const key = `${revision}:${world.seed}:${world.step}:${chopper.id}`;
    let bits = cache.get(key);
    if (bits === undefined) {
      // Old steps are never asked for again: a handful of entries is all a frame needs.
      if (cache.size >= 256) cache.clear();
      bits = bot(world, chopper);
      cache.set(key, bits);
    }
    return bits;
  };
}

/** An effect within this many steps and pixels of one already shown, of the same kind and seat, is the same effect. */
export const TWIN_STEPS = 6,
  TWIN_PX = 20;

/**
 * Keeps an effect from going off twice. The scene draws an effect the first time it sees it, keyed by what, who,
 * when and where. A forward run can show one the next run takes back (a rollback, another pilot's controls
 * changing), and the room then folds the same event a step or a few pixels away: the same spark, drawn twice.
 * Within a round, an effect that close to one already handed to the scene is therefore left out of the picture.
 */
export function createCueLatch(): (view: WorldView) => WorldView {
  type Shown = WorldView["fx"][number];
  let seed = -1,
    shown: Shown[] = [],
    kept = new Set<string>(),
    dropped = new Set<string>();
  return (view) => {
    if (view.seed !== seed) {
      seed = view.seed;
      shown = [];
      kept = new Set();
      dropped = new Set();
    }
    if (!view.fx.length) return view;
    let same = true;
    const fresh: Shown[] = [];
    const fx = view.fx.filter((each) => {
      const key = effectKey(each);
      if (kept.has(key)) return true;
      const twin =
        dropped.has(key) ||
        shown.some(
          (other) =>
            other.kind === each.kind &&
            other.slot === each.slot &&
            Math.abs(other.at - each.at) <= TWIN_STEPS &&
            Math.hypot(other.x - each.x, other.y - each.y) <= TWIN_PX,
        );
      if (twin) {
        dropped.add(key);
        same = false;
        return false;
      }
      kept.add(key);
      fresh.push(each);
      return true;
    });
    // Only an effect from an earlier frame has twins: two sparks that are new together are two sparks.
    shown.push(...fresh);
    // Effects live under a second: what was shown long ago can neither return nor have a twin.
    if (shown.length > 200) {
      shown = shown.filter((each) => view.step - each.at <= 120);
      kept = new Set(shown.map(effectKey));
      dropped = new Set([...dropped].slice(-200));
    }
    return same ? view : { ...view, fx };
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 90;

export interface Smoother {
  /**
   * `view` with corrections hidden. `revision` is the runtime's frame revision (a rollback replaced history) and
   * `folded` the newest folded step; `held` is what each seat had logged as of that step; `me` is this device's
   * own chopper, which is never smoothed.
   */
  apply(
    view: WorldView,
    revision: number,
    folded: number,
    held: Readonly<Record<string, number>>,
    nowMs: number,
    me: string,
  ): WorldView;
}

/**
 * Hides what the forward run got wrong. The other choppers are drawn where the room's newest inputs put them; when
 * a rollback moves them, or a new tick shows another pilot changed what they hold, the screen keeps them where
 * they were and lets the difference decay.
 */
export function createSmoother(
  smoother: CorrectionSmoother = createCorrectionSmoother({
    decayMs: DECAY_MS,
    teleport: TELEPORT,
  }),
): Smoother {
  let revision: number | undefined,
    folded = -1,
    logged: Readonly<Record<string, number>> = {},
    key = "";
  return {
    apply(view, nextRevision, nextFolded, held, nowMs, me) {
      const round = `${view.seed}:${view.phase}`;
      // A new round or a new phase starts again: nothing carries over.
      if (round !== key) {
        key = round;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision,
        stepped = nextFolded !== folded;
      // A chopper the forward run got wrong is one whose logged controls changed with this tick: the others moved as drawn.
      const before = logged,
        changed = (id: string) =>
          stepped && (before[id] ?? 0) !== (held[id] ?? 0);
      revision = nextRevision;
      folded = nextFolded;
      logged = held;
      if (view.phase !== "play") return view;
      return {
        ...view,
        choppers: view.choppers.map((chopper) => {
          if (chopper.id === me || chopper.state !== "flying") return chopper;
          const drawn = smoother.place(
            `chopper:${chopper.id}`,
            chopper,
            rolled || changed(chopper.id),
          );
          return drawn.x === chopper.x && drawn.y === chopper.y
            ? chopper
            : { ...chopper, x: drawn.x, y: drawn.y };
        }),
      };
    },
  };
}
