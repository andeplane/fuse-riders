import {
  RoomRuntime,
  type Callbacks,
  type RoomCommand,
  type RuntimeOptions,
} from "fuse-netcode";
import { hookGame, type Room, type Entry, type View } from "./game.js";
import { NEUTRAL, type Input, type Tuning } from "../engine/world.js";
import { parseTuning } from "../engine/codec.js";
import { prewarmNav } from "../engine/bot-nav.js";
export class HookRuntime extends RoomRuntime<Room, Entry, View, never, Tuning> {
  private held: Input = { ...NEUTRAL };
  constructor(
    code: string,
    settings: Tuning,
    callbacks: Callbacks<View, never, Tuning>,
    options: RuntimeOptions,
  ) {
    super(hookGame, code, settings, callbacks, options);
    // The bots' nav graphs, before this peer's first fold or checkpoint
    // decode needs one (bots.md, Navigation).
    prewarmNav(settings);
  }
  command(command: RoomCommand<Tuning>): boolean {
    // New movement tuning: build its graphs before the entry reaches a fold.
    if (command?.type === "settings") {
      const settings = parseTuning(command.settings);
      if (settings) prewarmNav(settings);
    }
    return super.command(command);
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
  /**
   * Releases every button. A release is a throw, so a caller that knows the
   * current aim passes it; otherwise the last sent aim stands.
   */
  clear(aim: Pick<Input, "aimX" | "aimY"> = this.held): void {
    this.input({ ...NEUTRAL, aimX: aim.aimX, aimY: aim.aimY });
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
