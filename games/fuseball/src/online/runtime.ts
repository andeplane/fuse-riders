import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { DOWN, INPUT_MASK, LEFT, RIGHT, UP } from "../engine/index.js";
import {
  PLAY,
  fuseballGame,
  type Entry,
  type FuseballGame,
  type Room,
  type Settings,
  type View,
} from "./game.js";

export type FuseballCallbacks = Callbacks<View, never, Settings>;

/** Any number as bits a stick can produce: unknown bits dropped, and an axis pushed both ways reads as centred. */
export function stickBits(bits: number): number {
  let out = bits & INPUT_MASK;
  if ((out & (LEFT | RIGHT)) === (LEFT | RIGHT)) out &= ~(LEFT | RIGHT);
  if ((out & (UP | DOWN)) === (UP | DOWN)) out &= ~(UP | DOWN);
  return out;
}

/**
 * The Fuseball room: the netcode's runtime plus this device's held controls. A change of the held bits is logged for
 * the match this device sees; they stay held across a point reset, and a new match logs them again, since the fold
 * starts every match with nothing held.
 */
export class FuseballRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", bits: 0 };
  constructor(
    code: string,
    settings: Settings,
    callbacks: FuseballCallbacks,
    options: RuntimeOptions = {},
    game: FuseballGame = fuseballGame,
  ) {
    super(game, code, settings, callbacks, options);
  }
  /** Holds `bits` (the engine's `UP`, `DOWN`, `LEFT`, `RIGHT`, `BTN`) from now on; logs them if this device rides in the match. */
  input(bits: number): void {
    this.bits = stickBits(bits);
    this.flush();
  }
  /** Re-logs the held bits when the match has moved on since they were last logged; call it from the state callback. */
  flush(): void {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.world?.riders.some((rider) => rider.id === this.id)
    )
      return;
    if (this.sent.matchId === room.matchId && this.sent.bits === this.bits)
      return;
    this.sent = { matchId: room.matchId, bits: this.bits };
    this.append(PLAY, room.matchId, this.bits);
    this.sendPackets(this.deps.now());
  }
  /** The newest simulated room, for reports and tests; the screen renders from frames. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
  /** The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down. */
  protected resetControls(): void {
    this.sent = { matchId: "", bits: 0 };
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
