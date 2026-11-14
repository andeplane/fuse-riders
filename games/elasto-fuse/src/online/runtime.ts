import {
  RoomRuntime,
  TICK_MS,
  type Callbacks,
  type RuntimeOptions,
} from "fuse-netcode";
import {
  FINISHED,
  INPUT_MASK,
  RACE_LIMIT,
  RESTART,
  RIDER_AHEAD,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
} from "../engine/index.js";
import {
  PLAY,
  elastoFuseGame,
  type Entry,
  type ElastoFuseGame,
  type Room,
  type Settings,
  type View,
} from "./game.js";

export type ElastoFuseCallbacks = Callbacks<View, never, Settings>;

/** Any number as held bits: unknown bits dropped. */
export const heldBits = (bits: number): number => bits & INPUT_MASK;

const STEP_MS = 1000 / STEPS_PER_SECOND;
/** The bits that act when they go down. */
const PRESSES = TURN | VOLT_LEFT | VOLT_RIGHT | RESTART;
/** Steps between two words of how far this device's bike has run while nothing it holds changes: one a log tick. */
export const HEARTBEAT = STEPS_PER_TICK;
/** The most steps one frame runs the bike on: a page that froze for longer loses the time, the bike does not leap. */
export const MOST_CATCH_UP = STEPS_PER_SECOND / 4;
/** The furthest this device's bike runs past what the room has folded of it; past that its clock waits. */
export const MOST_LEAD = 3 * STEPS_PER_SECOND;
/** A device that finds its race already under way starts its bike at most this many steps in. */
const LATE_START = 2 * STEPS_PER_TICK;

/** Where this device's own bike is on its own clock, for the screen. */
export interface LocalRide {
  /** The rider's slot in the race. */
  slot: number;
  /** Steps since the start on this device's clock, fractional; negative through the countdown. */
  step: number;
  /** What the bike holds on step `step` of its own clock: what the room will replay there. */
  bits(step: number): number;
}

/**
 * The Elasto Fuse room: the netcode's runtime plus this device's bike. Riders never touch, so this device's bike
 * runs on this device's own clock, started once from the room's countdown and never corrected by the network: a
 * change of the held bits takes hold on the step the clock is in, and the room is told (`PLAY`) which step that was
 * and, every tick, how far the bike has run. The room replays exactly that, so what the rider saw is what counts.
 */
export class ElastoFuseRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  /**
   * Presses held since before the race started: they were not pressed in it, so they are not logged until let go.
   * A turn or a restart still down from the countdown, or from the result before, does nothing at the start.
   */
  private stale = 0;
  /** The race or rest the held bits were last logged for, and the bits. */
  private sent = { key: "", bits: 0 };
  /** The race this device's clock runs for, when its step 0 is, and the last whole step seen and logged. */
  private race = { key: "", goAt: 0, last: 0, logged: -1 };
  /** What this device logged lately and the room may not have folded yet, oldest first. */
  private logged: { tick: number; key: string; at: number; bits: number }[] =
    [];
  constructor(
    code: string,
    settings: Settings,
    callbacks: ElastoFuseCallbacks,
    options: RuntimeOptions = {},
    game: ElastoFuseGame = elastoFuseGame,
  ) {
    super(game, code, settings, callbacks, options);
  }
  /** Holds `bits` (the engine's `GAS`, `BRAKE`, the volts, `TURN`, `RESTART`) from now on; logs them if this device plays in the match. */
  input(bits: number): void {
    // The bike first runs up to now on what was held: the new bits take hold on the step the clock is in.
    this.flush();
    this.bits = heldBits(bits);
    this.stale &= this.bits;
    this.flush();
  }
  /** This device's seat in the race being run, if it rides in it. */
  private riding(): { room: Room; slot: number } | undefined {
    const room = this.world?.state;
    if (
      !room?.world ||
      (room.stage !== "running" && room.stage !== "between") ||
      !this.player()?.connected
    )
      return;
    const slot = room.world.riders.findIndex((rider) => rider.id === this.id);
    return slot < 0 ? undefined : { room, slot };
  }
  /**
   * Brings this device's clock up to now and logs what the room has not heard: the held bits when they changed (or
   * the race did), and how far the bike has run. Call it every frame and from the state callback.
   */
  flush(): void {
    const mine = this.riding();
    if (!mine) return;
    const { room, slot } = mine,
      world = room.world!,
      now = this.deps.now();
    if (room.stage === "between") {
      this.stale = this.bits & PRESSES;
      const key = `${room.matchId}:${room.round}:rest`,
        bits = this.bits & ~this.stale;
      if (this.sent.key === key && this.sent.bits === bits) return;
      this.sent = { key, bits };
      this.log(room, key, 0, bits);
      return;
    }
    const key = `${room.matchId}:${room.round}`,
      rider = world.riders[slot]!;
    if (this.race.key !== key) {
      let goAt: number;
      if (world.phase === "countdown")
        goAt =
          now +
          (room.tick + world.go / STEPS_PER_TICK - this.clock.tick()) * TICK_MS;
      else {
        // Already racing (a page that came back): on from where the room has this bike, or just after the start.
        const elapsed =
          world.step + (this.clock.tick() - room.tick) * STEPS_PER_TICK;
        goAt =
          now -
          Math.max(rider.step, Math.min(elapsed, rider.step + LATE_START)) *
            STEP_MS;
      }
      const at = Math.max(0, Math.floor((now - goAt) / STEP_MS));
      this.race = { key, goAt, last: at, logged: -1 };
    }
    const race = this.race;
    let at = Math.floor((now - race.goAt) / STEP_MS);
    // The clock only ever waits: after a frozen page, when the room is far behind this bike, at the time limit.
    const most = Math.min(
      race.last + MOST_CATCH_UP,
      rider.step + MOST_LEAD,
      world.step + RIDER_AHEAD,
      RACE_LIMIT,
    );
    if (at > most) {
      race.goAt += (at - most) * STEP_MS;
      at = most;
    }
    // Never behind what the room already replayed of this bike.
    if (rider.step > 0 && at < rider.step) {
      race.goAt = now - rider.step * STEP_MS;
      at = rider.step;
    }
    // Still counting down: whatever is down now was down before the start.
    if (at < 0) this.stale = this.bits & PRESSES;
    const bits = this.bits & ~this.stale;
    at = Math.max(0, at);
    race.last = at;
    const done =
      world.phase === "over" ||
      rider.status === FINISHED ||
      rider.step >= world.close;
    const changed = this.sent.key !== key || this.sent.bits !== bits;
    if (!changed && (done || at < race.logged + HEARTBEAT)) return;
    this.sent = { key, bits };
    race.logged = at;
    this.log(room, key, at, bits);
  }
  private log(room: Room, key: string, at: number, bits: number): void {
    const tick = this.recorder.next();
    this.logged = this.logged.filter((entry) => entry.tick > room.tick);
    this.logged.push({ tick, key, at, bits });
    this.recorder.at(tick, [PLAY, room.matchId, bits, at, room.round]);
    this.sendPackets(this.deps.now());
  }
  /**
   * This device's own bike now, on its own clock, for the screen to draw: the room's copy of it replayed on with the
   * bits this device logged and the room has not folded yet. Nothing when this device rides in no race.
   */
  localRide(): LocalRide | undefined {
    this.flush();
    const mine = this.riding();
    if (!mine || mine.room.stage !== "running") return;
    const { room, slot } = mine,
      key = this.race.key,
      before = room.held[this.id] ?? 0,
      pending = this.logged.filter(
        (entry) => entry.tick > room.tick && entry.key === key,
      ),
      last = this.race.last,
      now = this.deps.now();
    return {
      slot,
      // No further than the whole steps the clock was allowed: the fraction past them is drawn, never more.
      step: Math.min((now - this.race.goAt) / STEP_MS, last + 1),
      bits: (step) => {
        let bits = before;
        for (const entry of pending) {
          if (entry.at > step) break;
          bits = entry.bits;
        }
        return bits;
      },
    };
  }
  /** The newest simulated room, for reports, the screen and tests. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  /** The bits this device holds now, logged or not. */
  get heldNow(): number {
    return this.bits;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
  /** The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down. */
  protected resetControls(): void {
    this.sent = { key: "", bits: 0 };
    this.stale = 0;
    this.race = { key: "", goAt: 0, last: 0, logged: -1 };
    this.logged = [];
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
