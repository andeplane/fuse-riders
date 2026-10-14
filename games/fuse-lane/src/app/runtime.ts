import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  GOALS,
  fuseLaneGame,
  validGoal,
  type FuseLaneEntry,
  type FuseLaneEvent,
  type FuseLaneRoom,
  type FuseLaneSettings,
  type FuseLaneView,
} from "../game/index.js";

export type FuseLaneCallbacks = Callbacks<
  FuseLaneView,
  FuseLaneEvent,
  FuseLaneSettings
>;

/**
 * The Fuse Lane room: the netcode's runtime plus the play entries. The presenter builds every entry body (each names
 * the week it was made for), so a tap that arrives after the week moved on is ignored by the rules, never misapplied.
 */
export class FuseLaneRuntime extends RoomRuntime<
  FuseLaneRoom,
  FuseLaneEntry,
  FuseLaneView,
  FuseLaneEvent,
  FuseLaneSettings
> {
  constructor(
    code: string,
    settings: FuseLaneSettings,
    callbacks: FuseLaneCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuseLaneGame, code, settings, callbacks, options);
  }
  /** Logs one play entry body (WALK, ACT, END_WEEK or READY) during a match; false when this device cannot play. */
  play(body: readonly unknown[]): boolean {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.players[this.id]
    )
      return false;
    this.append(...body);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** Logs this seat's goal picks in the lobby. */
  setGoals(goals: readonly number[]): boolean {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "lobby" ||
      !this.player()?.connected ||
      goals.length !== 4 ||
      !goals.every(validGoal)
    )
      return false;
    this.append(GOALS, 0, ...goals);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** The newest simulated room, for the reports a device sends; the screen renders from the view. */
  roomState(): FuseLaneRoom | undefined {
    return this.world?.state;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
}
