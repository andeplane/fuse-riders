import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { INPUT_MASK, STEPS_PER_TICK } from "../engine/index.js";
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

/**
 * The Elasto Fuse room: the netcode's runtime plus this device's held controls. A change of the held bits is logged
 * for the match this device sees; they stay held across a restart and into the tour's next race, and a new match logs them again, since the fold
 * starts every match with nothing held.
 */
export class ElastoFuseRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", bits: 0 };
  /** What this device logged lately and the room may not have folded yet: the step each took hold on, oldest first. */
  private logged: { tick: number; step: number; bits: number }[] = [];
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
    this.bits = heldBits(bits);
    this.flush();
  }
  /** Re-logs the held bits when the match has moved on since they were last logged; call it from the state callback. */
  flush(): void {
    const room = this.world?.state;
    if (
      !room ||
      (room.stage !== "running" && room.stage !== "between") ||
      !this.player()?.connected ||
      !room.world?.riders.some((rider) => rider.id === this.id)
    )
      return;
    if (this.sent.matchId === room.matchId && this.sent.bits === this.bits)
      return;
    this.sent = { matchId: room.matchId, bits: this.bits };
    // The key acts on the step the clock is in, not at the next tick: the stamp is the tick being played now, and
    // the step is how far into it the clock has run.
    const clock = this.clock.tick(),
      tick = this.recorder.next(),
      last = this.logged[this.logged.length - 1];
    let step =
      tick === Math.floor(clock) + 1
        ? Math.min(
            STEPS_PER_TICK - 1,
            Math.floor((clock - Math.floor(clock)) * STEPS_PER_TICK),
          )
        : 0;
    if (last?.tick === tick) step = Math.max(step, last.step);
    this.logged = this.logged.filter((entry) => entry.tick > room.tick);
    this.logged.push({ tick, step, bits: this.bits });
    this.recorder.at(tick, [PLAY, room.matchId, this.bits, step]);
    this.sendPackets(this.deps.now());
  }
  /**
   * The bits this device's bike has `steps` steps past the newest folded room: what the fold will play there, from
   * the entries logged and not folded yet, and what the room holds before them. The forward run draws with these, so
   * the picture is the bike the room is about to compute.
   */
  heldAhead(steps: number): number {
    const room = this.world?.state;
    if (!room) return 0;
    const tick = room.tick + 1 + Math.floor(steps / STEPS_PER_TICK),
      step = steps % STEPS_PER_TICK;
    let bits = room.held[this.id] ?? 0;
    for (const entry of this.logged) {
      if (entry.tick <= room.tick) continue;
      if (entry.tick > tick || (entry.tick === tick && entry.step > step))
        break;
      bits = entry.bits;
    }
    return bits;
  }
  /** The newest simulated room, for reports, the forward run and tests. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  /** The bits this device holds now, logged or not: the forward run leads its own bike with them. */
  get heldNow(): number {
    return this.bits;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
  /** The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down. */
  protected resetControls(): void {
    this.sent = { matchId: "", bits: 0 };
    this.logged = [];
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
