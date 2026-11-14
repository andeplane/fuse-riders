import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { INPUT_MASK } from "../engine/index.js";
import {
  PLAY,
  fuseVolleyGame,
  type Entry,
  type FuseVolleyGame,
  type Room,
  type Settings,
  type View,
} from "./game.js";

export type FuseVolleyCallbacks = Callbacks<View, never, Settings>;

/** Any number as held bits: unknown bits dropped. Left and right together cancel in the engine. */
export const heldBits = (bits: number): number => bits & INPUT_MASK;

/**
 * The Fuse Volley room: the netcode's runtime plus this device's held controls. A change of the held bits is logged
 * for the match this device sees; they stay held across a serve, and a new match logs them again, since the fold
 * starts every match with nothing held.
 */
export class FuseVolleyRuntime extends RoomRuntime<
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
    callbacks: FuseVolleyCallbacks,
    options: RuntimeOptions = {},
    game: FuseVolleyGame = fuseVolleyGame,
  ) {
    super(game, code, settings, callbacks, options);
  }
  /** Holds `bits` (the engine's `LEFT`, `RIGHT`, `JUMP`) from now on; logs them if this device plays in the match. */
  input(bits: number): void {
    this.bits = heldBits(bits);
    this.flush();
  }
  /** Re-logs the held bits when the match has moved on since they were last logged; call it from the state callback. */
  flush(): void {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.world?.blobs.some((blob) => blob.id === this.id)
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
  /** The bits this device holds now, logged or not: the forward run leads its own blob with them. */
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
