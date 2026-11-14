import {
  MAX_TICKS_AHEAD,
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import {
  STEPS_PER_TICK,
  cloneWorld,
  stepWorld,
  toView,
  type World,
  type WorldView,
} from "../engine/index.js";
import { SAND_Y } from "../engine/view-kit.js";
import type { BotInput, Room } from "../online/game.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded world is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * log tick the clock has run past it, with the bits each blob holds (this device's own live, logged or not), and
 * draws that. A press shows on the next animation frame, and what is drawn is what the fold will produce unless
 * another player's controls change first. The copy is thrown away: nothing here reaches the room.
 *
 * `ahead` is in log ticks (0–`MAX_TICKS_AHEAD`, fractional), as `ticksAhead` and `createLeadClock` from fuse-netcode
 * give it; the two whole steps either side are blended, so a 120 Hz screen moves the blobs and the ball every frame.
 *
 * The forward run never crosses the end of a rally: a point, a side-out, the next serve and the end of the match are
 * shown when the room has folded them, never on a guess. A touch that puts a hovering serve in play is not held back:
 * that is the player's own hit, and it must show at once.
 */
export interface ForwardInputs {
  /** What the blob in `slot` is taken to hold for the tick being played: a bot's answer, a human's last logged bits (this device's own live), 0 when away. */
  held(world: World, slot: number): number;
}

/** The furthest the screen plays past the newest folded world, in steps. */
export const MAX_AHEAD = STEPS_PER_TICK * MAX_TICKS_AHEAD;

/** A copy of the world deep enough for `stepWorld` to run on without touching the original. */
export const copyWorld = (world: World): World => cloneWorld(world);

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** `a` and `b` one step apart, `t` of the way from one to the other; counters and flags are `a`'s until `t` reaches 1. */
export function blendViews(a: WorldView, b: WorldView, t: number): WorldView {
  if (t <= 0) return a;
  if (t >= 1) return b;
  // A serve teleports the ball and a new serve starts over: never smear across one.
  if (a.phase !== b.phase && (b.phase === "serve" || a.phase === "serve"))
    return a;
  return {
    ...a,
    blobs: a.blobs.map((blob, slot) => {
      const next = b.blobs[slot] ?? blob;
      return { ...blob, x: mix(blob.x, next.x, t), y: mix(blob.y, next.y, t) };
    }),
    ball: {
      ...a.ball,
      x: mix(a.ball.x, b.ball.x, t),
      y: mix(a.ball.y, b.ball.y, t),
      spin: a.ball.spin,
    },
  };
}

/** `now` has moved past what the room has folded from `from`: a rally ended, a serve came, the match ended. */
function crossed(from: World, now: World): boolean {
  if (now.pointCounter !== from.pointCounter) return true;
  if (now.score[0] !== from.score[0] || now.score[1] !== from.score[1])
    return true;
  if (now.points.some((points, team) => points !== from.points[team]))
    return true;
  return (
    now.phase !== from.phase &&
    !(from.phase === "serve" && now.phase === "rally")
  );
}

interface Run {
  /** The copy after the whole steps taken. */
  copy: World;
  taken: number;
  /** The copy one step further, when the clock is `part` of the way into that step. */
  next?: World;
  part: number;
  /** The last step taken crossed the end of a rally. */
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
  let taken = 0;
  for (let left = ahead; left > 0; left -= 1) {
    // As the fold does: ask everyone what they hold for the tick, then step it.
    const held = copy.blobs.map((_, slot) => inputs.held(copy, slot)),
      steps = Math.min(1, left) * STEPS_PER_TICK,
      whole = Math.floor(steps);
    for (let i = 0; i < whole; i++) {
      if (taken >= limit || copy.phase === "over")
        return { copy, taken, part: 0, crossed: false };
      stepWorld(copy, held);
      taken++;
      if (crossed(world, copy)) return { copy, taken, part: 0, crossed: true };
    }
    const part = steps - whole;
    if (left <= 1 && part > 0.001 && taken < limit && copy.phase !== "over") {
      const next = copyWorld(copy);
      stepWorld(next, held);
      if (!crossed(world, next))
        return { copy, taken, next, part, crossed: false };
    }
  }
  return { copy, taken, part: 0, crossed: false };
}

/** The newest world played forward `ahead` log ticks (0–`MAX_TICKS_AHEAD`, fractional), as a view to draw. */
export function forward(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
): WorldView {
  const ticks = Math.max(0, Math.min(MAX_TICKS_AHEAD, ahead));
  let result = run(world, ticks, inputs, Infinity);
  // A step that ended the rally is not shown: play again up to the step before it.
  if (result.crossed) result = run(world, ticks, inputs, result.taken - 1);
  const view = toView(result.copy);
  return result.next
    ? blendViews(view, toView(result.next), result.part)
    : view;
}

/**
 * The bits the forward run plays for each blob: a bot answers as the fold would, a seated human holds what it last
 * logged, and this device's own blob holds what its player holds right now.
 */
export function forwardInputs(
  room: Room,
  me: string,
  live: number,
  bot: BotInput,
): ForwardInputs {
  return {
    held(world, slot) {
      const id = world.blobs[slot]?.id ?? "";
      const seat = room.seats.get(id);
      if (seat?.bot) return bot(world, slot, room.play.bot);
      if (!seat?.connected) return 0;
      if (id === me) return live;
      return room.held[id] ?? 0;
    },
  };
}

/**
 * The bot's answer for a world is the same every frame until the next tick is folded or a rollback replaces it, and
 * planning it steps many ghost worlds: ask it once per frame revision, step and blob.
 */
export function memoBot(bot: BotInput): (revision: number) => BotInput {
  const cache = new Map<string, number>();
  return (revision) => (world, slot, level) => {
    const key = `${revision}:${world.step}:${world.seed}:${slot}:${level}`;
    let bits = cache.get(key);
    if (bits === undefined) {
      // Old steps are never asked for again: a handful of entries is all a frame needs.
      if (cache.size >= 64) cache.clear();
      bits = bot(world, slot, level);
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
const COUNTERS = [
  "hitCounter",
  "netCounter",
  "floorCounter",
  "pointCounter",
] as const;

/**
 * Keeps an effect from firing twice. The scene sounds a touch, the net or the sand when its counter goes up between
 * two drawn views. A forward run can show a count the next one takes back (a rollback, another player's controls
 * changing), and the count then goes up again when the room folds the event: the same touch, heard twice. Within a
 * match the counts handed to the scene therefore never go back; the confirmed event finds its count already shown.
 */
export function createCueLatch(): (
  view: WorldView,
  matchId: string,
) => WorldView {
  let match = "",
    shown: Partial<Record<(typeof COUNTERS)[number], number>> = {};
  return (view, matchId) => {
    const key = `${matchId}:${view.format}:${view.blobs.length}`;
    if (key !== match) {
      match = key;
      shown = {};
    }
    let changed: Partial<WorldView> | undefined;
    for (const name of COUNTERS) {
      const was = shown[name],
        now = view[name];
      const count = was === undefined || gained(was, now) > 0 ? now : was;
      shown[name] = count;
      if (count !== now) (changed ??= {})[name] = count;
    }
    return changed ? { ...view, ...changed } : view;
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels (a new serve) is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 120;

export interface Smoother {
  /**
   * `view` with corrections hidden. `revision` is the runtime's frame revision (a rollback replaced history) and
   * `folded` the newest folded step; `held` is what each blob, by slot, had logged as of that step; `local` is this
   * device's blob slot, or −1, and is never smoothed.
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
 * Hides what the forward run got wrong. The ball and the other blobs are drawn where the room's newest inputs put
 * them; when a rollback moves them, or a new tick shows another player changed what they hold, the screen keeps them
 * where they were and lets the difference decay. Only then: a ball's bounce is never smeared on a guess.
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
      // A new serve, a new rally's teams or a new match is a teleport by design: start again.
      const rally = `${view.format}:${view.blobs.length}:${view.pointCounter}:${view.phase === "dead" ? "dead" : "live"}`;
      if (rally !== key) {
        key = rally;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision,
        stepped = nextFolded !== folded;
      // A blob the forward run got wrong is one whose logged controls changed with this tick: the others moved as drawn.
      const before = logged,
        changed = (slot: number) =>
          stepped && (before[slot] ?? 0) !== (held[slot] ?? 0);
      revision = nextRevision;
      folded = nextFolded;
      logged = held;
      return {
        ...view,
        blobs: view.blobs.map((blob, slot) => {
          if (slot === local || blob.benched) return blob;
          const drawn = smoother.place(
            `blob:${slot}`,
            blob,
            rolled || changed(slot),
          );
          return { ...blob, x: drawn.x, y: Math.min(drawn.y, SAND_Y) };
        }),
        ball: { ...view.ball, ...smoother.place("ball", view.ball, rolled) },
      };
    },
  };
}
