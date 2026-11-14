import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import {
  NO_WINNER,
  STEPS_PER_TICK,
  botCommands,
  step,
  viewOf,
  type CombatEvent,
  type Command,
  type GameMap,
  type World,
  type WorldView,
} from "../engine/index.js";
import { mapOf, ridden, type Room } from "../online/game.js";

/**
 * Draw at the clock, not a tick behind. The battlefield used to be drawn between the two newest folded worlds, always
 * right and 50–100 ms late. Instead the newest folded world is played forward, by the fraction of a log tick the
 * clock has run past it, with the orders this device has logged but the room has not folded yet and the bots sending
 * what the fold will have them send, and that is drawn: a click or a push of the stick shows on the next animation
 * frame. Every other rider's hero carries on with the order it has. A step returns a new world, so the room's is
 * never touched and nothing here reaches it.
 *
 * The run never crosses what the room decides: a hero's death, a building's fall, a flag changing hands and the
 * result are shown when the room has folded them, never on a guess. The HUD, the feed, the radar and every sound
 * still read the folded world and its events; only the battlefield is drawn ahead.
 */
export interface Lead {
  /** The world to draw, and the one a step before it to draw from (`Renderer.draw`'s `older`). */
  world: WorldView;
  before: WorldView | undefined;
  /** How far from `before` to `world`, 0 to 1. */
  t: number;
}

const DECIDES: ReadonlySet<CombatEvent["type"]> = new Set([
  "heroDeath",
  "destroyed",
  "capture",
  "won",
]);

interface Chain {
  key: string;
  /** `worlds[n]` is the folded world after `n` forward steps. */
  worlds: World[];
  /** The step after the last world decides something: the chain ends there. */
  ended: boolean;
}

/**
 * A forward run costs a step of the whole battlefield, and a frame needs the same few steps as the frame before it
 * until the room folds another tick, a rollback replaces it or this device logs an order. So the steps are kept:
 * `key` names the folded world and the orders played on it, and a frame only takes the steps no earlier frame took.
 * The views are kept with them, so the renderer sees the same objects from frame to frame.
 */
export function createForward(): (
  room: Room,
  ahead: number,
  revision: number,
  pending: readonly Command[],
) => Lead | undefined {
  let chain: Chain | undefined;
  const views = new WeakMap<World, WorldView>();
  const view = (map: GameMap, world: World): WorldView => {
    let made = views.get(world);
    if (!made) views.set(world, (made = viewOf(map, world)));
    return made;
  };
  return (room, ahead, revision, pending) => {
    const folded = room.world;
    // Before the countdown ends the fold steps nothing, and neither does this.
    if (!folded || room.stage !== "running" || room.tick + 1 < room.startAt)
      return undefined;
    const map = mapOf(room),
      key = `${revision}:${room.matchId}:${folded.step}:${JSON.stringify(pending)}`;
    if (chain?.key !== key || chain.worlds[0] !== folded)
      chain = { key, worlds: [folded], ended: false };
    const { worlds } = chain;
    /** The world after `count` steps, or the last one before a step that decides something. */
    const reach = (count: number): number => {
      while (worlds.length <= count && !chain!.ended) {
        const index = worlds.length - 1,
          from = worlds[index]!;
        // As the fold does: a tick's commands go to its first step, a bot's from the world as the tick begins.
        const commands =
          index % STEPS_PER_TICK === 0
            ? from.players.flatMap(({ seat }) =>
                !ridden(room, seat)
                  ? botCommands(map, from, seat, room.play.bots[seat]!)
                  : index === 0
                    ? pending.filter((command) => command.seat === seat)
                    : [],
              )
            : [];
        const next = step(map, from, commands);
        if (
          next.winner !== NO_WINNER ||
          next.events.some((event) => DECIDES.has(event.type))
        )
          chain!.ended = true;
        else worlds.push(next);
      }
      return Math.min(count, worlds.length - 1);
    };
    const steps = Math.max(0, ahead) * STEPS_PER_TICK,
      whole = Math.floor(steps + 0.001),
      part = steps - whole,
      at = reach(whole);
    if (at === whole && part > 0.001 && reach(whole + 1) === whole + 1)
      return {
        world: view(map, worlds[whole + 1]!),
        before: view(map, worlds[whole]!),
        t: part,
      };
    return {
      world: view(map, worlds[at]!),
      before: at > 0 ? view(map, worlds[at - 1]!) : undefined,
      t: 1,
    };
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` sub-pixels (a respawn, a DASH, a BLINK) is shown as it is. */
export const DECAY_MS = 45;

export interface Smoother {
  /**
   * `lead` with corrections to the other heroes hidden. `revision` is the runtime's frame revision (a rollback
   * replaced history); `self` is this device's seat, or −1, and its hero is never smoothed.
   */
  apply(
    lead: Lead,
    key: string,
    revision: number,
    nowMs: number,
    self: number,
  ): Lead;
}

/**
 * Hides what the forward run got wrong about the other heroes. A rider's order the room folds late rolls the world
 * back, and their hero would snap to where it really went; the screen keeps it where it was drawn and lets the
 * difference decay. Units are many and slow, and move on the rules alone, so they are drawn as they are.
 */
export function createSmoother(
  teleport: number,
  smoother: CorrectionSmoother = createCorrectionSmoother({
    decayMs: DECAY_MS,
    teleport,
  }),
): Smoother {
  let revision: number | undefined,
    scope = "";
  return {
    apply(lead, key, nextRevision, nowMs, self) {
      if (key !== scope) {
        scope = key;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision;
      revision = nextRevision;
      const { world, before, t } = lead,
        was = new Map(before?.heroes.map((hero) => [hero.seat, hero]));
      const shifts = new Map<number, { x: number; y: number }>();
      for (const hero of world.heroes) {
        if (hero.seat === self || hero.respawn > 0) continue;
        // Where the renderer will draw it: between the two worlds, as `draw` does.
        const from = was.get(hero.seat) ?? hero,
          point = {
            x: from.x + (hero.x - from.x) * t,
            y: from.y + (hero.y - from.y) * t,
          },
          drawn = smoother.place(`hero:${hero.seat}`, point, rolled),
          shift = {
            x: Math.round(drawn.x - point.x),
            y: Math.round(drawn.y - point.y),
          };
        if (shift.x || shift.y) shifts.set(hero.seat, shift);
      }
      if (shifts.size === 0) return lead;
      const moved = (view: WorldView): WorldView => ({
        ...view,
        heroes: view.heroes.map((hero) => {
          const shift = shifts.get(hero.seat);
          return shift
            ? { ...hero, x: hero.x + shift.x, y: hero.y + shift.y }
            : hero;
        }),
      });
      return { world: moved(world), before: before && moved(before), t };
    },
  };
}
