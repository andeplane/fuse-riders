import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { hookGame, type Room, type Entry, type View } from "./game.js";
import { NEUTRAL, type Input, type Tuning } from "../engine/world.js";
export class HookRuntime extends RoomRuntime<Room, Entry, View, never, Tuning> {
  private held: Input = { ...NEUTRAL };
  constructor(
    code: string,
    settings: Tuning,
    callbacks: Callbacks<View, never, Tuning>,
    options: RuntimeOptions,
  ) {
    super(hookGame, code, settings, callbacks, options);
  }
  input(input: Input): void {
    const r = this.world?.state;
    if (
      !r ||
      r.stage !== "running" ||
      !this.player()?.connected ||
      JSON.stringify(input) === JSON.stringify(this.held)
    )
      return;
    this.held = { ...input };
    this.append(0, r.matchId, r.round, { ...input });
    this.sendPackets(this.deps.now());
  }
  clear(): void {
    this.input({ ...NEUTRAL, aimX: this.held.aimX, aimY: this.held.aimY });
  }
  protected resetControls(): void {
    this.held = { ...NEUTRAL };
  }
  protected releaseControls(): void {
    this.clear();
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
