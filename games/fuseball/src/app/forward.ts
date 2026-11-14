import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import {
  copyWorld,
  mapOf,
  paceTick,
  stepWorld,
  toView,
  type Rider,
  type World,
  type WorldView,
} from "../engine/index.js";
import type { BotInput, Room } from "../online/game.js";
import { blend } from "../render/interpolate.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded world is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * log tick the clock has run past it, with the bits each rider holds (this device's own live, logged or not), and
 * draws that. A press shows on the next animation frame instead of 50–100 ms later, and what is drawn is what the
 * fold will produce unless another rider's controls change first. The copy is thrown away: nothing here reaches the
 * room.
 *
 * The forward run never crosses a change of phase or score: a goal, the end of a countdown and the end of the match
 * are shown when the room has folded them, never on a guess.
 */
export interface ForwardInputs {
  /** What `rider` is taken to hold for the tick being played: a human's last logged bits, a bot's answer, 0 when away. */
  held(world: World, rider: Rider): number;
}

interface Run {
  /** The copy after the whole steps taken. */
  copy: World;
  taken: number;
  /** The copy one step further, when the clock is `part` of the way into that step. */
  next?: World;
  part: number;
  /** The last step taken scored or changed the phase. */
  crossed: boolean;
}

/** Runs `ahead` log ticks (fractional) of `world` on a copy, at most `limit` whole steps. */
function run(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
  limit: number,
): Run {
  const copy = copyWorld(world);
  const moved = (now: World) =>
    now.phase !== world.phase ||
    now.score[0] !== world.score[0] ||
    now.score[1] !== world.score[1];
  let taken = 0;
  for (let left = ahead; left > 0; left -= 1) {
    // As the fold does: set the tick's pace, then ask everyone what they hold for it.
    const count = paceTick(copy),
      held = new Map(
        copy.riders.map((rider) => [rider.id, inputs.held(copy, rider)]),
      ),
      steps = Math.min(1, left) * count,
      whole = Math.floor(steps);
    for (let i = 0; i < whole; i++) {
      if (taken >= limit) return { copy, taken, part: 0, crossed: false };
      stepWorld(copy, held);
      taken++;
      if (moved(copy)) return { copy, taken, part: 0, crossed: true };
    }
    const part = steps - whole;
    if (left <= 1 && part > 0.001 && taken < limit) {
      const next = copyWorld(copy);
      stepWorld(next, held);
      if (!moved(next)) return { copy, taken, next, part, crossed: false };
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
  // A step that scored or changed the phase is not shown: play again up to the step before it.
  if (result.crossed)
    result = run(world, Math.max(0, ahead), inputs, result.taken - 1);
  const view = toView(result.copy);
  return result.next ? blend(view, toView(result.next), result.part) : view;
}

/**
 * The bits the forward run plays for each rider: a bot answers as the fold would, a seated human holds what it last
 * logged, and this device's own rider holds what its player holds right now.
 */
export function forwardInputs(
  room: Room,
  me: string,
  live: number,
  bot: BotInput,
): ForwardInputs {
  return {
    held(world, rider) {
      const seat = room.seats.get(rider.id);
      if (seat?.bot) return bot(world, rider);
      if (!seat?.connected) return 0;
      if (rider.id === me) return live;
      return room.held[rider.id] ?? 0;
    },
  };
}

/**
 * The bot's answer for a world is the same every frame until the next tick is folded or a rollback replaces it, and
 * planning it is the most expensive thing the forward run does: ask it once per rider, step and frame revision.
 */
export function memoBot(bot: BotInput): (revision: number) => BotInput {
  const cache = new Map<string, number>();
  return (revision) => (world, rider) => {
    const key = `${revision}:${world.step}:${rider.id}`;
    let bits = cache.get(key);
    if (bits === undefined) {
      // Old steps are never asked for again: a handful of entries is all a frame needs.
      if (cache.size >= 64) cache.clear();
      bits = bot(world, rider);
      cache.set(key, bits);
    }
    return bits;
  };
}

/** How far a wrapping 16-bit counter moved forwards; 0 when it stood still or went back. */
const COUNTER = 0x10000;
const gained = (was: number, now: number): number => {
  const moved = (now - was + COUNTER) % COUNTER;
  return moved < COUNTER / 2 ? moved : 0;
};

/**
 * Keeps an effect from firing twice. The scene fires a jump or a bounce when its counter goes up between two drawn
 * views. A forward run can show a count the next one takes back (a rollback, another rider's controls changing), and
 * the count then goes up again when the room folds the event: the same jump, heard twice. Within a match the counts
 * handed to the scene therefore never go back; the confirmed event finds its count already shown.
 */
export function createCueLatch(): (
  view: WorldView,
  matchId: string,
) => WorldView {
  let match = "",
    jumps: number[] = [],
    bounces: number | undefined;
  return (view, matchId) => {
    const key = `${matchId}:${view.mapId}:${view.seed}:${view.riders.length}`;
    if (key !== match) {
      match = key;
      jumps = [];
      bounces = undefined;
    }
    const hold = (was: number | undefined, now: number): number =>
      was === undefined || gained(was, now) > 0 ? now : was;
    let same = true;
    const riders = view.riders.map((rider) => {
      const count = (jumps[rider.index] = hold(
        jumps[rider.index],
        rider.jumps,
      ));
      if (count === rider.jumps) return rider;
      same = false;
      return { ...rider, jumps: count };
    });
    bounces = hold(bounces, view.ball.bounces);
    if (same && bounces === view.ball.bounces) return view;
    return {
      ...view,
      riders: riders as WorldView["riders"],
      ball: { ...view.ball, bounces },
    };
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels (a point reset, a wrapped edge) is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 90;

export interface Smoother {
  /**
   * `view` with corrections hidden. `revision` is the runtime's frame revision (a rollback replaced history) and
   * `folded` the newest folded step; `held` is what each rider, by index, had logged as of that step; `local` is
   * this device's rider index, or −1, and is never smoothed.
   */
  apply(
    view: WorldView,
    revision: number,
    folded: number,
    held: readonly number[],
    nowMs: number,
    local: number,
  ): WorldView;
}

/**
 * Hides what the forward run got wrong. The ball and the other riders are drawn where the room's newest inputs put
 * them; when a rollback moves them, or a new tick shows another rider changed what they hold, the
 * screen keeps them where they were and lets the difference decay.
 */
export function createSmoother(
  smoother: CorrectionSmoother = createCorrectionSmoother({
    decayMs: DECAY_MS,
    teleport: TELEPORT,
  }),
): Smoother {
  let revision: number | undefined,
    folded = -1,
    logged: readonly number[] = [],
    key = "";
  return {
    apply(view, nextRevision, nextFolded, held, nowMs, local) {
      const match = `${view.mapId}:${view.seed}:${view.phase}:${view.score.join("-")}`;
      // A point reset, a new arena or a countdown is a teleport by design: start again.
      if (match !== key) {
        key = match;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision,
        stepped = nextFolded !== folded;
      // A rider the forward run got wrong is one whose logged controls changed with this tick: the others moved as drawn.
      const before = logged,
        changed = (index: number) =>
          stepped && (before[index] ?? 0) !== (held[index] ?? 0);
      revision = nextRevision;
      folded = nextFolded;
      logged = held;
      if (view.phase !== "play") return view;
      const map = mapOf(view.mapId, view.seed);
      const wrap = (value: number, size: number, wraps: boolean) =>
        wraps ? ((value % size) + size) % size : value;
      const at = <T extends { x: number; y: number }>(
        name: string,
        body: T,
        absorb: boolean,
      ): T => {
        const drawn = smoother.place(name, body, absorb);
        return {
          ...body,
          x: wrap(drawn.x, map.w, map.wrapX),
          y: wrap(drawn.y, map.h, map.wrapY),
        };
      };
      return {
        ...view,
        riders: view.riders.map((rider) =>
          rider.index === local || rider.zapped
            ? rider
            : at(`rider:${rider.index}`, rider, rolled || changed(rider.index)),
        ) as WorldView["riders"],
        ball: view.ball.live ? at("ball", view.ball, rolled) : view.ball,
      };
    },
  };
}
