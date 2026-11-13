import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  HOLD,
  ROLL,
  fuseballGame,
  type FuseballEntry,
  type FuseballEvent,
  type FuseballRoom,
  type FuseballSettings,
  type FuseballView,
} from "../game/index.js";

export type FuseballCallbacks = Callbacks<
  FuseballView,
  FuseballEvent,
  FuseballSettings
>;

/**
 * The fuseball room: the netcode's runtime plus ROLL and HOLD. Each press is logged for the turn this device sees, so a
 * press that arrives after the turn moved on (a timer hold, a rollback) names an old turn and the rules ignore it.
 */
export class FuseballRuntime extends RoomRuntime<
  FuseballRoom,
  FuseballEntry,
  FuseballView,
  FuseballEvent,
  FuseballSettings
> {
  constructor(
    code: string,
    settings: FuseballSettings,
    callbacks: FuseballCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuseballGame, code, settings, callbacks, options);
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
  roomState(): FuseballRoom | undefined {
    return this.world?.state;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
}
