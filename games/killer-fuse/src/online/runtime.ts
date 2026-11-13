import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import type { GameEvent } from "../engine/index.js";
import {
  HELD_BITS,
  PLAY,
  PRESS,
  SEAT,
  STEPS_PER_TICK,
  killerFuseGame,
  type Entry,
  type Room,
  type Settings,
  type View,
} from "./game.js";

export type KillerFuseCallbacks = Callbacks<View, GameEvent, Settings>;

/**
 * The Killer Fuse room: the netcode's runtime plus this device's controls. A change of the held bits (left, right,
 * down, button held) is logged (`PLAY`) for the game this device sees. The fold starts every game with nothing held,
 * so `flush`, which the page calls with every frame it renders, logs them again once a new game or set has begun, and
 * after a resync or an absence made the runtime forget what it logged. Each press of the button is its own `PRESS`
 * entry: a gesture ordinal that only ever rises along this device's stream, and the step of the log tick the press
 * came in, read off the shared clock, so a tap shorter than a log tick flaps or dashes on the step it was made.
 */
export class KillerFuseRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  GameEvent,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", round: -1, bits: 0 };
  private gesture = 0;
  constructor(
    code: string,
    settings: Settings,
    callbacks: KillerFuseCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(killerFuseGame, code, settings, callbacks, options);
  }
  /** The room, while this device plays a unit in its current game. */
  private playing(): Room | undefined {
    const room = this.world?.state,
      seat = this.player();
    return room?.stage === "running" && seat?.connected && !seat.watcher
      ? room
      : undefined;
  }
  /** Holds `bits` (`INPUT_LEFT | INPUT_RIGHT | INPUT_DOWN | INPUT_HELD`) from now on; logs them if this device plays. */
  input(bits: number): void {
    this.bits = bits & HELD_BITS;
    this.flush();
  }
  /**
   * One press of the button; false when this device plays nothing (and no ordinal is spent). `append` stamps the
   * entry with the log tick after the clock's current one, the next to be folded, so the step is the third of that
   * tick the clock's fraction is in. The fold sets the press edge on that step alone.
   */
  press(): boolean {
    const room = this.playing();
    if (!room) return false;
    const clock = this.clock.tick();
    const offset = Math.floor((clock - Math.floor(clock)) * STEPS_PER_TICK);
    // Ordinals only rise along a stream, which refuses any but a higher one: above this page's last press and above
    // the stream's own floor, which is where a stream rebuilt by a resync starts.
    this.gesture = Math.max(this.gesture, this.own().latestOrdinal()) + 1;
    this.append(
      PRESS,
      room.matchId,
      room.round,
      this.gesture,
      Math.min(offset, STEPS_PER_TICK - 1),
    );
    this.sendPackets(this.deps.now());
    return true;
  }
  /**
   * Asks for `slot`, outside a running game: a free slot is taken at once, one another player holds is swapped once
   * that player asks for this one, and this device's own slot withdraws the wish. False when this device holds no
   * seat or a game is running.
   */
  seat(slot: number): boolean {
    const room = this.world?.state,
      seat = this.player();
    if (!room || room.stage === "running" || !seat?.connected || seat.watcher)
      return false;
    this.append(SEAT, slot);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** Re-logs the held bits when the game has moved on since they were last logged. */
  flush(): void {
    const room = this.playing();
    if (!room) return;
    const { matchId, round, bits } = this.sent;
    if (matchId === room.matchId && round === room.round && bits === this.bits)
      return;
    this.sent = { matchId: room.matchId, round: room.round, bits: this.bits };
    this.append(PLAY, room.matchId, room.round, this.bits);
    this.sendPackets(this.deps.now());
  }
  /** The newest simulated room, for reports and tests; the screen renders from frames. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
  /** The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down. */
  protected resetControls(): void {
    this.sent = { matchId: "", round: -1, bits: 0 };
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
