import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { INPUT_MASK } from "../engine/index.js";
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
    this.append(PLAY, room.matchId, this.bits);
    this.sendPackets(this.deps.now());
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
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
