import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import {
  STEPS_PER_TICK,
  campOver,
  defeated,
  stageCleared,
  step,
  toView,
  type World,
  type WorldView,
} from "../engine/index.js";
import { playerOf, type Room } from "../online/game.js";
import { blend } from "./interpolate.js";

/**
 * Draw at the clock, not a tick behind. The page used to blend the two newest folded worlds, always right and always
 * 50–100 ms late. Instead the newest folded world is played forward, by the fraction of a log tick the clock has run
 * past it, with the bits each hero's seat holds (this device's own live, logged or not) and the bots answering as the
 * fold asks them, and that is drawn: a press shows on the next animation frame. A step returns a new world, so the
 * room's is never touched and nothing here reaches it.
 *
 * The run never crosses what the room decides: a stage cleared, the party all out, or camp breaking up is shown when
 * the room has folded it, never on a guess.
 */
export interface ForwardInputs {
  /** The bits every hero is taken to hold for the tick that starts at `world`, by seat index, as the fold lays them out. */
  held(world: World): number[];
}

const decided = (world: World) =>
  `${stageCleared(world)}:${defeated(world)}:${world.camp && campOver(world)}`;

/** The newest world played forward `ahead` log ticks (0–2, fractional), as a view to draw. */
export function forward(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
): WorldView {
  const was = decided(world);
  let copy = world;
  for (let left = Math.max(0, ahead); left > 0; left -= 1) {
    const held = inputs.held(copy),
      steps = Math.min(1, left) * STEPS_PER_TICK,
      whole = Math.floor(steps + 0.001);
    for (let index = 0; index < whole; index++) {
      const next = step(copy, held);
      if (decided(next) !== was) return toView(copy);
      copy = next;
    }
    const part = steps - whole;
    if (left <= 1 && part > 0.001) {
      const next = step(copy, held);
      if (decided(next) === was) return blend(toView(copy), toView(next), part);
    }
  }
  return toView(copy);
}

/** The bits a bot holds for the tick starting at `world`, as the fold asks: `botInput` with the heroes present players steer. */
export type BotAnswer = (
  world: World,
  heroId: number,
  humans: readonly number[],
) => number;

/**
 * The bits the forward run plays, as `playTick` lays them out but without the log: a bot answers as the fold would, a
 * present human holds what it last logged, an absent seat nothing, and this device's own hero what its player holds
 * right now.
 */
export function forwardInputs(
  room: Room,
  me: string,
  live: number,
  bot: BotAnswer,
): ForwardInputs {
  return {
    held(world) {
      const seats = world.heroes.map((hero) =>
        playerOf(room, hero.seat, hero.kind),
      );
      const humans = world.heroes
        .filter((_, index) => !seats[index]?.bot && seats[index]?.connected)
        .map((hero) => hero.id);
      const held: number[] = [];
      world.heroes.forEach((hero, index) => {
        const seat = seats[index];
        held[hero.seat] = seat?.bot
          ? bot(world, hero.id, humans)
          : !seat?.connected
            ? 0
            : seat.id === me
              ? live
              : (room.held[seat.id] ?? 0);
      });
      return held;
    },
  };
}

/** What each hero's seat had logged as of the room's newest fold, by seat index: the smoother's `held`. */
export const loggedBits = (room: Room, world: World): number[] => {
  const held: number[] = [];
  for (const hero of world.heroes) {
    const seat = playerOf(room, hero.seat, hero.kind);
    held[hero.seat] = seat && !seat.bot ? (room.held[seat.id] ?? 0) : 0;
  }
  return held;
};

/** A bot's answer for a world is the same every frame until a rollback replaces it: ask once per hero, step and revision. */
export function memoBot(bot: BotAnswer): (revision: number) => BotAnswer {
  const cache = new Map<string, number>();
  return (revision) => (world, heroId, humans) => {
    const key = `${revision}:${world.stage}:${world.camp}:${world.step}:${heroId}`;
    let bits = cache.get(key);
    if (bits === undefined) {
      if (cache.size >= 64) cache.clear();
      bits = bot(world, heroId, humans);
      cache.set(key, bits);
    }
    return bits;
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels (a drop back in) is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 48;

export interface Smoother {
  /**
   * `view` with corrections hidden. `key` names the run, stage and camp; `revision` is the runtime's frame revision
   * (a rollback replaced history) and `folded` the newest folded step; `held` is what each hero's seat, by seat
   * index, had logged as of that step; `local` is this device's seat index, or −1, and its hero is never smoothed.
   */
  apply(
    view: WorldView,
    key: string,
    revision: number,
    folded: number,
    held: readonly number[],
    nowMs: number,
    local: number,
  ): WorldView;
}

/**
 * Hides what the forward run got wrong. The other heroes, the enemies and the beasts are drawn where the room's
 * newest inputs put them; when a rollback moves them, or a new tick shows another hero's seat changed what it holds,
 * the screen keeps them where they were and lets the difference decay. A beast takes its rider's correction, so the
 * two never part.
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
    scope = "";
  return {
    apply(view, key, nextRevision, nextFolded, held, nowMs, local) {
      if (key !== scope) {
        scope = key;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision,
        stepped = nextFolded !== folded,
        before = logged;
      revision = nextRevision;
      folded = nextFolded;
      logged = [...held];
      const shifts = new Map<string, { x: number; y: number }>();
      // Screen space, as the view promises whole pixels there: the camera's own motion is not a correction.
      const at = <T extends { id: number; x: number; y: number }>(
        name: string,
        body: T,
        absorb: boolean,
      ): T => {
        const drawn = smoother.place(
            `${name}:${body.id}`,
            { x: body.x - view.camX, y: body.y },
            absorb,
          ),
          shift = {
            x: Math.round(drawn.x) - (body.x - view.camX),
            y: Math.round(drawn.y) - body.y,
          };
        shifts.set(`${name}:${body.id}`, shift);
        return shift.x || shift.y
          ? { ...body, x: body.x + shift.x, y: body.y + shift.y }
          : body;
      };
      const heroes = view.heroes.map((hero) =>
          hero.seat === local
            ? hero
            : at(
                "hero",
                hero,
                rolled ||
                  (stepped &&
                    (before[hero.seat] ?? 0) !== (held[hero.seat] ?? 0)),
              ),
        ),
        enemies = view.enemies.map((enemy) => at("enemy", enemy, rolled));
      return {
        ...view,
        heroes,
        enemies,
        mounts: view.mounts.map((mount) => {
          if (!mount.rider) return at("mount", mount, rolled);
          const shift = shifts.get(`${mount.rider.kind}:${mount.rider.id}`);
          return shift && (shift.x || shift.y)
            ? { ...mount, x: mount.x + shift.x, y: mount.y + shift.y }
            : mount;
        }),
      };
    },
  };
}
