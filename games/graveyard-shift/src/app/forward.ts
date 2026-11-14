import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import { toView, type WorldView } from "../engine/view.js";
import { stepWorld, type Hunter, type World } from "../engine/world.js";
import type { Room } from "../online/game.js";

/**
 * Draw at the clock, not at the last folded tick. The night steps once per 50 ms log tick, so drawing the newest
 * folded world moves everything twenty times a second and shows a press up to a tick late. The screen instead plays
 * that world forward on a copy, by the fraction of a tick the clock has run past it, with what each hunter holds
 * (this device's own live, logged or not), and draws that: a press shows on the next animation frame and motion is as
 * smooth as the display. The copy is thrown away: nothing here reaches the room.
 *
 * The forward run never crosses a change of score: energy banked at a shrine is shown when the room has folded it.
 */
export interface ForwardInputs {
  /** What `hunter` is taken to hold for the step being played. */
  held(world: World, hunter: Hunter): number;
}

/** A step moves a hunter 6 px, a pulse throws one 32: anything further is a new night, shown as it is. */
const JUMP = 60;

/** `newer` with every hunter and free ghost `part` of the way from where `older` has it. */
export function blend(
  older: WorldView,
  newer: WorldView,
  part: number,
): WorldView {
  if (part >= 1) return newer;
  const a = Math.max(0, part);
  const mix = <T extends { x: number; y: number }>(
    was: T | undefined,
    now: T,
  ): T =>
    was && Math.hypot(now.x - was.x, now.y - was.y) <= JUMP
      ? {
          ...now,
          x: was.x + (now.x - was.x) * a,
          y: was.y + (now.y - was.y) * a,
        }
      : now;
  const hunters = new Map(older.hunters.map((h) => [h.id, h])),
    ghosts = new Map(older.ghosts.map((g) => [g.id, g]));
  return {
    ...newer,
    hunters: newer.hunters.map((h) => mix(hunters.get(h.id), h)),
    ghosts: newer.ghosts.map((g) => {
      const was = ghosts.get(g.id);
      // A ghost just sucked in or thrown out of a tank changes hands, it does not travel.
      return was && was.carrier === g.carrier ? mix(was, g) : g;
    }),
  };
}

const score = (world: World) =>
  world.hunters.reduce((sum, hunter) => sum + hunter.score, 0);

/** The newest world played forward `ahead` log ticks (0–2, fractional), as a view to draw. */
export function forward(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
): WorldView {
  const banked = score(world);
  const step = (from: World): World | undefined => {
    const next = structuredClone(from);
    stepWorld(
      next,
      new Map(next.hunters.map((h) => [h.id, inputs.held(next, h)])),
    );
    // A step that banked energy, or the night's end, is the room's to show.
    return next.tick === from.tick || score(next) !== banked ? undefined : next;
  };
  let copy = world,
    left = Math.max(0, ahead);
  for (; left >= 1; left -= 1) {
    const next = step(copy);
    if (!next) return toView(copy);
    copy = next;
  }
  const view = toView(copy);
  if (left <= 0.001) return view;
  const next = step(copy);
  return next ? blend(view, toView(next), left) : view;
}

/** A bot answers as the fold would, a seated human holds what it last logged, and this device's hunter what its player holds now. */
export function forwardInputs(
  room: Room,
  me: string,
  live: number,
  bot: (world: World, hunter: Hunter) => number,
): ForwardInputs {
  return {
    held(world, hunter) {
      const seat = room.seats.get(hunter.id);
      if (seat?.bot) return bot(world, hunter);
      if (!seat?.connected) return 0;
      if (hunter.id === me) return live;
      return room.held[hunter.id] ?? 0;
    },
  };
}

/** A bot's answer for a world is the same every frame until a rollback replaces it: ask once per hunter, tick and scope (the match and the frame revision). */
export function memoBot(
  bot: (world: World, hunter: Hunter) => number,
): (scope: number | string) => (world: World, hunter: Hunter) => number {
  const cache = new Map<string, number>();
  return (scope) => (world, hunter) => {
    const key = `${scope}:${world.tick}:${hunter.id}`;
    let bits = cache.get(key);
    if (bits === undefined) {
      if (cache.size >= 64) cache.clear();
      bits = bot(world, hunter);
      cache.set(key, bits);
    }
    return bits;
  };
}

export const DECAY_MS = 45,
  TELEPORT = 90;

export interface Smoother {
  /**
   * `view` with corrections hidden. `revision` is the runtime's frame revision (a rollback replaced history),
   * `folded` the newest folded tick and `held` what each hunter had logged as of it; `me` is never smoothed.
   */
  apply(
    view: WorldView,
    key: string,
    revision: number,
    folded: number,
    held: Readonly<Record<string, number>>,
    nowMs: number,
    me: string,
  ): WorldView;
}

/**
 * Hides what the forward run got wrong: when a rollback moves the other hunters and the ghosts, or a new tick shows
 * another hunter changed what they hold, the screen keeps them where they were and lets the difference decay.
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
    night = "";
  return {
    apply(view, key, nextRevision, nextFolded, held, nowMs, me) {
      if (key !== night) {
        night = key;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision,
        stepped = nextFolded !== folded,
        before = logged;
      revision = nextRevision;
      folded = nextFolded;
      logged = { ...held };
      const at = <T extends { x: number; y: number }>(
        name: string,
        body: T,
        absorb: boolean,
      ): T => ({ ...body, ...smoother.place(name, body, absorb) });
      return {
        ...view,
        hunters: view.hunters.map((h) =>
          h.id === me
            ? h
            : at(
                `hunter:${h.id}`,
                h,
                rolled ||
                  (stepped && (before[h.id] ?? 0) !== (held[h.id] ?? 0)),
              ),
        ),
        ghosts: view.ghosts.map((g) =>
          g.carrier ? g : at(`ghost:${g.id}`, g, rolled),
        ),
      };
    },
  };
}
