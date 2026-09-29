import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import type { Settings } from "../engine/index.js";
import { PLAY, chopperGame, type Entry, type Room, type View } from "./game.js";

export type ChopperCallbacks = Callbacks<View, never, Settings>;

/**
 * The chopper room: the netcode's runtime plus this device's held controls. A change of the held bits is logged
 * for the round this device sees; a new round (or match) logs them again, since the fold starts every round with
 * nothing held.
 */
export class ChopperRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", round: -1, bits: 0 };
  constructor(
    code: string,
    settings: Settings,
    callbacks: ChopperCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(chopperGame, code, settings, callbacks, options);
  }
  /** Holds `bits` from now on; logs them if the room is in a round and this device flies in it. */
  input(bits: number): void {
    this.bits = bits;
    this.flush();
  }
  /** Re-logs the held bits when the round has moved on since they were last logged. */
  flush(): void {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.world?.choppers.some((c) => c.id === this.id)
    )
      return;
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
  protected resetControls(): void {
    this.bits = 0;
    this.sent = { matchId: "", round: -1, bits: 0 };
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
