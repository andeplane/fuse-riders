import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import {
  stepsForTick,
  trackFor,
  unpackControls,
  type FuseDriversRoom,
} from "../game/index.js";
import { botInput, type BotMemory } from "../game/sim/bot.js";
import { step, type RaceEvent, type RaceState } from "../game/sim/race.js";
import type { TruckPose } from "./arena/interpolate.js";

/**
 * Draw at the clock, not a tick behind. The page used to draw between the two newest folded races, so a turn of the
 * wheel showed 50–100 ms after it was made. Instead the newest folded race is played forward, by the fraction of a
 * log tick the clock has run past it, with the controls every seat holds (this device's own live, logged or not) and
 * the bots driving as the fold drives them, and that is drawn: a press shows on the next animation frame. Every step
 * returns a new race, so the room's is never touched and nothing here reaches it.
 *
 * The run never crosses anything the room decides: the green light, a lap, a finish, a pickup, a hit or a kill is
 * shown when the room has folded it, never on a guess.
 */
export interface Lead {
  /** The race to draw. */
  race: RaceState;
  /** The race one step before it, to pose the trucks between the two; undefined when `race` is the folded one. */
  previous: RaceState | undefined;
  /** How far from `previous` to `race`, 0 to 1. */
  alpha: number;
}

const DECIDES: ReadonlySet<RaceEvent["type"]> = new Set([
  "start",
  "lap",
  "finish",
  "pickup",
  "hit",
  "kill",
]);

/** A run of the room's race `ahead` log ticks (0–2, fractional) past its newest fold. `live` is this device's controls now. */
export function forward(
  room: FuseDriversRoom,
  ahead: number,
  me: string,
  live: number,
): Lead | undefined {
  const folded = room.race;
  if (!folded) return undefined;
  const track = trackFor(folded.trackName),
    bots: Record<string, BotMemory | undefined> = { ...room.bots };
  const held = room.grid.map((id) => {
    const seat = room.seats.get(id);
    if (seat?.bot) return 0;
    if (seat && !seat.connected) return 0;
    return id === me && seat && !seat.watcher ? live : (room.controls[id] ?? 0);
  });
  /** One step as the fold takes it, or undefined when the step decides something. */
  const advance = (race: RaceState): RaceState | undefined => {
    const memories: [string, BotMemory][] = [];
    const inputs = held.map((bits, slot) => {
      const id = room.grid[slot]!,
        memory = room.seats.get(id)?.bot ? bots[id] : undefined;
      if (!memory) return unpackControls(bits);
      const [controls, next] = botInput(race, slot, memory, track, "normal");
      memories.push([id, next]);
      return controls;
    });
    const result = step(race, inputs, track);
    if (
      result.state.phase !== race.phase ||
      result.events.some((event) => DECIDES.has(event.type))
    )
      return undefined;
    for (const [id, memory] of memories) bots[id] = memory;
    return result.state;
  };
  let race = folded,
    previous: RaceState | undefined,
    tick = room.tick;
  for (let left = Math.max(0, ahead); left > 0; left -= 1) {
    const steps = Math.min(1, left) * stepsForTick(++tick),
      whole = Math.floor(steps + 0.001);
    for (let index = 0; index < whole; index++) {
      const next = advance(race);
      if (!next) return { race, previous, alpha: 1 };
      previous = race;
      race = next;
    }
    const part = steps - whole;
    if (left <= 1 && part > 0.001) {
      const next = advance(race);
      if (next) return { race: next, previous: race, alpha: part };
    }
  }
  return { race, previous, alpha: 1 };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels (a respawn) is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 200;

export interface Smoother {
  /**
   * Starts a drawn frame. `revision` is the runtime's frame revision (a rollback replaced history), `folded` the
   * newest folded log tick and `held` the controls each truck slot had logged as of it.
   */
  begin(
    key: string,
    revision: number,
    folded: number,
    held: readonly number[],
    nowMs: number,
  ): void;
  /** Where to draw the truck in `slot` this frame, given `pose`, where the forward run has it. */
  place(slot: number, pose: TruckPose): TruckPose;
}

/**
 * Hides what the forward run got wrong about the other trucks: when a rollback moves them, or a new tick shows
 * another driver changed what they hold, the screen keeps them where they were and lets the difference decay. Call
 * `place` for the other trucks only: this device's own must follow the hands exactly.
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
    before: readonly number[] = [],
    race = "",
    rolled = false,
    stepped = false;
  return {
    begin(key, nextRevision, nextFolded, held, nowMs) {
      if (key !== race) {
        race = key;
        smoother.reset();
      }
      smoother.begin(nowMs);
      rolled = revision !== undefined && nextRevision !== revision;
      stepped = nextFolded !== folded;
      before = logged;
      revision = nextRevision;
      folded = nextFolded;
      logged = [...held];
    },
    place(slot, pose) {
      const changed = stepped && (before[slot] ?? 0) !== (logged[slot] ?? 0);
      return {
        ...pose,
        ...smoother.place(`truck:${slot}`, pose, rolled || changed),
      };
    },
  };
}
