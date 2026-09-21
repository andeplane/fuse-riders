import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  ballGame,
  DEFAULT_SETTINGS,
  type BallRoom,
  type BallEntry,
  type Settings,
} from "./game.js";
import type { BallView, Impact } from "../engine/view.js";
import type { Steering } from "../engine/state.js";

export class BallRuntime extends RoomRuntime<
  BallRoom,
  BallEntry,
  BallView,
  Impact,
  Settings
> {
  private held: Steering = 0;
  constructor(
    callbacks: Callbacks<BallView, Impact, Settings>,
    options: RuntimeOptions = {},
  ) {
    super(ballGame, "solo", DEFAULT_SETTINGS, callbacks, options);
  }
  input(steer: Steering, launch = false): boolean {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.arena?.bases.find((b) => b.id === this.id)?.alive
    )
      return false;
    if (steer === this.held && !launch) return false;
    this.held = steer;
    this.append(0, room.matchId, steer, launch);
    this.sendPackets(this.deps.now());
    return true;
  }
  cancel(): void {
    this.input(0);
    this.held = 0;
  }
  protected resetControls(): void {
    this.held = 0;
  }
  protected releaseControls(): void {
    this.cancel();
  }
  protected absentControls(): void {
    this.held = 0;
  }
}
