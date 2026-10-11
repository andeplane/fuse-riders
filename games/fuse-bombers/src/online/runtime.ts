import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { DOWN, LEFT, RIGHT, UP, type TickEvent } from "../engine/index.js";
import {
  PLAY,
  PRESS,
  STEPS_PER_TICK,
  bombersGame,
  type Entry,
  type Room,
  type Settings,
  type View,
} from "./game.js";

export type BombersCallbacks = Callbacks<View, TickEvent, Settings>;
const DIRECTIONS = UP | DOWN | LEFT | RIGHT;

/**
 * The Fuse Bombers room: the netcode's runtime plus this device's controls. A change of the held directions is
 * logged (`PLAY`) for the round this device sees. The fold starts every round with nothing held, so `flush`, which the
 * app calls with every frame it renders (as Choppers' does), logs them again once a new round or match has begun, and
 * after a resync or an absence made the runtime forget what it logged. Each fire press is its own `PRESS` entry: a
 * gesture ordinal that only ever rises along this device's stream, and the step of the log tick the press came in,
 * read off the shared clock, so a tap shorter than a log tick fires on the step it was made.
 */
export class BombersRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  TickEvent,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", round: -1, bits: 0 };
  private gesture = 0;
  constructor(
    code: string,
    settings: Settings,
    callbacks: BombersCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(bombersGame, code, settings, callbacks, options);
  }
  /** The room, while this device flies a gunship in its current round. */
  private flying(): Room | undefined {
    const room = this.world?.state;
    return room?.stage === "running" &&
      this.player()?.connected &&
      room.ships.includes(this.id)
      ? room
      : undefined;
  }
  /** Holds the direction bits of `bits` from now on (`FIRE` is `fire`'s); logs them if this device flies. */
  input(bits: number): void {
    this.bits = bits & DIRECTIONS;
    this.flush();
  }
  /**
   * One fire press; false when this device flies nothing (and no ordinal is spent). `append` stamps the entry with the
   * log tick after the clock's current one, the next to be folded, so the step is the third of that tick the clock's
   * fraction is in: 0 from the tick's first instant, 2 up to its last. The fold fires a press on that step alone.
   */
  fire(): boolean {
    const room = this.flying();
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
  /** Re-logs the held bits when the round has moved on since they were last logged. */
  flush(): void {
    const room = this.flying();
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
