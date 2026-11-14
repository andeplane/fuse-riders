import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  ballGame,
  DEFAULT_SETTINGS,
  type BallRoom,
  type BallEntry,
  type Settings,
  type RoomView,
} from "./game.js";
import type { Impact } from "../engine/view.js";
import type { ArenaState, Control, Steering } from "../engine/state.js";
import { isAvatar } from "../engine/avatars.js";

export class BallRuntime extends RoomRuntime<
  BallRoom,
  BallEntry,
  RoomView,
  Impact,
  Settings
> {
  private held: Steering = 0;
  private radial: Steering = 0;
  /** The log tick a launch press was logged for: until the room folds it, the press is still in the air. */
  private launchAt = 0;
  constructor(
    callbacks: Callbacks<RoomView, Impact, Settings>,
    options: RuntimeOptions = {},
    code = "solo",
    settings: Settings = DEFAULT_SETTINGS,
    avatarId = "fox",
  ) {
    super(
      {
        ...ballGame,
        seating: {
          ...ballGame.seating,
          defaultAvatar: isAvatar(avatarId) ? avatarId : "fox",
        },
      },
      code,
      settings,
      callbacks,
      options,
    );
  }
  get self(): string {
    return this.id;
  }
  get canManage(): boolean {
    return (
      this.creator ||
      (this.id !== "" && this.world?.view().at(-1)?.managerId === this.id)
    );
  }
  input(steer: Steering, radial: Steering = 0, launch = false): boolean {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.arena?.bases.find((b) => b.id === this.id)?.alive
    )
      return false;
    if (steer === this.held && radial === this.radial && !launch) return false;
    this.held = steer;
    this.radial = radial;
    const tick = this.append(0, room.matchId, steer, radial, launch);
    if (launch) this.launchAt = tick;
    this.sendPackets(this.deps.now());
    return true;
  }
  /**
   * For a screen that draws at the clock: the room's newest folded arena, who is connected, and what this device
   * holds right now, whether the room has folded it or not. Undefined outside a running round.
   */
  lead():
    | {
        tick: number;
        matchId: string;
        arena: ArenaState;
        connected(id: string): boolean;
        control: Control;
      }
    | undefined {
    const room = this.world?.state;
    if (!room || room.stage !== "running" || !room.arena) return undefined;
    return {
      tick: room.tick,
      matchId: room.matchId,
      arena: room.arena,
      connected: (id) => !!room.seats.get(id)?.connected,
      control: {
        steer: this.held,
        radial: this.radial,
        launch: room.tick < this.launchAt,
      },
    };
  }
  cancel(): void {
    this.input(0);
    this.held = 0;
    this.radial = 0;
  }
  protected resetControls(): void {
    this.held = 0;
    this.radial = 0;
    this.launchAt = 0;
  }
  protected releaseControls(): void {
    this.cancel();
  }
  protected absentControls(): void {
    this.held = 0;
    this.radial = 0;
  }
}
