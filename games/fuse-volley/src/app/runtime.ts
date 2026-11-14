import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  HOLD,
  ROLL,
  fuseVolleyGame,
  type FuseVolleyEntry,
  type FuseVolleyEvent,
  type FuseVolleyRoom,
  type FuseVolleySettings,
  type FuseVolleyView,
} from "../game/index.js";

export type FuseVolleyCallbacks = Callbacks<
  FuseVolleyView,
  FuseVolleyEvent,
  FuseVolleySettings
>;

/**
 * The fuseVolley room: the netcode's runtime plus ROLL and HOLD. Each press is logged for the turn this device sees, so a
 * press that arrives after the turn moved on (a timer hold, a rollback) names an old turn and the rules ignore it.
 */
export class FuseVolleyRuntime extends RoomRuntime<
  FuseVolleyRoom,
  FuseVolleyEntry,
  FuseVolleyView,
  FuseVolleyEvent,
  FuseVolleySettings
> {
  constructor(
    code: string,
    settings: FuseVolleySettings,
    callbacks: FuseVolleyCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuseVolleyGame, code, settings, callbacks, options);
  }
  /** Logs ROLL or HOLD for the current turn; false when it is not this device's turn to act. */
  play(action: "roll" | "hold"): boolean {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      room.turn !== this.id ||
      !this.player()?.connected ||
      (action === "hold" && room.turnTotal === 0)
    )
      return false;
    this.append(action === "roll" ? ROLL : HOLD, room.turnNo);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** The newest simulated room, for the reports a device sends; the screen renders from the view. */
  roomState(): FuseVolleyRoom | undefined {
    return this.world?.state;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
}
